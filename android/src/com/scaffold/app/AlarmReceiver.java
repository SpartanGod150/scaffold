package com.scaffold.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import org.json.JSONObject;

import java.util.List;

/** Handles alarms (reminders, lock start, timer end), notification buttons and boot. */
public class AlarmReceiver extends BroadcastReceiver {
    static final String TICK = "com.scaffold.app.TICK", DONE = "com.scaffold.app.DONE", SNOOZE = "com.scaffold.app.SNOOZE",
            STOP = "com.scaffold.app.STOP", RESUME = "com.scaffold.app.RESUME", ACK = "com.scaffold.app.ACK";

    @Override public void onReceive(Context ctx, Intent intent) {
        Context c = ctx.getApplicationContext();
        String a = intent.getAction() == null ? TICK : intent.getAction();
        String task = intent.getStringExtra("task");
        String me = Store.deviceId(c);
        long now = System.currentTimeMillis();
        switch (a) {
            case DONE: {
                JSONObject p;
                synchronized (Store.class) { p = Engine.opComplete(Store.state(c), task, "full", me, now); }
                Store.apply(c, p, true);
                Notif.cancelTask(c, task);
                break;
            }
            case ACK:
                Store.apply(c, Engine.opAck(task, me, now), true);
                break;
            case SNOOZE: {
                JSONObject p;
                synchronized (Store.class) { p = Engine.opSnooze(Store.state(c), task, me, now); }
                if (p != null) Store.apply(c, p, true);
                Notif.cancelTask(c, task);
                break;
            }
            case STOP:
                Store.apply(c, Engine.opPause(true, me, now), true);
                break;
            case RESUME:
                Store.apply(c, Engine.opPause(false, me, now), true);
                break;
            default:
                tick(c, now);
        }
        CoreService.start(c);
    }

    static void tick(Context c, long now) {
        // timer finished?
        long ends = Store.getLong(c, "timerEnds", 0);
        if (ends > 0 && now >= ends) {
            String id = Store.get(c, "timerTask", "");
            Store.putLong(c, "timerEnds", 0);
            JSONObject p;
            synchronized (Store.class) { p = Engine.opComplete(Store.state(c), id, "full", Store.deviceId(c), now); }
            Store.apply(c, p, true);
            JSONObject t = Store.state(c).optJSONObject("tasks") != null ? Store.state(c).optJSONObject("tasks").optJSONObject(id) : null;
            if (t == null && Store.state(c).optJSONObject("todos") != null) t = Store.state(c).optJSONObject("todos").optJSONObject(id);
            Notif.simple(c, "✅ Timer done", (t != null ? t.optString("title") : "Task") + " counts as done.");
        }
        long last = Store.getLong(c, "lastCheck", now - 60000);
        List<Engine.Reminder> rem;
        Engine.Result r;
        synchronized (Store.class) { rem = Engine.dueReminders(Store.state(c), last, now); r = Engine.compute(Store.state(c), now); }
        Store.putLong(c, "lastCheck", now);
        for (Engine.Reminder x : rem) {
            Notif.reminder(c, x.item, x.popup);
            if (x.popup && r.lock == null) BlockerService.showPopup(x.item.id);
        }
        // reminder notes: keep them on screen until dismissed
        if (Notif.notes(c, r.notes)) BlockerService.showNote();
        Sync.retry(c);
        Sync.snapshot(c, false);
        Updater.maybeCheck(c, false);
        Store.onChanged(c);
    }

    // ---- scheduling ----
    static void schedule(Context c, long at) {
        AlarmManager am = c.getSystemService(AlarmManager.class);
        PendingIntent pi = PendingIntent.getBroadcast(c, 10, new Intent(c, AlarmReceiver.class).setAction(TICK), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        boolean exact = Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms();
        if (exact) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        // safety net: wake up at least every 15 minutes
        PendingIntent hb = PendingIntent.getBroadcast(c, 11, new Intent(c, AlarmReceiver.class).setAction(TICK), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        am.setInexactRepeating(AlarmManager.RTC_WAKEUP, System.currentTimeMillis() + 15 * 60000, 15 * 60000, hb);
    }
}
