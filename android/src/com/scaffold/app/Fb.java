package com.scaffold.app;

import android.content.Context;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.List;

/** Firebase Realtime Database channel (same layout as desktop/firebase.js): the main sync path once its address is in
 *  the shared state (cfg.fb.url). New messages are pushed over a streaming connection within about a second. */
public final class Fb {
    static final String DEFAULT = "https://scaffold-sync-default-rtdb.firebaseio.com";
    static volatile boolean ok = false;
    private static volatile String activeBase = "";
    private static final ArrayDeque<String> outbox = new ArrayDeque<>();
    private static final LinkedHashSet<String> seen = new LinkedHashSet<>();
    private static Thread listener, sender;
    // Some networks hold back streaming answers (the connection opens, nothing comes through). Then Scaffold asks
    // Firebase every few seconds for 15 min instead, and tries the stream again after that (same as desktop/firebase.js).
    private static volatile long pollUntil = 0;
    private static final ArrayList<Long> drops = new ArrayList<>();
    private static void toPolling() { if (System.currentTimeMillis() >= pollUntil) pollUntil = System.currentTimeMillis() + 15 * 60_000L; }
    private static synchronized void dropped(long lived) {
        long now = System.currentTimeMillis();
        if (lived < 120_000) drops.add(now);
        for (Iterator<Long> it = drops.iterator(); it.hasNext(); ) if (now - it.next() > 600_000) it.remove();
        if (drops.size() >= 3) { drops.clear(); toPolling(); }
    }
    private static String query(long since) throws Exception { return "?orderBy=" + URLEncoder.encode("\"t\"", "UTF-8") + "&startAt=" + since; }
    /** One look at the new messages (polling mode). */
    private static void pollOnce(Context c, String b, String code) throws Exception {
        long since = Math.max(Store.getLong(c, "fbSince", 0), System.currentTimeMillis() - 12 * 3600_000L) - 2000;
        HttpURLConnection h = (HttpURLConnection) new URL(path(b, code, query(since))).openConnection();
        try {
            h.setConnectTimeout(20000); h.setReadTimeout(30000);
            if (h.getResponseCode() != 200) throw new Exception("Firebase " + h.getResponseCode());
            String body; try (InputStream in = h.getInputStream()) { body = new String(Updater.read(in), StandardCharsets.UTF_8).trim(); }
            if (!ok) { ok = true; Sync.status = "connected (Firebase, checking every few seconds: this network holds back live updates)"; MainActivity.notifyState(); }
            if (body.startsWith("{")) event(c, code, "put", new JSONObject().put("path", "/").put("data", new JSONObject(body)).toString());
        } finally { h.disconnect(); }
    }

    static String base(Context c) {
        JSONObject cfg = Store.state(c).optJSONObject("cfg"), f = cfg == null ? null : cfg.optJSONObject("fb");
        String u = f == null || f.optBoolean("del") ? "" : f.optString("url", "");
        return (u.isEmpty() ? DEFAULT : u).replaceAll("/+$", "");   // built-in sync unless the shared settings name another
    }

    /** Starts or restarts the listener when the address or sync code changes. Called often; cheap when nothing changed. */
    static synchronized void ensure(Context ctx, String code) {
        final Context c = ctx.getApplicationContext();
        String b = base(c);
        String key = b + "|" + code;
        if (key.equals(activeBase) && listener != null && listener.isAlive()) return;
        activeBase = key; ok = false;
        if (b.isEmpty() || code.isEmpty()) return;
        listener = new Thread(() -> listen(c, key, b, code), "scaffold-fb"); listener.setDaemon(true); listener.start();
        if (sender == null || !sender.isAlive()) { sender = new Thread(() -> sendLoop(c), "scaffold-fb-send"); sender.setDaemon(true); sender.start(); }
    }

    static boolean active(Context c) { return !base(c).isEmpty(); }

    private static String path(String b, String code, String q) { return b + "/s/" + Sync.topic(code) + "/m.json" + (q == null ? "" : q); }

