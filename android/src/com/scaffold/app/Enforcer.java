package com.scaffold.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.provider.Settings;
import android.telecom.TelecomManager;
import android.view.inputmethod.InputMethodInfo;
import android.view.inputmethod.InputMethodManager;

import org.json.JSONArray;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/** Decides what is allowed while a lock is on, and applies device-level changes (grey screen). */
public final class Enforcer {
    static final Set<String> ALWAYS = new HashSet<>(Arrays.asList(
            "com.whatsapp", "com.whatsapp.w4b",
            "android", "com.android.systemui", "com.android.settings", "com.samsung.android.settings",
            "com.android.dialer", "com.google.android.dialer", "com.samsung.android.dialer", "com.android.phone",
            "com.samsung.android.incallui", "com.android.incallui", "com.android.server.telecom", "com.android.emergency",
            "com.google.android.permissioncontroller", "com.android.permissioncontroller",
            "com.android.packageinstaller", "com.google.android.packageinstaller",
            "com.sec.android.app.clockpackage", "com.google.android.deskclock", "com.android.deskclock",
            "com.sec.android.app.launcher", "com.google.android.apps.nexuslauncher", "com.android.launcher3",
            "com.samsung.android.honeyboard", "com.google.android.inputmethod.latin",
            "com.samsung.android.app.cocktailbarservice", "com.samsung.android.app.aodservice"));

    private static Set<String> dynamic;

    private static Set<String> homes;

    /** The home screen (and Samsung's recent-apps screen, which belongs to it) is covered during a lock. */
    static boolean isHome(Context c, String pkg) {
        if (homes == null) {
            Set<String> s = new HashSet<>(Arrays.asList("com.sec.android.app.launcher", "com.google.android.apps.nexuslauncher", "com.android.launcher3"));
            try { for (ResolveInfo ri : c.getPackageManager().queryIntentActivities(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME), 0)) s.add(ri.activityInfo.packageName); } catch (Exception ignored) {}
            s.remove(c.getPackageName()); s.remove("android");
            homes = s;
        }
        return homes.contains(pkg);
    }

    /** Unblockable apps until the user sets the list: WhatsApp, the phone app and Scaffold. */
    static JSONArray preset(Context c) {
        JSONArray a = new JSONArray().put("com.whatsapp").put("com.whatsapp.w4b").put(c.getPackageName());
        try { TelecomManager tm = (TelecomManager) c.getSystemService(Context.TELECOM_SERVICE); if (tm != null && tm.getDefaultDialerPackage() != null) a.put(tm.getDefaultDialerPackage()); } catch (Exception ignored) {}
        return a;
    }

    /** May this app be in front while the mode runs? A deadline lock (Full Lock by default) also covers the home screen. */
    static boolean allowed(Context c, String pkg, Engine.Active act) {
        if (act == null || pkg == null) return true;
        if (isHome(c, pkg)) return !"lock".equals(act.src);
        if (pkg.equals(c.getPackageName()) || ALWAYS.contains(pkg)) return true;
        if (dynamic == null) dynamic = resolveDynamic(c);
        if (dynamic.contains(pkg)) return true;
        return !Engine.appBlocked(Store.state(c), act, Store.deviceId(c), pkg, preset(c));
    }

    /** Home screen, default dialer and keyboards on this particular phone. */
    private static Set<String> resolveDynamic(Context c) {
        Set<String> s = new HashSet<>();
        PackageManager pm = c.getPackageManager();
        try {
            for (ResolveInfo ri : pm.queryIntentActivities(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME), 0)) s.add(ri.activityInfo.packageName);
        } catch (Exception ignored) {}
        try {
            TelecomManager tm = (TelecomManager) c.getSystemService(Context.TELECOM_SERVICE);
            if (tm != null && tm.getDefaultDialerPackage() != null) s.add(tm.getDefaultDialerPackage());
        } catch (Exception ignored) {}
        try {
            InputMethodManager im = (InputMethodManager) c.getSystemService(Context.INPUT_METHOD_SERVICE);
            if (im != null) for (InputMethodInfo i : im.getEnabledInputMethodList()) s.add(i.getPackageName());
        } catch (Exception ignored) {}
        return s;
    }

    static void forgetDynamic() { dynamic = null; homes = null; }

    /** Called whenever state or time changes. */
    static void evaluate(Context c) {
        Engine.Result r = Store.now(c);
        boolean locked = r.lock != null;
        setGrey(c, locked);
        if (locked || Store.mode(c) != null) Blocker.recheck(c);
    }

    static boolean canGrey(Context c) {
        return c.checkSelfPermission(Manifest.permission.WRITE_SECURE_SETTINGS) == PackageManager.PERMISSION_GRANTED;
    }

    /** Optional: grey screen during locks. Only touches the setting if we were the ones who turned it on. */
    static void setGrey(Context c, boolean on) {
        if (!canGrey(c)) return;
        boolean ours = Store.prefs(c).getBoolean("greyByUs", false);
        try {
            if (on && !ours) {
                if (Settings.Secure.getInt(c.getContentResolver(), "accessibility_display_daltonizer_enabled", 0) == 1) return; // user's own setting: leave it
                Settings.Secure.putInt(c.getContentResolver(), "accessibility_display_daltonizer", 0);
                Settings.Secure.putInt(c.getContentResolver(), "accessibility_display_daltonizer_enabled", 1);
                Store.prefs(c).edit().putBoolean("greyByUs", true).apply();
            } else if (!on && ours) {
                Settings.Secure.putInt(c.getContentResolver(), "accessibility_display_daltonizer_enabled", 0);
                Store.prefs(c).edit().putBoolean("greyByUs", false).apply();
            }
        } catch (Exception ignored) {}
    }

}
