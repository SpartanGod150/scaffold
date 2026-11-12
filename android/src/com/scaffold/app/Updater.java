package com.scaffold.app;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;

/** Auto-update: checks the GitHub repo's latest release, downloads Scaffold.apk, checks its SHA-256,
 *  and installs it with PackageInstaller (silent when Android allows it, otherwise one tap). Never during a lock. */
public final class Updater {
    static final String ASSET = "Scaffold.apk";
    static final long EVERY = 15 * 60_000L;
    private static volatile boolean busy;

    static String version(Context c) {
        try { return c.getPackageManager().getPackageInfo(c.getPackageName(), 0).versionName; } catch (Exception e) { return "?"; }
    }

    static void maybeCheck(Context c, boolean manual) {
        long now = System.currentTimeMillis();
        if (busy || (!manual && now - Store.getLong(c, "updChecked", 0) < EVERY)) { installIfSafe(c); return; }
        busy = true;
        Store.putLong(c, "updChecked", now);
        final Context app = c.getApplicationContext();
        new Thread(() -> { try { run(app); } finally { busy = false; } }).start();
    }

    static void status(Context c, String s) { Store.put(c, "updStatus", s); MainActivity.notifyState(); }

    private static void run(Context c) {
        status(c, "checking…");
        try {
            String repo = new JSONObject(new String(read(c.getAssets().open("ui/update.json")), "UTF-8")).optString("repo", "");
            if (repo.isEmpty()) { status(c, "no update source set"); return; }
            JSONObject rel = new JSONObject(new String(get("https://api.github.com/repos/" + repo + "/releases/latest"), "UTF-8"));
            String latest = rel.optString("tag_name", "").replaceFirst("^v", "");
            if (latest.isEmpty() || !newer(latest, version(c))) { status(c, "up to date"); return; }
            String apkUrl = null, sumsUrl = null;
            JSONArray as = rel.optJSONArray("assets");
            for (int i = 0; as != null && i < as.length(); i++) {
                JSONObject a = as.getJSONObject(i);
                if (ASSET.equals(a.optString("name"))) apkUrl = a.optString("browser_download_url");
                if ("SHA256SUMS.txt".equals(a.optString("name"))) sumsUrl = a.optString("browser_download_url");
            }
            if (apkUrl == null || sumsUrl == null) { status(c, "error: release " + latest + " has no " + ASSET); return; }
            String want = "";
            for (String line : new String(get(sumsUrl), "UTF-8").split("\n")) if (line.trim().endsWith(ASSET)) want = line.trim().split("\\s+")[0];
            byte[] apk = get(apkUrl);
            if (!want.equalsIgnoreCase(sha256(apk))) { status(c, "error: checksum mismatch for " + latest); return; }
            File f = new File(c.getFilesDir(), "update.apk");
            try (OutputStream o = new FileOutputStream(f)) { o.write(apk); }
            Store.put(c, "updFile", f.getAbsolutePath());
            Store.put(c, "updVersion", latest);
            status(c, "version " + latest + " downloaded, installs when nothing is locked");
            installIfSafe(c);
        } catch (Exception e) { status(c, "error: " + e.getMessage()); }
    }

    /** Hands the downloaded APK to Android, unless a lock or timer is running. */
    static synchronized void installIfSafe(Context c) {
        String path = Store.get(c, "updFile", "");
        if (path.isEmpty()) return;
        File f = new File(path);
        if (!f.exists()) { Store.put(c, "updFile", ""); return; }
        Engine.Result r = Store.now(c);
        if (r.lock != null || Store.getLong(c, "timerEnds", 0) > System.currentTimeMillis()) return;
        try {
            PackageInstaller pi = c.getPackageManager().getPackageInstaller();
            PackageInstaller.SessionParams p = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
            p.setAppPackageName(c.getPackageName());
            if (Build.VERSION.SDK_INT >= 31) p.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
            int id = pi.createSession(p);
            try (PackageInstaller.Session s = pi.openSession(id)) {
                try (InputStream in = new FileInputStream(f); OutputStream out = s.openWrite("scaffold", 0, f.length())) {
                    byte[] buf = new byte[65536]; int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                    s.fsync(out);
                }
                Intent i = new Intent(c, UpdateReceiver.class).putExtra("version", Store.get(c, "updVersion", ""));
                int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
                s.commit(PendingIntent.getBroadcast(c, 77, i, flags).getIntentSender());
            }
            Store.put(c, "updFile", "");
            status(c, "installing version " + Store.get(c, "updVersion", "") + "…");
        } catch (Exception e) { status(c, "error installing: " + e.getMessage()); }
    }

    static boolean newer(String a, String b) {
        String[] x = a.split("\\."), y = b.split("\\.");
        for (int i = 0; i < 3; i++) {
            int p = i < x.length ? parse(x[i]) : 0, q = i < y.length ? parse(y[i]) : 0;
            if (p != q) return p > q;
        }
        return false;
    }
    private static int parse(String s) { try { return Integer.parseInt(s.replaceAll("[^0-9]", "")); } catch (Exception e) { return 0; } }

    static byte[] get(String url) throws Exception {
        for (int hop = 0; hop < 6; hop++) {
            HttpURLConnection h = (HttpURLConnection) new URL(url).openConnection();
            h.setInstanceFollowRedirects(false);
            h.setConnectTimeout(20000); h.setReadTimeout(120000);
            h.setRequestProperty("User-Agent", "scaffold-updater");
            h.setRequestProperty("Accept", "application/octet-stream, application/json");
            int code = h.getResponseCode();
            if (code >= 300 && code < 400 && h.getHeaderField("Location") != null) { url = new URL(new URL(url), h.getHeaderField("Location")).toString(); h.disconnect(); continue; }
            if (code != 200) { h.disconnect(); throw new Exception("HTTP " + code); }
            try (InputStream in = h.getInputStream()) { return read(in); } finally { h.disconnect(); }
        }
        throw new Exception("too many redirects");
    }

    static byte[] read(InputStream in) throws Exception {
        ByteArrayOutputStream b = new ByteArrayOutputStream(); byte[] buf = new byte[65536]; int n;
        while ((n = in.read(buf)) > 0) b.write(buf, 0, n);
        in.close(); return b.toByteArray();
    }

    static String sha256(byte[] d) throws Exception {
        StringBuilder sb = new StringBuilder();
        for (byte x : MessageDigest.getInstance("SHA-256").digest(d)) sb.append(String.format("%02x", x));
        return sb.toString();
    }
}