    private static void listen(Context c, String key, String b, String code) {
        long backoff = 2000;
        while (key.equals(activeBase)) {
            if (System.currentTimeMillis() < pollUntil) {
                try { pollOnce(c, b, code); backoff = 2000; } catch (Exception e) { ok = false; Sync.status = "offline (" + e.getMessage() + ")"; MainActivity.notifyState(); }
                try { Thread.sleep(ok ? 4000 : 10000); } catch (InterruptedException ignored) {}
                continue;
            }
            HttpURLConnection h = null;
            final boolean[] got = {false};
            Thread wd = null;
            long opened = System.currentTimeMillis();
            try {
                long since = Math.max(Store.getLong(c, "fbSince", 0), System.currentTimeMillis() - 12 * 3600_000L) - 60000;
                h = (HttpURLConnection) new URL(path(b, code, query(since))).openConnection();
                h.setRequestProperty("Accept", "text/event-stream");
                h.setConnectTimeout(20000); h.setReadTimeout(70000);   // keep-alives arrive every ~30 s
                if (h.getResponseCode() != 200) throw new Exception("Firebase " + h.getResponseCode());
                // Connected only once the first event arrives (Firebase sends one right away); silence = held back.
                final HttpURLConnection hh = h;
                wd = new Thread(() -> { try { Thread.sleep(15000); } catch (InterruptedException e) { return; } if (!got[0]) { toPolling(); hh.disconnect(); } }, "scaffold-fb-wd");
                wd.setDaemon(true); wd.start();
                BufferedReader br = new BufferedReader(new InputStreamReader(h.getInputStream(), StandardCharsets.UTF_8));
                String line, ev = ""; StringBuilder data = new StringBuilder();
                while ((line = br.readLine()) != null && key.equals(activeBase)) {
                    if (!got[0]) { got[0] = true; ok = true; backoff = 2000; Sync.fbStatus(); MainActivity.notifyState(); }
                    if (line.startsWith("event:")) ev = line.substring(6).trim();
                    else if (line.startsWith("data:")) data.append(line.substring(5).trim());
                    else if (line.isEmpty()) { event(c, code, ev, data.toString()); ev = ""; data.setLength(0); }
                }
            } catch (Exception e) {
                Sync.status = "offline (" + e.getMessage() + ")";
            } finally { if (wd != null) wd.interrupt(); if (h != null) h.disconnect(); }
            if (got[0]) dropped(System.currentTimeMillis() - opened);
            ok = false; MainActivity.notifyState();
            if (System.currentTimeMillis() < pollUntil) continue;   // straight to polling
            try { Thread.sleep(backoff); } catch (InterruptedException ignored) {}
            backoff = Math.min(30000, backoff * 2);
        }
    }

    private static void event(Context c, String code, String ev, String data) {
        if (!"put".equals(ev) && !"patch".equals(ev)) return;
        try {
            JSONObject j = new JSONObject(data);
            if (j.isNull("data")) return;
            String p = j.optString("path", "/");
            JSONObject items;
            if ("/".equals(p)) items = j.optJSONObject("data");
            else { items = new JSONObject(); items.put(p.replaceFirst("^/", "").split("/")[0], j.opt("data")); }
            if (items == null) return;
            List<String> keys = new ArrayList<>();
            for (Iterator<String> it = items.keys(); it.hasNext(); ) keys.add(it.next());
            Collections.sort(keys);
            for (String k : keys) {
                JSONObject m = items.optJSONObject(k);
                if (m == null || !m.has("d")) continue;
                synchronized (seen) { if (!seen.add(k)) continue; if (seen.size() > 4000) { Iterator<String> it = seen.iterator(); for (int i = 0; i < 2000; i++) { it.next(); it.remove(); } } }
                long t = m.optLong("t", 0);
                if (t > Store.getLong(c, "fbSince", 0)) Store.putLong(c, "fbSince", t);
                Sync.handleFromFb(c, code, m.optString("d"));
            }
        } catch (Exception ignored) {}
    }

    static void publish(String body) { synchronized (outbox) { outbox.add(body); outbox.notifyAll(); } }

    private static void sendLoop(Context c) {
        while (true) {
            String body;
            synchronized (outbox) {
                while (outbox.isEmpty()) { try { outbox.wait(30000); } catch (InterruptedException ignored) {} }
                body = outbox.peek();
            }
            String b = base(c), code = Store.get(c, "syncCode", "");
            if (b.isEmpty() || code.isEmpty()) { synchronized (outbox) { outbox.clear(); } continue; }
            try {
                HttpURLConnection h = (HttpURLConnection) new URL(path(b, code, null)).openConnection();
                h.setRequestMethod("POST"); h.setDoOutput(true); h.setConnectTimeout(20000); h.setReadTimeout(30000);
                h.setRequestProperty("Content-Type", "application/json");
                byte[] data = new JSONObject().put("d", body).put("t", new JSONObject().put(".sv", "timestamp")).toString().getBytes(StandardCharsets.UTF_8);
                try (OutputStream os = h.getOutputStream()) { os.write(data); }
                int rc = h.getResponseCode();
                if (rc == 200) {
                    try (InputStream in = h.getInputStream()) { String name = new JSONObject(new String(Updater.read(in), StandardCharsets.UTF_8)).optString("name"); synchronized (seen) { seen.add(name); } }
                    synchronized (outbox) { outbox.poll(); }
                } else { Thread.sleep(5000); }
                h.disconnect();
            } catch (Exception e) { try { Thread.sleep(5000); } catch (InterruptedException ignored) {} }
        }
    }
}
