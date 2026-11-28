package com.scaffold.app;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;

/** "Sign in with Google" on the phone: Google's page opens in the browser, then sends it back to a tiny server inside
 *  Scaffold (loopback + PKCE, same as the computers). The refresh key goes to cfg.google, shared with every device
 *  through the encrypted sync, so one sign-in covers them all. Same flow as desktop/gauth.js. */
final class GAuth {
    static final String SCOPE = "https://www.googleapis.com/auth/calendar";
    private static final String AUTH = "https://accounts.google.com/o/oauth2/v2/auth", TOKEN = "https://oauth2.googleapis.com/token";

    private static JSONObject client;
    /** The app's Google client (copied in at build time from .secrets/, never in the public code). */
    static synchronized JSONObject client(Context c) {
        if (client != null) return client;
        try (InputStream in = c.getAssets().open("google-client.json")) {
            JSONObject j = new JSONObject(new String(Updater.read(in), StandardCharsets.UTF_8));
            client = j.has("installed") ? j.getJSONObject("installed") : j;
        } catch (Exception e) { client = null; }
        return client;
    }

    /** The shared sign-in, or null. */
    static JSONObject rec(Context c) {
        JSONObject cfg = Store.state(c).optJSONObject("cfg"), g = cfg == null ? null : cfg.optJSONObject("google");
        return g == null || g.optBoolean("del") || g.optString("rt").isEmpty() ? null : g;
    }

    /** "" = idle, "busy", "dead" (Google ended the sign-in), else an error to show. */
    static void status(Context c, String s) { Store.put(c, "gsign", s); MainActivity.notifyState(); }

    // ---- access keys (1 h), made from the shared refresh key ----
    private static String cRt = "", cAt = ""; private static long cExp = 0;
    static synchronized String token(Context c) throws Exception {
        JSONObject g = rec(c); if (g == null) throw new Exception("not signed in to Google");
        String rt = g.optString("rt");
        if (rt.equals(cRt) && System.currentTimeMillis() < cExp - 60000) return cAt;
        JSONObject cl = client(c); if (cl == null) throw new Exception("this build has no Google sign-in");
        Map<String, String> f = new HashMap<>();
        f.put("client_id", cl.optString("client_id")); f.put("client_secret", cl.optString("client_secret")); f.put("refresh_token", rt); f.put("grant_type", "refresh_token");
        Object[] r = http("POST", TOKEN, "application/x-www-form-urlencoded", null, form(f));
        JSONObject j = parse((String) r[1]);
        if ((int) r[0] != 200) {
            if ("invalid_grant".equals(j.optString("error"))) { status(c, "dead"); throw new Exception("Google sign-in expired: sign in again in Settings"); }
            throw new Exception("Google sign-in: " + j.optString("error_description", j.optString("error", "HTTP " + r[0])));
        }
        if ("dead".equals(Store.get(c, "gsign", ""))) status(c, "");
        cRt = rt; cAt = j.optString("access_token"); cExp = System.currentTimeMillis() + j.optLong("expires_in", 3600) * 1000;
        return cAt;
    }
    static synchronized void expire() { cExp = 0; }

