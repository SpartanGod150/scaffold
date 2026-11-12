package com.scaffold.app;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.view.accessibility.AccessibilityEvent;

/** The app blocker: whenever a not-allowed app comes to the front during a lock, Scaffold's lock screen covers it. */
public class BlockerService extends AccessibilityService {
    static volatile BlockerService instance;
    static volatile String lastPkg = "";
    private long lastLaunch = 0;

    @Override protected void onServiceConnected() { instance = this; Enforcer.forgetDynamic(); }

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
    static void recheck() { BlockerService s = instance; if (s != null && !lastPkg.isEmpty()) s.check(lastPkg); }

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
    @Override public void onDestroy() { instance = null; super.onDestroy(); }
}
