package com.scaffold.app;

import android.content.Context;
import android.util.Base64;

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
                status = "connected";
                MainActivity.notifyState();
                backoff = 2000;
                BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8));
                String line;
                while ((line = br.readLine()) != null && code.equals(activeCode)) handle(c, code, line);
                status = "reconnecting";
            } catch (Exception e) {
                status = "offline (" + e.getMessage() + ")";
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
            JSONObject env = decrypt(code, m.getString("message"));
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
                    if (body.length() <= MAX_MSG) synchronized (outbox) { outbox.add(body); }
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
                conn.disconnect();
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
