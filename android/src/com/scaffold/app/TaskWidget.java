package com.scaffold.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.view.View;
import android.widget.RemoteViews;

/** Home-screen widget: today's progress and the next three tasks, with one-tap Done. */
public class TaskWidget extends AppWidgetProvider {
    static final int[] ROWS = {R.id.row1, R.id.row2, R.id.row3};
    static final int[] TITLES = {R.id.title1, R.id.title2, R.id.title3};
    static final int[] SUBS = {R.id.sub1, R.id.sub2, R.id.sub3};
    static final int[] BTNS = {R.id.btn1, R.id.btn2, R.id.btn3};

    @Override public void onUpdate(Context c, AppWidgetManager m, int[] ids) { render(c, m, ids); }

    static void updateAll(Context c) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        int[] ids = m.getAppWidgetIds(new ComponentName(c, TaskWidget.class));
        if (ids.length > 0) render(c, m, ids);
    }

    static void render(Context c, AppWidgetManager m, int[] ids) { m.updateAppWidget(ids, build(c)); }

    static RemoteViews build(Context c) {
        Engine.Result r = Store.now(c);
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget);
        String head = r.paused ? "Scaffold is OFF" : r.lock != null ? "🔒 " + r.lock.task.optString("title") : r.done + " / " + r.total + " done today";
        v.setTextViewText(R.id.head, head);
        v.setProgressBar(R.id.progress, Math.max(1, r.total), r.done, false);
        v.setOnClickPendingIntent(R.id.head, Notif.open(c, "main", "", 50));
        int shown = 0;
        for (Engine.Item it : r.items) {
            if (it.done || shown >= 3) continue;
            v.setViewVisibility(ROWS[shown], View.VISIBLE);
            v.setTextViewText(TITLES[shown], it.task.optString("emoji") + "  " + it.task.optString("title"));
            String sub = "upcoming".equals(it.status) ? "from " + Notif.hm(it.start) : "open".equals(it.status) ? "by " + Notif.hm(it.due) : "late · was due " + Notif.hm(it.due);
            if (it.locked) sub = "🔒 locked · " + sub;
            v.setTextViewText(SUBS[shown], sub);
            boolean timer = "timer".equals(it.task.optString("kind"));
            v.setTextViewText(BTNS[shown], timer ? "▶" : "✓");
            PendingIntent pi = timer ? Notif.open(c, "remind", it.id, 60 + shown) : Notif.action(c, AlarmReceiver.DONE, it.id, 70 + shown);
            v.setOnClickPendingIntent(BTNS[shown], pi);
            v.setOnClickPendingIntent(ROWS[shown], Notif.open(c, "remind", it.id, 80 + shown));
            shown++;
        }
        for (int i = shown; i < 3; i++) v.setViewVisibility(ROWS[i], View.GONE);
        v.setViewVisibility(R.id.empty, shown == 0 ? View.VISIBLE : View.GONE);
        v.setTextViewText(R.id.empty, r.total == 0 ? "Nothing scheduled today" : "All done for today 🎉");
        return v;
    }
}
