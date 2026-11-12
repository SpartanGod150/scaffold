package com.scaffold.app;

import android.content.Context;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.ArrayDeque;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.zip.Deflater;
import java.util.zip.Inflater;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/** Same wire format as desktop/sync.js: ntfy.sh relay, deflate + AES-256-GCM with a key from the sync code. */
public final class Sync {
    static final String HOST = "https://ntfy.sh/";
    static final int MAX_MSG = 3800;
    private static Thread thread;
    private static volatile String activeCode = "";
    static volatile String status = "off";
    private static final ExecutorService pub = Executors.newSingleThreadExecutor();
    private static final ArrayDeque<String> outbox = new ArrayDeque<>();

    static String norm(String code) { return code == null ? "" : code.trim().toLowerCase(); }

    static byte[] sha(String s) {
        try { return MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)); }
        catch (Exception e) { throw new RuntimeException(e); }
    }

    static String topic(String code) {
        byte[] h = sha("scaffold-topic:" + norm(code));
        StringBuilder sb = new StringBuilder("scf_");
        for (int i = 0; i < 12; i++) sb.append(String.format("%02x", h[i] & 0xff));
        return sb.toString();
    }

    static String encrypt(String code, JSONObject obj) throws Exception {
        byte[] raw = obj.toString().getBytes(StandardCharsets.UTF_8);
        Deflater d = new Deflater(Deflater.DEFAULT_COMPRESSION, true);
        d.setInput(raw); d.finish();
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        while (!d.finished()) bo.write(buf, 0, d.deflate(buf));
        d.end();
        byte[] iv = new byte[12];
        new SecureRandom().nextBytes(iv);
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(sha("scaffold-key:" + norm(code)), "AES"), new GCMParameterSpec(128, iv));
        byte[] ct = c.doFinal(bo.toByteArray());
        byte[] out = new byte[12 + ct.length];
        System.arraycopy(iv, 0, out, 0, 12);
        System.arraycopy(ct, 0, out, 12, ct.length);
        return Base64.encodeToString(out, Base64.NO_WRAP);
    }

    static JSONObject decrypt(String code, String b64) throws Exception {
        byte[] all = Base64.decode(b64, Base64.DEFAULT);
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE, new SecretKeySpec(sha("scaffold-key:" + norm(code)), "AES"), new GCMParameterSpec(128, all, 0, 12));
        byte[] z = c.doFinal(all, 12, all.length - 12);
        Inflater inf = new Inflater(true);
        byte[] in = new byte[z.length + 1];
        System.arraycopy(z, 0, in, 0, z.length);
        inf.setInput(in);
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        while (!inf.finished()) { int n = inf.inflate(buf); if (n == 0 && (inf.needsInput() || inf.needsDictionary())) break; bo.write(buf, 0, n); }
        inf.end();
        return new JSONObject(new String(bo.toByteArray(), StandardCharsets.UTF_8));
    }

    /** Starts (or restarts, after the code changed) the listening thread. */
    static synchronized void start(Context ctx) {
        final Context c = ctx.getApplicationContext();
        final String code = Store.get(c, "syncCode", "");
        if (code.equals(activeCode) && thread != null && thread.isAlive()) return;
        activeCode = code;
        if (code.isEmpty()) { status = "off"; return; }
        status = "connecting…";
        thread = new Thread(() -> listen(c, code), "scaffold-sync");
        thread.setDaemon(true);
        thread.start();
        Thread g = new Thread(() -> backupLoop(c, code), "scaffold-backup");
        g.setDaemon(true);
        g.start();
        pub.execute(() -> { try { Thread.sleep(4000); } catch (InterruptedException ignored) {} snapshot(c, true); });
    }

    private static void listen(Context c, String code) {
        long backoff = 2000;
        String t = topic(code);
        while (code.equals(activeCode)) {
            HttpURLConnection conn = null;
            try {
                String since = Store.get(c, "since", "");
                if (since.isEmpty()) since = "12h";
                conn = (HttpURLConnection) new URL(HOST + t + "/json?since=" + URLEncoder.encode(since, "UTF-8")).openConnection();
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(100000);
                conn.setRequestProperty("User-Agent", "Scaffold/0.1");
                if (conn.getResponseCode() != 200) throw new Exception("relay error " + conn.getResponseCode());
                status = "connected"; ntfyOk = true;
                MainActivity.notifyState();
                backoff = 2000;
                BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8));
                String line;
                while ((line = br.readLine()) != null && code.equals(activeCode)) handle(c, code, line);
                status = "reconnecting";
                if (ntfyOk) downSince = System.currentTimeMillis();
                ntfyOk = false;
            } catch (Exception e) {
                status = blocked() && gOk ? "connected through Google (main relay blocked here)" : "offline (" + e.getMessage() + ")";
            } finally {
                if (conn != null) conn.disconnect();
            }
            MainActivity.notifyState();
            try { Thread.sleep(backoff); } catch (InterruptedException ignored) {}
            backoff = Math.min(60000, backoff * 2);
        }
    }

    private static void handle(Context c, String code, String line) {
        try {
            if (line.trim().isEmpty()) return;
            JSONObject m = new JSONObject(line);
            if (!"message".equals(m.optString("event")) || !m.has("message")) return;
            Store.put(c, "since", m.getString("id"));
            handleMsg(c, code, m.getString("message"));
        } catch (Exception ignored) {}
    }

    // ---- Google backup mailbox (the calendar script): used while this device can't reach ntfy, or while another device can't ----
    private static volatile boolean ntfyOk = false, gOk = false;
    private static volatile long downSince = System.currentTimeMillis(), othersUntil = 0;
    private static final ArrayDeque<String> gOutbox = new ArrayDeque<>();
    private static volatile long sendBlockedUntil = 0;
    static boolean blocked() { return (!ntfyOk && System.currentTimeMillis() - downSince > 45000) || System.currentTimeMillis() < sendBlockedUntil; }
    static boolean backupActive() { return blocked() || System.currentTimeMillis() < othersUntil; }

    private static String[] relayCfg(Context c) {
        JSONObject cfg = Store.state(c).optJSONObject("cfg"), r = cfg == null ? null : cfg.optJSONObject("relay");
        if (r == null || r.optBoolean("del") || r.optString("url").isEmpty()) return null;
        return new String[]{r.optString("url"), r.optString("secret")};
    }

    private static void backupLoop(Context c, String code) {
        long since = 0, lastPoll = 0, lastPull = 0; boolean wasActive = false;
        while (code.equals(activeCode)) {
            try { Thread.sleep(10000); } catch (InterruptedException ignored) {}
            String[] cfg = relayCfg(c);
            if (cfg == null) continue;
            long now = System.currentTimeMillis();
            boolean active = backupActive();
            if (now - lastPoll >= (active ? 9000 : 30000)) {
                lastPoll = now;
                try {
                    JSONObject req = new JSONObject().put("secret", cfg[1]).put("op", "relay-poll").put("since", since).put("from", Store.deviceId(c)).put("listen", blocked());
                    JSONObject r = gcall(cfg[0], req);
                    gOk = true; since = r.optLong("seq", since);
                    JSONArray ms = r.optJSONArray("msgs");
                    for (int i = 0; ms != null && i < ms.length(); i++) handleMsg(c, code, ms.optString(i));
                    if (r.optInt("listeners", 0) > 0) othersUntil = System.currentTimeMillis() + 120000;
                    if (blocked()) { status = "connected through Google (main relay blocked here)"; MainActivity.notifyState(); }
                } catch (Exception e) { gOk = false; }
                boolean nowActive = backupActive();
                if (nowActive && !wasActive) snapshot(c, true);
                wasActive = nowActive;
            }
            gFlush(cfg);
            if (now - lastPull > 10 * 60_000L) { lastPull = now; pullCalendar(c, cfg); }
        }
    }

    /** This device's own copy of Google Calendar, read through the script (same shape as desktop/calendar.js toGev). */
    private static void pullCalendar(Context c, String[] cfg) {
        try {
            long now = System.currentTimeMillis();
            JSONObject r = gcall(cfg[0], new JSONObject().put("secret", cfg[1]).put("op", "pull").put("from", now - 14 * 86400_000L).put("to", now + 120 * 86400_000L));
            JSONArray evs = r.optJSONArray("events");
            JSONObject todos = Store.state(c).optJSONObject("todos"), gev = new JSONObject();
            for (int i = 0; evs != null && i < evs.length(); i++) {
                JSONObject g = evs.getJSONObject(i);
                String sid = g.optString("sid", "");
                if (!sid.isEmpty() && todos != null && todos.has(sid)) continue;
                boolean rec = g.optBoolean("rec");
                String key = g.optString("gid") + "|" + (rec ? String.valueOf(g.optLong("start")) : "");
                String id = sid.isEmpty() ? "g_" + hashId(key) : sid;
                gev.put(id, new JSONObject().put("id", id).put("gid", g.optString("gid")).put("title", g.optString("title")).put("start", g.optLong("start"))
                        .put("end", g.optLong("end")).put("allDay", g.optBoolean("allDay")).put("ro", rec).put("gupd", g.optLong("upd")));
            }
            Store.prefs(c).edit().putString("gev", gev.toString()).apply();
            MainActivity.notifyState();
        } catch (Exception ignored) {}
    }
    static String hashId(String s) { int h = 0; for (int i = 0; i < s.length(); i++) h = h * 31 + s.charAt(i); return Long.toString(h & 0xffffffffL, 36); }

    private static void gFlush(String[] cfg) {
        JSONArray batch = new JSONArray();
        synchronized (gOutbox) { int n = 0; for (String m : gOutbox) { if (n++ >= 60) break; batch.put(m); } }
        if (batch.length() == 0) return;
        try {
            gcall(cfg[0], new JSONObject().put("secret", cfg[1]).put("op", "relay-post").put("msgs", batch));
            synchronized (gOutbox) { for (int i = 0; i < batch.length(); i++) gOutbox.poll(); }
        } catch (Exception ignored) {}
    }

    /** POST JSON to the Apps Script; it answers with a redirect to the result, fetched with GET. */
    static JSONObject gcall(String url, JSONObject body) throws Exception {
        byte[] data = body.toString().getBytes(StandardCharsets.UTF_8);
        boolean post = true;
        for (int hop = 0; hop < 6; hop++) {
            HttpURLConnection h = (HttpURLConnection) new URL(url).openConnection();
            h.setInstanceFollowRedirects(false); h.setConnectTimeout(20000); h.setReadTimeout(60000);
            if (post) { h.setRequestMethod("POST"); h.setDoOutput(true); h.setRequestProperty("Content-Type", "application/json"); try (OutputStream os = h.getOutputStream()) { os.write(data); } }
            int rc = h.getResponseCode();
            if (rc >= 300 && rc < 400 && h.getHeaderField("Location") != null) { url = new URL(new URL(url), h.getHeaderField("Location")).toString(); post = rc == 307 || rc == 308; h.disconnect(); continue; }
            if (rc != 200) { h.disconnect(); throw new Exception("HTTP " + rc); }
            try (java.io.InputStream in = h.getInputStream()) {
                JSONObject j = new JSONObject(new String(Updater.read(in), StandardCharsets.UTF_8));
                if (j.has("error")) throw new Exception(j.optString("error"));
                return j;
            } finally { h.disconnect(); }
        }
        throw new Exception("too many redirects");
    }

    private static void handleMsg(Context c, String code, String b64) {
        try {
            JSONObject env = decrypt(code, b64);
            if (Store.deviceId(c).equals(env.optString("d"))) return;
            if (env.optInt("s", 0) == 1) Store.putLong(c, "lastSnapSeen", System.currentTimeMillis());
            JSONObject p = env.optJSONObject("p");
            if (p != null) Store.apply(c, p, false);
        } catch (Exception ignored) {
            // not ours, or corrupted: skip
        }
    }

    static void publish(Context ctx, JSONObject patch, boolean isSnap) {
        final Context c = ctx.getApplicationContext();
        final String code = Store.get(c, "syncCode", "");
        if (code.isEmpty()) return;
        pub.execute(() -> {
            try {
                List<JSONObject> parts = Engine.chunks(patch);
                for (JSONObject p : parts) {
                    JSONObject env = new JSONObject();
                    env.put("d", Store.deviceId(c)); env.put("p", p); env.put("s", isSnap ? 1 : 0);
                    String body = encrypt(code, env);
                    if (body.length() <= MAX_MSG) {
                        synchronized (outbox) { outbox.add(body); }
                        if (!isSnap || backupActive()) synchronized (gOutbox) { gOutbox.add(body); }   // live changes always go to Google too
                    }
                }
            } catch (Exception ignored) {}
            flush(code);
        });
    }

    private static void flush(String code) {
        while (true) {
            String body;
            synchronized (outbox) { body = outbox.peek(); }
            if (body == null) return;
            try {
                HttpURLConnection conn = (HttpURLConnection) new URL(HOST + topic(code)).openConnection();
                conn.setRequestMethod("POST");
                conn.setDoOutput(true);
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(15000);
                conn.setRequestProperty("User-Agent", "Scaffold/0.1");
                conn.setRequestProperty("Content-Type", "text/plain");
                try (OutputStream os = conn.getOutputStream()) { os.write(body.getBytes(StandardCharsets.UTF_8)); }
                int rc = conn.getResponseCode();
                String ra = conn.getHeaderField("Retry-After");
                conn.disconnect();
                if (rc == 429) {   // over ntfy's daily limit: the Google mailbox carries our messages meanwhile
                    long wait = 3600_000L; try { wait = Math.min(86400L, Long.parseLong(ra.trim())) * 1000L; } catch (Exception ignored) {}
                    sendBlockedUntil = System.currentTimeMillis() + wait;
                    synchronized (outbox) { synchronized (gOutbox) { gOutbox.addAll(outbox); } outbox.clear(); }
                    return;
                }
                if (rc != 200) return;
                synchronized (outbox) { outbox.poll(); }
            } catch (Exception e) {
                return; // retried on the next publish or heartbeat
            }
        }
    }

    static void retry(Context c) { final String code = Store.get(c, "syncCode", ""); if (!code.isEmpty()) pub.execute(() -> flush(code)); }

    /** Full-state broadcast, so a device that was offline for more than 12h still catches up. */
    static void snapshot(Context c, boolean force) {
        long last = Store.getLong(c, "lastSnapSeen", 0);
        if (!force && System.currentTimeMillis() - last < 5 * 3600_000L + (long) (Math.random() * 3600_000L)) return;
        Store.putLong(c, "lastSnapSeen", System.currentTimeMillis());
        JSONObject snap;
        synchronized (Store.class) { snap = Engine.snapshot(Store.state(c), System.currentTimeMillis()); }
        publish(c, snap, true);
    }
}