    // ---- sign in ----
    private static volatile ServerSocket pending;
    static void signIn(Context c) {
        JSONObject cl = client(c);
        if (cl == null) { status(c, "this build has no Google sign-in"); return; }
        cancel();
        status(c, "busy");
        new Thread(() -> {
            ServerSocket ss = null;
            try {
                SecureRandom rnd = new SecureRandom();
                byte[] vb = new byte[48], sb = new byte[12]; rnd.nextBytes(vb); rnd.nextBytes(sb);
                String verifier = b64(vb), state = b64(sb), challenge = b64(MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII)));
                ss = new ServerSocket(0, 4, InetAddress.getByName("127.0.0.1"));
                ss.setSoTimeout(10 * 60000);
                pending = ss;
                String redirect = "http://127.0.0.1:" + ss.getLocalPort();
                Map<String, String> q = new HashMap<>();
                q.put("client_id", cl.optString("client_id")); q.put("redirect_uri", redirect); q.put("response_type", "code"); q.put("scope", SCOPE);
                q.put("code_challenge", challenge); q.put("code_challenge_method", "S256"); q.put("access_type", "offline"); q.put("prompt", "consent"); q.put("state", state);
                Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse(AUTH + "?" + form(q))).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                c.startActivity(open);
                while (true) {
                    try (Socket s = ss.accept()) {
                        BufferedReader in = new BufferedReader(new InputStreamReader(s.getInputStream(), StandardCharsets.UTF_8));
                        String line = in.readLine(); if (line == null) continue;
                        String[] parts = line.split(" ");
                        String target = parts.length > 1 ? parts[1] : "/";
                        if (!target.equals("/") && !target.startsWith("/?")) { reply(s, 404, ""); continue; }   // e.g. the browser asking for an icon
                        Map<String, String> p = query(target.contains("?") ? target.substring(target.indexOf('?') + 1) : "");
                        if (!state.equals(p.get("state"))) { reply(s, 400, ""); continue; }
                        String code = p.get("code");
                        if (code == null) { reply(s, 200, page("Sign-in cancelled. You can close this tab.")); status(c, "access_denied".equals(p.get("error")) ? "" : "Google said: " + p.get("error")); return; }
                        try {
                            Map<String, String> f = new HashMap<>();
                            f.put("code", code); f.put("client_id", cl.optString("client_id")); f.put("client_secret", cl.optString("client_secret"));
                            f.put("redirect_uri", redirect); f.put("grant_type", "authorization_code"); f.put("code_verifier", verifier);
                            Object[] r = http("POST", TOKEN, "application/x-www-form-urlencoded", null, form(f));
                            JSONObject j = parse((String) r[1]);
                            if ((int) r[0] != 200) throw new Exception("Google sign-in: " + j.optString("error_description", j.optString("error", "HTTP " + r[0])));
                            if (j.optString("refresh_token").isEmpty()) throw new Exception("Google sent no lasting key");
                            if (!(" " + j.optString("scope") + " ").contains(" " + SCOPE + " ")) throw new Exception("calendar access wasn’t allowed (tick the calendar box on Google’s page)");
                            reply(s, 200, page("✅ Signed in. You can close this tab and go back to Scaffold."));
                            long now = System.currentTimeMillis();
                            JSONObject rec = new JSONObject().put("id", "google").put("rt", j.optString("refresh_token")).put("email", "").put("at", now).put("ts", now).put("by", Store.deviceId(c));
                            synchronized (GAuth.class) { cRt = rec.optString("rt"); cAt = j.optString("access_token"); cExp = now + j.optLong("expires_in", 3600) * 1000; }
                            Store.apply(c, new JSONObject().put("cfg", new JSONObject().put("google", rec)), true);
                            try {
                                Object[] e = http("GET", "https://www.googleapis.com/calendar/v3/users/me/calendarList/primary", null, "Bearer " + token(c), null);
                                String email = parse((String) e[1]).optString("id");
                                if (!email.isEmpty()) { rec.put("email", email).put("ts", System.currentTimeMillis()); Store.apply(c, new JSONObject().put("cfg", new JSONObject().put("google", rec)), true); }
                            } catch (Exception ignored) {}
                            status(c, "");
                            Sync.pullSoon = true;
                            c.startActivity(new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT));
                        } catch (Exception e) { reply(s, 200, page("⚠️ " + String.valueOf(e.getMessage()).replace("<", "&lt;"))); status(c, String.valueOf(e.getMessage())); }
                        return;
                    }
                }
            } catch (java.net.SocketTimeoutException e) { status(c, "sign-in timed out");
            } catch (Exception e) { if (pending != null) status(c, String.valueOf(e.getMessage())); else status(c, "");
            } finally { pending = null; try { if (ss != null) ss.close(); } catch (Exception ignored) {} }
        }, "google-signin").start();
    }
    static void cancel() { ServerSocket s = pending; pending = null; if (s != null) try { s.close(); } catch (Exception ignored) {} }

    static void signOut(Context c) {
        JSONObject g = rec(c);
        if (g != null) {
            try {
                JSONObject d = new JSONObject(g.toString()).put("del", true).put("ts", System.currentTimeMillis()).put("by", Store.deviceId(c));
                Store.apply(c, new JSONObject().put("cfg", new JSONObject().put("google", d)), true);
            } catch (Exception ignored) {}
            final String rt = g.optString("rt");
            new Thread(() -> { try { Map<String, String> f = new HashMap<>(); f.put("token", rt); http("POST", "https://oauth2.googleapis.com/revoke", "application/x-www-form-urlencoded", null, form(f)); } catch (Exception ignored) {} }).start();
        }
        Store.prefs(c).edit().putString("gev", "{}").apply();
        status(c, "");
    }

    // ---- small helpers ----
    /** { status, text } */
    static Object[] http(String method, String url, String type, String auth, String body) throws Exception {
        HttpURLConnection h = (HttpURLConnection) new URL(url).openConnection();
        h.setConnectTimeout(20000); h.setReadTimeout(60000);
        if ("PATCH".equals(method)) { h.setRequestMethod("POST"); h.setRequestProperty("X-HTTP-Method-Override", "PATCH"); }
        else h.setRequestMethod(method);
        h.setRequestProperty("User-Agent", "Scaffold");
        if (auth != null) h.setRequestProperty("Authorization", auth);
        if (body != null) {
            h.setDoOutput(true); h.setRequestProperty("Content-Type", type != null ? type : "application/json");
            try (OutputStream os = h.getOutputStream()) { os.write(body.getBytes(StandardCharsets.UTF_8)); }
        }
        int rc = h.getResponseCode();
        InputStream in = rc >= 400 ? h.getErrorStream() : h.getInputStream();
        String text = "";
        if (in != null) try { text = new String(Updater.read(in), StandardCharsets.UTF_8); } finally { in.close(); }
        h.disconnect();
        return new Object[]{rc, text};
    }
    private static JSONObject parse(String s) { try { return new JSONObject(s); } catch (Exception e) { return new JSONObject(); } }
    private static String b64(byte[] b) { return Base64.encodeToString(b, Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP); }
    static String form(Map<String, String> m) {
        StringBuilder sb = new StringBuilder();
        try { for (Map.Entry<String, String> e : m.entrySet()) { if (sb.length() > 0) sb.append('&'); sb.append(URLEncoder.encode(e.getKey(), "UTF-8")).append('=').append(URLEncoder.encode(e.getValue(), "UTF-8")); } } catch (Exception ignored) {}
        return sb.toString();
    }
    private static Map<String, String> query(String q) {
        Map<String, String> m = new HashMap<>();
        for (String kv : q.split("&")) { int i = kv.indexOf('='); if (i <= 0) continue; try { m.put(URLDecoder.decode(kv.substring(0, i), "UTF-8"), URLDecoder.decode(kv.substring(i + 1), "UTF-8")); } catch (Exception ignored) {} }
        return m;
    }
    private static String page(String msg) {
        return "<!doctype html><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><title>Scaffold</title><body style=\"margin:0;height:100vh;display:grid;place-items:center;font:18px sans-serif;background:#0f1117;color:#eef0f7;text-align:center;padding:16px\"><div><div style=\"font-size:44px\">▦</div><p>" + msg + "</p></div>";
    }
    private static void reply(Socket s, int code, String html) throws Exception {
        byte[] b = html.getBytes(StandardCharsets.UTF_8);
        String head = "HTTP/1.1 " + code + (code == 200 ? " OK" : " Error") + "\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: " + b.length + "\r\nConnection: close\r\n\r\n";
        OutputStream o = s.getOutputStream(); o.write(head.getBytes(StandardCharsets.US_ASCII)); o.write(b); o.flush();
    }
}
