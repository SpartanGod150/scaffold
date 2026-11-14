package com.scaffold.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public final class Notif {
    static final String CH_STATUS = "status", CH_REMIND = "remind", CH_URGENT = "urgent";
    static final int ID_STATUS = 1;

    static void channels(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        NotificationChannel s = new NotificationChannel(CH_STATUS, "Status (always on)", NotificationManager.IMPORTANCE_LOW);
        s.setShowBadge(false);
        NotificationChannel r = new NotificationChannel(CH_REMIND, "Reminders", NotificationManager.IMPORTANCE_HIGH);
        r.enableVibration(true);
        r.setVibrationPattern(new long[]{0, 300, 200, 300});
        NotificationChannel u = new NotificationChannel(CH_URGENT, "Deadlines and pop-ups", NotificationManager.IMPORTANCE_HIGH);
        u.enableVibration(true);
        u.setVibrationPattern(new long[]{0, 600, 250, 600, 250, 600});
        u.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM), new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build());
        nm.createNotificationChannel(s);
        nm.createNotificationChannel(r);
        nm.createNotificationChannel(u);
    }

    static String hm(long t) { return new SimpleDateFormat("HH:mm", Locale.US).format(new Date(t)); }

    static PendingIntent action(Context c, String action, String taskId, int req) {
        Intent i = new Intent(c, AlarmReceiver.class).setAction(action).putExtra("task", taskId);
        return PendingIntent.getBroadcast(c, req, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static PendingIntent open(Context c, String mode, String taskId, int req) {
        Intent i = new Intent(c, MainActivity.class).putExtra("mode", mode).putExtra("task", taskId)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(c, req, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static Notification status(Context c) {
        Engine.Result r = Store.now(c);
        String title, text;
        if (r.paused) { title = "Scaffold is OFF on all devices"; text = "Tap Resume to turn it back on."; }
        else if (r.lock != null) { title = "🔒 Locked: " + r.lock.task.optString("title"); text = "Do it to unlock your devices."; }
        else {
            Engine.Item next = null;
            for (Engine.Item it : r.items) if (!it.done) { next = it; break; }
            title = r.done + " of " + r.total + " done today";
            text = next == null ? (r.total > 0 ? "All done 🎉" : "Nothing scheduled today") : "Next: " + next.task.optString("emoji") + " " + next.task.optString("title") + " by " + hm(next.due);
        }
        Notification.Builder b = new Notification.Builder(c, CH_STATUS)
                .setSmallIcon(R.drawable.ic_stat).setContentTitle(title).setContentText(text)
                .setOngoing(true).setShowWhen(false).setContentIntent(open(c, "main", "", 1));
        if (r.paused) b.addAction(new Notification.Action.Builder(null, "▶ Resume", action(c, AlarmReceiver.RESUME, "", 2)).build());
        else b.addAction(new Notification.Action.Builder(null, "⛔ Stop all devices", action(c, AlarmReceiver.STOP, "", 3)).build());
        return b.build();
    }

    static void reminder(Context c, Engine.Item it, boolean popup) {
        String when = "upcoming".equals(it.status) ? "Starts " + hm(it.start) : "open".equals(it.status) ? "Due " + hm(it.due) : "Late · deadline was " + hm(it.due);
        if (it.task.optInt("level", 1) == 3 && !"late".equals(it.status)) when += " · devices lock at " + hm(it.due);
        int id = 1000 + Math.abs(it.id.hashCode() % 100000);
        Notification.Builder b = new Notification.Builder(c, popup ? CH_URGENT : CH_REMIND)
                .setSmallIcon(R.drawable.ic_stat)
                .setContentTitle(it.task.optString("emoji") + " " + it.task.optString("title"))
                .setContentText(when)
                .setCategory(Notification.CATEGORY_REMINDER)
                .setAutoCancel(true)
                .setContentIntent(open(c, "remind", it.id, id));
        if ("timer".equals(it.task.optString("kind")))
            b.addAction(new Notification.Action.Builder(null, "▶ Start timer", open(c, "remind", it.id, id + 1)).build());
        else b.addAction(new Notification.Action.Builder(null, "✓ Done", action(c, AlarmReceiver.DONE, it.id, id + 2)).build());
        if (it.snoozesLeft > 0) b.addAction(new Notification.Action.Builder(null, "⏸ " + Engine.SNOOZE_MIN + " min", action(c, AlarmReceiver.SNOOZE, it.id, id + 3)).build());
        if (popup) b.setFullScreenIntent(open(c, "remind", it.id, id + 4), true);
        c.getSystemService(NotificationManager.class).notify(id, b.build());
    }

    static void testReminder(Context c) {
        Engine.Result r = Store.now(c);
        Engine.Item it = null;
        for (Engine.Item x : r.items) if (!x.done) { it = x; break; }
        if (it == null) { simple(c, "🧪 Test reminder", "Notifications work. Add a task to test pop-ups."); return; }
        reminder(c, it, true);
        if (r.lock == null) BlockerService.showPopup(it.id);
    }

    /** One ongoing, full-screen notification per waiting note; cleared once dismissed anywhere. */
    /** Returns true when a note just popped (so the caller can bring it on screen). */
    static boolean notes(Context c, java.util.List<Engine.Note> notes) {
        boolean anyFresh = false;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        java.util.Set<Integer> live = new java.util.HashSet<>();
        for (Engine.Note n : notes) {
            int id = 300000 + Math.abs(n.id.hashCode() % 100000);
            live.add(id);
            String shown = Store.get(c, "noteShown_" + n.id, "");
            boolean fresh = !shown.equals(String.valueOf(n.since));
            Notification.Builder b = new Notification.Builder(c, CH_URGENT)
                    .setSmallIcon(R.drawable.ic_stat).setContentTitle("📌 " + firstLine(n.note.optString("text")))
                    .setContentText("Note · tap to read and dismiss").setOngoing(true).setOnlyAlertOnce(!fresh)
                    .setCategory(Notification.CATEGORY_REMINDER).setContentIntent(open(c, "note", n.id, id))
                    .setFullScreenIntent(open(c, "note", n.id, id + 1), true);
            nm.notify(id, b.build());
            if (fresh) { Store.put(c, "noteShown_" + n.id, String.valueOf(n.since)); anyFresh = true; }
        }
        String prev = Store.get(c, "noteIds", "");
        for (String s : prev.split(",")) { if (s.isEmpty()) continue; int id = Integer.parseInt(s); if (!live.contains(id)) nm.cancel(id); }
        StringBuilder sb = new StringBuilder();
        for (int id : live) sb.append(id).append(',');
        Store.put(c, "noteIds", sb.toString());
        return anyFresh;
    }

    static String firstLine(String s) { String l = Engine.plainNote(s).split("\n")[0]; return l.length() > 60 ? l.substring(0, 60) + "…" : l; }

    static void simple(Context c, String title, String text) {
        c.getSystemService(NotificationManager.class).notify((int) (System.currentTimeMillis() % 100000) + 200000,
                new Notification.Builder(c, CH_REMIND).setSmallIcon(R.drawable.ic_stat).setContentTitle(title).setContentText(text).setAutoCancel(true).setContentIntent(open(c, "main", "", 4)).build());
    }

    static void cancelTask(Context c, String taskId) {
        c.getSystemService(NotificationManager.class).cancel(1000 + Math.abs(taskId.hashCode() % 100000));
    }
}
