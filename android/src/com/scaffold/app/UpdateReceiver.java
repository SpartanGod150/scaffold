package com.scaffold.app;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;

/** Result of an update install. If Android wants the user to confirm, show its dialog (or a notification to open it). */
public class UpdateReceiver extends BroadcastReceiver {
    static final int ID = 4242;
    static volatile Intent confirm;

    /** "Install" button in Settings: shows Android's confirm dialog from the open app (always allowed in front). */
    static void openConfirm(Context a) {
        Intent i = confirm; if (i == null) { Updater.maybeCheck(a, true); return; }
        MainActivity m = MainActivity.current.get();
        try { if (m != null) m.startActivity(i); else a.startActivity(i); } catch (Exception e) { Updater.status(a, "error: " + e.getMessage()); }
    }

    @Override public void onReceive(Context ctx, Intent intent) {
        Context c = ctx.getApplicationContext();
        int st = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, -999);
        String v = intent.getStringExtra("version");
        if (st == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirm == null) return;
            confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            UpdateReceiver.confirm = confirm;
            Updater.status(c, "version " + v + " ready: tap Install");
            PendingIntent pi = PendingIntent.getActivity(c, 79, confirm, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            c.getSystemService(NotificationManager.class).notify(ID, new Notification.Builder(c, Notif.CH_REMIND)
                    .setSmallIcon(R.drawable.ic_stat).setContentTitle("⬆️ Scaffold update ready")
                    .setContentText("Tap to install version " + v).setAutoCancel(true).setContentIntent(pi).build());
            BlockerService s = BlockerService.instance;   // an accessibility service may open the dialog right away
            try { if (s != null) s.startActivity(confirm); } catch (Exception ignored) {}
        } else if (st == PackageInstaller.STATUS_SUCCESS) {
            c.getSystemService(NotificationManager.class).cancel(ID); confirm = null;
            Updater.status(c, "updated to " + v);
        } else {
            Updater.status(c, "update failed: " + intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE));
        }
    }
}
