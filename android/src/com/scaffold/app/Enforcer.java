package com.scaffold.app;

import android.Manifest;
import android.content.ComponentName;
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

    static boolean allowed(Context c, String pkg, Engine.Item lock) {
        if (pkg == null || pkg.equals(c.getPackageName()) || ALWAYS.contains(pkg)) return true;
        if (dynamic == null) dynamic = resolveDynamic(c);
        if (dynamic.contains(pkg)) return true;
        JSONArray extra = lock.task.optJSONArray("allowApps");
        if (extra != null) for (int i = 0; i < extra.length(); i++) if (pkg.equals(extra.optString(i))) return true;
        return false;
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

    static void forgetDynamic() { dynamic = null; }

    /** Called whenever state or time changes. */
    static void evaluate(Context c) {
        Engine.Result r = Store.now(c);
        boolean locked = r.lock != null;
        setGrey(c, locked);
        if (locked) BlockerService.recheck();
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

    static boolean accessibilityOn(Context c) {
        String s = Settings.Secure.getString(c.getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        if (s == null) return false;
        String me = new ComponentName(c, BlockerService.class).flattenToString();
        for (String part : s.split(":")) if (part.equalsIgnoreCase(me) || part.equalsIgnoreCase(c.getPackageName() + "/.BlockerService")) return true;
        return false;
    }
}
