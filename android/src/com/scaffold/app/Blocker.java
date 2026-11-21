package com.scaffold.app;

import android.app.AppOpsManager;
import android.app.usage.UsageEvents;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.Process;
import android.provider.Settings;

/** The app blocker, without Accessibility (bank apps refuse to run while a sideloaded app holds that permission).
 *  "Usage access" tells which app is in front; "Display over other apps" lets Scaffold bring its lock screen,
 *  notes and pop-ups to the front from the background. Runs inside CoreService. Allowed apps are never touched. */
final class Blocker {
    static volatile String lastPkg = "";
    private static Context app;
    private static final Handler loop = new Handler(Looper.getMainLooper());
    private static boolean running;
    private static long lastQuery, lastLaunch, actAt;
    private static Engine.Active act;
    private static boolean note, once;

    private static final Runnable tick = new Runnable() { @Override public void run() { long d = step(); loop.postDelayed(this, d); } };

    static void start(Context c) {
        app = c.getApplicationContext();
        if (running) return;
        running = true;
        Enforcer.forgetDynamic();
        loop.post(tick);
    }

    static boolean usageOn(Context c) {
        try {
            AppOpsManager ao = c.getSystemService(AppOpsManager.class);
            int m = Build.VERSION.SDK_INT >= 29
                    ? ao.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), c.getPackageName())
                    : ao.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), c.getPackageName());
            if (m == AppOpsManager.MODE_DEFAULT) return c.checkSelfPermission("android.permission.PACKAGE_USAGE_STATS") == android.content.pm.PackageManager.PERMISSION_GRANTED;
            return m == AppOpsManager.MODE_ALLOWED;
        } catch (Exception e) { return false; }
    }

    static boolean overlayOn(Context c) { return Settings.canDrawOverlays(c); }

    /** One check. Returns the delay until the next one: fast while a lock, mode or note is on, slow otherwise. */
    private static long step() {
        Context c = app;
        if (c == null) return 2000;
        long now = System.currentTimeMillis();
        try {
            if (now - actAt > 2000) { refresh(c); actAt = now; }
            if (act == null && !note) { lastQuery = 0; return 2000; }
            if (!c.getSystemService(PowerManager.class).isInteractive()) return 1000;
            String pkg = foreground(c, now);
            if (pkg != null) lastPkg = pkg;
            watch(c);
        } catch (Exception ignored) {}
        return 500;
    }

    private static void refresh(Context c) {
        note = !Store.now(c).notes.isEmpty();
        act = Store.mode(c);
    }

    /** The app in front, from the system's own app-switch log (null = no switch since the last look). */
    private static String foreground(Context c, long now) {
        if (!usageOn(c)) return null;
        UsageStatsManager um = c.getSystemService(UsageStatsManager.class);
        long from = lastQuery == 0 ? now - 3600000 : lastQuery - 2000;
        lastQuery = now;
        UsageEvents ev = um.queryEvents(from, now + 1000);
        if (ev == null) return null;
        UsageEvents.Event e = new UsageEvents.Event();
        String fg = null; long fgAt = 0;
        while (ev.hasNextEvent()) {
            ev.getNextEvent(e);
            if (e.getEventType() == UsageEvents.Event.MOVE_TO_FOREGROUND && e.getTimeStamp() >= fgAt) { fg = e.getPackageName(); fgAt = e.getTimeStamp(); }
        }
        return fg;
    }

    private static void watch(Context c) {
        if (MainActivity.resumed) { once = false; return; }
        String pkg = lastPkg;
        boolean stale = pkg.isEmpty() || pkg.equals(c.getPackageName());   // we think Scaffold is in front, but it isn't
        if (stale && !note && (act == null || !"lock".equals(act.src))) return;
        // Without usage access the app in front is unknown: cover the screen once when the lock starts, then leave
        // calls, WhatsApp and the rest reachable (instead of covering them again every second).
        if (stale && !usageOn(c)) { if (!once) return; once = false; }
        check(c, stale ? "" : pkg);
    }

    private static void check(Context c, String pkg) {
        if (!note && act == null) return;
        if (pkg.equals(c.getPackageName()) || (act != null ? Enforcer.allowed(c, pkg, act) : Enforcer.ALWAYS.contains(pkg))) return;
        long now = System.currentTimeMillis();
        if (now - lastLaunch < 800) return;
        lastLaunch = now;
        if (!note && !"lock".equals(act.src)) {   // a mode: the app just closes (back to the home screen) until the mode ends
            if (pkg.isEmpty() || Enforcer.isHome(c, pkg)) return;
            launch(c, new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME));
            String label = pkg;
            try { label = c.getPackageManager().getApplicationLabel(c.getPackageManager().getApplicationInfo(pkg, 0)).toString(); } catch (Exception ignored) {}
            android.widget.Toast.makeText(c, "🛡️ " + label + " is blocked by " + act.mode.optString("name", "a") + " Mode", android.widget.Toast.LENGTH_SHORT).show();
            return;
        }
        launch(c, new Intent(c, MainActivity.class).putExtra("mode", note ? "note" : "block"));
    }

    /** Starting a screen from the background is allowed once "Display over other apps" is on. */
    private static boolean launch(Context c, Intent i) {
        if (c == null || !overlayOn(c)) return false;
        try { c.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP)); return true; }
        catch (Exception e) { return false; }
    }

    /** A lock or mode just started (or the state changed): look again right away. */
    static void recheck(Context c) {
        if (app == null) app = c.getApplicationContext();
        loop.post(() -> { actAt = 0; lastLaunch = 0; once = true; step(); });
    }

    /** A reminder note is waiting: bring it to the front. Callers pass their context: after a restart an alarm can
     *  arrive before CoreService (and so the blocker) is running. */
    static void showNote(Context c) { Context a = c.getApplicationContext(); launch(a, new Intent(a, MainActivity.class).putExtra("mode", "note")); }

    static boolean showPopup(Context c, String taskId) { return showPopup(c, taskId, "remind"); }
    static boolean showPopup(Context c, String taskId, String mode) {
        Context a = c.getApplicationContext();
        return launch(a, new Intent(a, MainActivity.class).putExtra("mode", mode).putExtra("task", taskId));
    }

    /** Any screen from the background (the update's Install dialog). */
    static boolean open(Context c, Intent i) { return launch(c.getApplicationContext(), i); }
}
