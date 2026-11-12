package com.scaffold.app;

import android.content.Context;

/** Sets the next alarm: the next reminder, lock change, timer end or midnight, whichever comes first. */
public final class Scheduler {
    static void reschedule(Context c) {
        long next = Store.now(c).next;
        long ends = Store.getLong(c, "timerEnds", 0);
        if (ends > System.currentTimeMillis() && ends < next) next = ends;
        AlarmReceiver.schedule(c, Math.max(next, System.currentTimeMillis() + 1000));
    }
}
