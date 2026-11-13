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
        Engine.Result r = Store.now(this);
        if (r.lock == null || r.paused || MainActivity.resumed) return;
        String pkg = lastPkg;
        boolean stale = pkg.isEmpty() || pkg.equals(getPackageName());   // we think Scaffold is in front, but it isn't
        if (!stale && Enforcer.allowed(this, pkg, r.lock)) return;
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
        if (!note && r.lock == null) return;
        if (pkg.equals(getPackageName()) || (r.lock != null ? Enforcer.allowed(this, pkg, r.lock) : Enforcer.ALWAYS.contains(pkg))) return;
        long now = System.currentTimeMillis();
        if (now - lastLaunch < 700) return;
        lastLaunch = now;
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
