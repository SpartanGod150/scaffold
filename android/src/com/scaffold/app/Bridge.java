package com.scaffold.app;

import android.app.NotificationManager;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;

/** What the shared UI can ask the phone to do. Same method names as the desktop and browser bridges. */
public class Bridge {
    private final MainActivity a;
    Bridge(MainActivity a) { this.a = a; }

    @JavascriptInterface public String platform() { return "android"; }
    @JavascriptInterface public String getState() { return Store.stateJson(a); }

    @JavascriptInterface public String getLaunch() {
        try { JSONObject o = new JSONObject(); o.put("mode", a.mode); o.put("task", a.task); return o.toString(); } catch (Exception e) { return "{}"; }
    }

    @JavascriptInterface public String getLocal() {
        try {
            JSONObject o = new JSONObject();
            o.put("platform", "android");
            o.put("deviceId", Store.deviceId(a));
            o.put("deviceName", Store.get(a, "deviceName", "Phone"));
            o.put("syncCode", Store.get(a, "syncCode", ""));
            JSONObject sync = new JSONObject(); sync.put("status", Sync.status); o.put("sync", sync);
            long ends = Store.getLong(a, "timerEnds", 0);
            if (ends > System.currentTimeMillis()) {
                JSONObject t = new JSONObject();
                t.put("taskId", Store.get(a, "timerTask", "")); t.put("endsAt", ends); t.put("minutes", Store.getLong(a, "timerMinutes", 20));
                o.put("timer", t);
            } else o.put("timer", JSONObject.NULL);
            JSONObject p = new JSONObject();
            NotificationManager nm = a.getSystemService(NotificationManager.class);
            p.put("notifications", nm.areNotificationsEnabled());
            p.put("accessibility", Enforcer.accessibilityOn(a));
            p.put("exactAlarm", Build.VERSION.SDK_INT < 31 || a.getSystemService(android.app.AlarmManager.class).canScheduleExactAlarms());
            p.put("fullScreen", Build.VERSION.SDK_INT < 34 || nm.canUseFullScreenIntent());
            p.put("battery", a.getSystemService(PowerManager.class).isIgnoringBatteryOptimizations(a.getPackageName()));
            p.put("grayscale", Enforcer.canGrey(a));
            p.put("installs", Build.VERSION.SDK_INT < 26 || a.getPackageManager().canRequestPackageInstalls());
            o.put("perms", p);
            o.put("version", Updater.version(a));
            JSONObject up = new JSONObject(); up.put("status", Store.get(a, "updStatus", "")); up.put("checked", Math.max(Store.getLong(a, "updChecked", 0), Store.getLong(a, "updAt", 0))); up.put("running", Updater.running()); o.put("update", up);
            return o.toString();
        } catch (Exception e) { return "{}"; }
    }

    @JavascriptInterface public void apply(String patch) {
        try { Store.apply(a, new JSONObject(patch), true); } catch (Exception ignored) {}
    }

    @JavascriptInterface public void startTimer(String id, int minutes) {
        Store.put(a, "timerTask", id);
        Store.putLong(a, "timerMinutes", minutes);
        Store.putLong(a, "timerEnds", System.currentTimeMillis() + minutes * 60000L);
        Notif.cancelTask(a, id);
        Store.onChanged(a);
    }

    @JavascriptInterface public void stopTimer() { Store.putLong(a, "timerEnds", 0); Store.onChanged(a); }

    @JavascriptInterface public void setLocal(String k, String json) {
        try {
            Object v = new JSONArray("[" + json + "]").get(0);
            if ("syncCode".equals(k)) { Store.put(a, "syncCode", String.valueOf(v)); Store.put(a, "since", ""); Sync.start(a); }
            else if ("deviceName".equals(k)) Store.put(a, "deviceName", String.valueOf(v));
            MainActivity.notifyState();
        } catch (Exception ignored) {}
    }

    @JavascriptInterface public void openDialer() {
        try { a.startActivity(new Intent(Intent.ACTION_DIAL)); } catch (Exception e) { a.runOnUiThread(() -> Toast.makeText(a, "No phone app found", Toast.LENGTH_SHORT).show()); }
    }

    @JavascriptInterface public void openApp(String pkg) {
        Intent i = a.getPackageManager().getLaunchIntentForPackage(pkg);
        if (i != null) a.startActivity(i); else a.runOnUiThread(() -> Toast.makeText(a, "App not found", Toast.LENGTH_SHORT).show());
    }

    @JavascriptInterface public void openWhatsApp() {
        PackageManager pm = a.getPackageManager();
        for (String pkg : new String[]{"com.whatsapp", "com.whatsapp.w4b"}) {
            Intent i = pm.getLaunchIntentForPackage(pkg);
            if (i != null) { a.startActivity(i); return; }
        }
        a.runOnUiThread(() -> Toast.makeText(a, "WhatsApp is not installed", Toast.LENGTH_SHORT).show());
    }

    @JavascriptInterface public void closeWindow() {
        a.runOnUiThread(() -> { if ("remind".equals(a.mode) || "block".equals(a.mode) || "note".equals(a.mode)) a.finish(); else a.moveTaskToBack(true); });
    }

    @JavascriptInterface public void openPermission(String name) {
        Uri pkg = Uri.parse("package:" + a.getPackageName());
        Intent i;
        switch (name) {
            case "accessibility": i = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS); break;
            case "notifications": i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, a.getPackageName()); break;
            case "exactAlarm": i = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, pkg); break;
            case "fullScreen": i = Build.VERSION.SDK_INT >= 34 ? new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, pkg) : new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkg); break;
            case "battery": i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, pkg); break;
            case "installs": i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, pkg); break;
            default: i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkg);
        }
        try { a.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); }
        catch (Exception e) { a.startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkg).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); }
    }

    @JavascriptInterface public String listApps() {
        PackageManager pm = a.getPackageManager();
        List<ResolveInfo> ris = pm.queryIntentActivities(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), 0);
        List<String[]> apps = new ArrayList<>();
        HashSet<String> seen = new HashSet<>();
        for (ResolveInfo ri : ris) {
            String p = ri.activityInfo.packageName;
            if (p.equals(a.getPackageName()) || Enforcer.ALWAYS.contains(p) || !seen.add(p)) continue;
            apps.add(new String[]{p, String.valueOf(ri.loadLabel(pm))});
        }
        Collections.sort(apps, (x, y) -> x[1].compareToIgnoreCase(y[1]));
        JSONArray out = new JSONArray();
        try { for (String[] x : apps) { JSONObject o = new JSONObject(); o.put("pkg", x[0]); o.put("label", x[1]); out.put(o); } } catch (Exception ignored) {}
        return out.toString();
    }

    @JavascriptInterface public void test(String k) {
        if ("remind".equals(k)) Notif.testReminder(a);
        if ("update".equals(k)) Updater.maybeCheck(a, true);
        if ("install".equals(k)) UpdateReceiver.openConfirm(a);
    }
}
