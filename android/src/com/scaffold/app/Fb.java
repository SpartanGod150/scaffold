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
    static volatile boolean ok = false;
    private static volatile String activeBase = "";
    private static final ArrayDeque<String> outbox = new ArrayDeque<>();
    private static final LinkedHashSet<String> seen = new LinkedHashSet<>();
    private static Thread listener, sender;

    static String base(Context c) {
        JSONObject cfg = Store.state(c).optJSONObject("cfg"), f = cfg == null ? null : cfg.optJSONObject("fb");
        if (f == null || f.optBoolean("del")) return "";
        return f.optString("url", "").replaceAll("/+$", "");
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
            HttpURLConnection h = null;
            try {
                long since = Math.max(Store.getLong(c, "fbSince", 0), System.currentTimeMillis() - 12 * 3600_000L) - 60000;
                h = (HttpURLConnection) new URL(path(b, code, "?orderBy=" + URLEncoder.encode("\"t\"", "UTF-8") + "&startAt=" + since)).openConnection();
                h.setRequestProperty("Accept", "text/event-stream");
                h.setConnectTimeout(20000); h.setReadTimeout(90000);   // keep-alives arrive every ~30 s
                if (h.getResponseCode() != 200) throw new Exception("Firebase " + h.getResponseCode());
                ok = true; backoff = 2000; Sync.fbStatus(); MainActivity.notifyState();
                BufferedReader br = new BufferedReader(new InputStreamReader(h.getInputStream(), StandardCharsets.UTF_8));
                String line, ev = ""; StringBuilder data = new StringBuilder();
                while ((line = br.readLine()) != null && key.equals(activeBase)) {
                    if (line.startsWith("event:")) ev = line.substring(6).trim();
                    else if (line.startsWith("data:")) data.append(line.substring(5).trim());
                    else if (line.isEmpty()) { event(c, code, ev, data.toString()); ev = ""; data.setLength(0); }
                }
            } catch (Exception e) {
                Sync.status = "offline (" + e.getMessage() + ")";
            } finally { if (h != null) h.disconnect(); }
            ok = false; MainActivity.notifyState();
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
