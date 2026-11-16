package com.scaffold.app;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.view.accessibility.AccessibilityEvent;

/** The app blocker: whenever a not-allowed app comes to the front during a lock, Scaffold's lock screen covers it. */
public class BlockerService extends AccessibilityService {
    static volatile BlockerService instance;
    static volatile String lastPkg = "";
    private long lastLaunch = 0;

    private final android.os.Handler loop = new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable guard = new Runnable() { @Override public void run() { watch(); loop.postDelayed(this, 2000); } };

    @Override protected void onServiceConnected() { instance = this; Enforcer.forgetDynamic(); loop.removeCallbacks(guard); loop.postDelayed(guard, 2000); }

    /** Every 2 s during a lock: if Scaffold isn't on screen and the app in front isn't an allowed one, bring the lock back.
     *  Covers a missed app-switch event (then nothing would re-check until the next switch). */
    private void watch() {
        Engine.Active act = Store.mode(this);
        if (act == null || MainActivity.resumed) return;
        String pkg = lastPkg;
        boolean stale = pkg.isEmpty() || pkg.equals(getPackageName());   // we think Scaffold is in front, but it isn't
        if (stale && !"lock".equals(act.src)) return;
        if (!stale && Enforcer.allowed(this, pkg, act)) return;
        lastLaunch = 0;
        check(stale ? "" : pkg);
    }

    @Override public void onAccessibilityEvent(AccessibilityEvent e) {
        if (e.getEventType() != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED || e.getPackageName() == null) return;
        lastPkg = e.getPackageName().toString();
        check(lastPkg);
    }

    void check(String pkg) {
        Engine.Result r = Store.now(this);
        boolean note = !r.notes.isEmpty();
        Engine.Active act = Store.mode(this);
        if (!note && act == null) return;
        if (pkg.equals(getPackageName()) || (act != null ? Enforcer.allowed(this, pkg, act) : Enforcer.ALWAYS.contains(pkg))) return;
        long now = System.currentTimeMillis();
        if (now - lastLaunch < 700) return;
        lastLaunch = now;
        if (!note && !"lock".equals(act.src)) {   // a mode: the app just closes (back to the home screen) until the mode ends
            if (pkg.isEmpty() || Enforcer.isHome(this, pkg)) return;
            performGlobalAction(GLOBAL_ACTION_HOME);
            String label = pkg;
            try { label = getPackageManager().getApplicationLabel(getPackageManager().getApplicationInfo(pkg, 0)).toString(); } catch (Exception ignored) {}
            android.widget.Toast.makeText(this, "🛡️ " + label + " is blocked by " + act.mode.optString("name", "a") + " Mode", android.widget.Toast.LENGTH_SHORT).show();
            return;
        }
        Intent i = new Intent(this, MainActivity.class)
                .putExtra("mode", note ? "note" : "block")
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivity(i);
    }

    /** A lock just started: cover whatever is on screen right now. */
    static void recheck() { BlockerService s = instance; if (s != null) s.check(lastPkg); }

    /** A reminder note is waiting: bring it to the front. */
    static void showNote() {
        BlockerService s = instance;
        if (s == null) return;
        s.startActivity(new Intent(s, MainActivity.class).putExtra("mode", "note")
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP));
    }

    /** Pop-ups need to start an activity from the background; an active accessibility service is allowed to. */
    static boolean showPopup(String taskId) {
        BlockerService s = instance;
        if (s == null) return false;
        s.startActivity(new Intent(s, MainActivity.class).putExtra("mode", "remind").putExtra("task", taskId)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP));
        return true;
    }

    @Override public void onInterrupt() {}
    @Override public void onDestroy() { loop.removeCallbacks(guard); instance = null; super.onDestroy(); }
}
