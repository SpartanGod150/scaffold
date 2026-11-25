package com.scaffold.app;

import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

/** Keeps Scaffold alive in the background: the status notification and the sync connection. */
public class CoreService extends Service {
    static volatile boolean running;
    private final android.os.Handler beat = new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable beatRun = new Runnable() { @Override public void run() { Store.heartbeat(CoreService.this); beat.postDelayed(this, 6 * 3600 * 1000L); } };

    @Override public void onCreate() {
        super.onCreate();
        Notif.channels(this);
        if (Build.VERSION.SDK_INT >= 34) startForeground(Notif.ID_STATUS, Notif.status(this), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(Notif.ID_STATUS, Notif.status(this));
        running = true;
        Sync.start(this);
        Blocker.start(this);
        Scheduler.reschedule(this);
        beat.postDelayed(beatRun, 30000);
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) { Sync.start(this); return START_STICKY; }
    @Override public void onDestroy() { running = false; beat.removeCallbacks(beatRun); super.onDestroy(); }
    @Override public IBinder onBind(Intent intent) { return null; }

    static void start(Context c) {
        try { c.startForegroundService(new Intent(c, CoreService.class)); } catch (Exception ignored) {}
    }

    static void refresh(Context c) {
        if (!running) return;
        try { c.getSystemService(NotificationManager.class).notify(Notif.ID_STATUS, Notif.status(c)); } catch (Exception ignored) {}
    }
}
