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

    static final long LIMIT = 3 * 60_000L;          // a whole check (with download) never takes longer than this
    private static volatile long runId = 0, runStarted = 0;
    private static volatile HttpURLConnection current;

    /** True while a check is really running (a stuck one stops counting after LIMIT). */
    static boolean running() { return runStarted > 0 && System.currentTimeMillis() - runStarted < LIMIT + 10_000; }

    static void maybeCheck(Context c, boolean manual) {
        long now = System.currentTimeMillis();
        if (running()) { installIfSafe(c); MainActivity.notifyState(); return; }
        if (!manual && now - Store.getLong(c, "updChecked", 0) < EVERY) { installIfSafe(c); return; }
        final long id = ++runId; runStarted = now;
        Store.putLong(c, "updChecked", now);
        final Context app = c.getApplicationContext();
        Thread t = new Thread(() -> {
            try { run(app, id); }
            catch (Throwable e) { st(app, id, "error: " + e.getMessage()); }
            finally { if (id == runId) { runStarted = 0; MainActivity.notifyState(); } }
        }, "scaffold-update");
        t.setDaemon(true); t.start();
        // Hard time limit: if the network hangs, cut the connection and say so.
        Thread dog = new Thread(() -> {
            try { Thread.sleep(LIMIT); } catch (InterruptedException ignored) {}
            if (id == runId && runStarted > 0) {
                HttpURLConnection h = current; if (h != null) try { h.disconnect(); } catch (Exception ignored) {}
                st(app, id, "error: no answer from GitHub (network too slow or blocked)");
                runStarted = 0; runId++; MainActivity.notifyState();
            }
        }, "scaffold-update-dog");
        dog.setDaemon(true); dog.start();
    }

    static void status(Context c, String s) { Store.put(c, "updStatus", s); Store.putLong(c, "updAt", System.currentTimeMillis()); MainActivity.notifyState(); }
    private static void st(Context c, long id, String s) { if (id == runId) status(c, s); }

    /** Latest version tag. Uses github.com's own redirect (no API rate limit), with the API as a fallback. */
    private static String latestTag(String repo) throws Exception {
        try {
            HttpURLConnection h = open("https://github.com/" + repo + "/releases/latest");
            try {
                int code = h.getResponseCode(); String loc = h.getHeaderField("Location");
                if (code >= 300 && code < 400 && loc != null && loc.contains("/tag/")) return loc.substring(loc.lastIndexOf("/tag/") + 5).replaceFirst("^v", "");
            } finally { h.disconnect(); }
        } catch (Exception ignored) {}
        return new JSONObject(new String(get("https://api.github.com/repos/" + repo + "/releases/latest", null), "UTF-8")).optString("tag_name", "").replaceFirst("^v", "");
    }

    private static void run(Context c, long id) throws Exception {
        st(c, id, "checking…");
        String repo = new JSONObject(new String(read(c.getAssets().open("ui/update.json")), "UTF-8")).optString("repo", "");
        if (repo.isEmpty()) { st(c, id, "no update source set"); return; }
        String latest = latestTag(repo);
        if (latest.isEmpty() || !newer(latest, version(c))) { st(c, id, "up to date"); return; }
        String dl = "https://github.com/" + repo + "/releases/download/v" + latest + "/";
        st(c, id, "downloading version " + latest + ": 0%");
        String want = "";
        for (String line : new String(get(dl + "SHA256SUMS.txt", null), "UTF-8").split("\n")) if (line.trim().endsWith(ASSET)) want = line.trim().split("\\s+")[0];
        if (want.isEmpty()) { st(c, id, "error: release " + latest + " has no " + ASSET); return; }
        final int[] shown = {0};
        byte[] apk = get(dl + ASSET, (f) -> { int p = (int) (f * 100); if (p >= shown[0] + 10) { shown[0] = p; st(c, id, "downloading version " + latest + ": " + p + "%"); } });
        if (id != runId) return;
        if (!want.equalsIgnoreCase(sha256(apk))) { st(c, id, "error: checksum mismatch for " + latest); return; }
        File f = new File(c.getFilesDir(), "update.apk");
        try (OutputStream o = new FileOutputStream(f)) { o.write(apk); }
        Store.put(c, "updFile", f.getAbsolutePath());
        Store.put(c, "updVersion", latest);
        st(c, id, "version " + latest + " downloaded, installs when nothing is locked");
        installIfSafe(c);
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

    interface Progress { void on(double f); }

    private static HttpURLConnection open(String url) throws Exception {
        HttpURLConnection h = (HttpURLConnection) new URL(url).openConnection();
        h.setInstanceFollowRedirects(false);
        h.setConnectTimeout(15000); h.setReadTimeout(30000);
        h.setRequestProperty("User-Agent", "scaffold-updater");
        h.setRequestProperty("Accept", "application/octet-stream, application/json");
        current = h;
        return h;
    }

    static byte[] get(String url, Progress pr) throws Exception {
        for (int hop = 0; hop < 6; hop++) {
            HttpURLConnection h = open(url);
            int code = h.getResponseCode();
            if (code >= 300 && code < 400 && h.getHeaderField("Location") != null) { url = new URL(new URL(url), h.getHeaderField("Location")).toString(); h.disconnect(); continue; }
            if (code != 200) { h.disconnect(); throw new Exception("HTTP " + code); }
            long total = h.getContentLength();
            try (InputStream in = h.getInputStream()) {
                ByteArrayOutputStream b = new ByteArrayOutputStream(); byte[] buf = new byte[16384]; int n; long got = 0;
                while ((n = in.read(buf)) > 0) { b.write(buf, 0, n); got += n; if (pr != null && total > 0) pr.on((double) got / total); }
                return b.toByteArray();
            } finally { h.disconnect(); }
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
