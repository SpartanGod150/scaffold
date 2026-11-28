package com.scaffold.app;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.net.URLEncoder;
import java.security.MessageDigest;

/** Reading Google Calendar in the background with "Sign in with Google": the "pull" request of shared/gbridge.js, in Java,
 *  so Sync.pullCalendar gets the same reply as from the old script. (Edits to Google go through the WebView's
 *  shared/gbridge.js when the phone is the device that sends them.) */
final class GApi {
    private static final String API = "https://www.googleapis.com/calendar/v3";
    private static final int V = 3;

    private static JSONObject get(Context c, String path, String query) throws Exception {
        for (int attempt = 0; attempt < 2; attempt++) {
            Object[] r = GAuth.http("GET", API + path + (query.isEmpty() ? "" : "?" + query), null, "Bearer " + GAuth.token(c), null);
            int rc = (int) r[0];
            if (rc == 401 && attempt == 0) { GAuth.expire(); continue; }
            if (rc != 200) throw new Exception("Google " + rc);
            return new JSONObject((String) r[1]);
        }
        throw new Exception("Google 401");
    }
    private static String enc(String s) throws Exception { return URLEncoder.encode(s, "UTF-8").replace("+", "%20"); }
    private static String iso(long ms) { java.text.SimpleDateFormat f = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US); f.setTimeZone(java.util.TimeZone.getTimeZone("UTC")); return f.format(new java.util.Date(ms)); }
    private static long parseIso(String s) {
        try { return java.time.OffsetDateTime.parse(s).toInstant().toEpochMilli(); } catch (Exception e) { try { return java.time.Instant.parse(s).toEpochMilli(); } catch (Exception e2) { return 0; } }
    }
    private static long localMidnight(String day) { return Engine.at(Engine.fromKey(day), "00:00"); }

    private static JSONArray pages(Context c, String path, String query) throws Exception {
        JSONArray out = new JSONArray(); String tok = null;
        do {
            JSONObject r = get(c, path, query + (tok == null ? "" : "&pageToken=" + enc(tok)));
            JSONArray it = r.optJSONArray("items");
            for (int i = 0; it != null && i < it.length(); i++) out.put(it.get(i));
            tok = r.optString("nextPageToken", null); if (tok != null && tok.isEmpty()) tok = null;
        } while (tok != null);
        return out;
    }

    static JSONObject pull(Context c, JSONObject req) throws Exception {
        JSONArray raw = pages(c, "/users/me/calendarList", "maxResults=250"), cs = new JSONArray();
        for (int i = 0; i < raw.length(); i++) {
            JSONObject x = raw.getJSONObject(i); String role = x.optString("accessRole");
            cs.put(new JSONObject().put("id", x.optString("id")).put("name", x.optString("summaryOverride", x.optString("summary"))).put("color", x.optString("backgroundColor"))
                    .put("primary", x.optBoolean("primary")).put("ro", !("owner".equals(role) || "writer".equals(role))).put("owner", "owner".equals(role)));
        }
        String sig = sig(cs.toString());
        long now = System.currentTimeMillis();
        if (req.optLong("since", 0) > 0 && sig.equals(req.optString("sig"))) {
            boolean changed = false;
            for (int i = 0; i < cs.length() && !changed; i++) {
                JSONObject r = get(c, "/calendars/" + enc(cs.getJSONObject(i).optString("id")) + "/events", "updatedMin=" + enc(iso(req.optLong("since") - 120000)) + "&showDeleted=true&maxResults=1&fields=items(id)");
                JSONArray it = r.optJSONArray("items"); changed = it != null && it.length() > 0;
            }
            if (!changed) return new JSONObject().put("v", V).put("same", true).put("now", now);
        }
        JSONObject pal = new JSONObject(), ec = get(c, "/colors", "").optJSONObject("event");
        if (ec != null) { java.util.Iterator<String> k = ec.keys(); while (k.hasNext()) { String id = k.next(); pal.put(id, ec.getJSONObject(id).optString("background")); } }
        JSONArray events = new JSONArray(); JSONObject rules = new JSONObject();
        String range = "timeMin=" + enc(iso(req.optLong("from"))) + "&timeMax=" + enc(iso(req.optLong("to"))) + "&maxResults=2500";
        for (int i = 0; i < cs.length(); i++) {
            JSONObject cal = cs.getJSONObject(i); String path = "/calendars/" + enc(cal.optString("id")) + "/events";
            JSONArray evs = pages(c, path, range + "&singleEvents=true&fields=" + enc("nextPageToken,items(id,status,summary,description,start,end,colorId,recurringEventId,originalStartTime,updated,extendedProperties)"));
            for (int j = 0; j < evs.length(); j++) { JSONObject ev = evs.getJSONObject(j); if (!"cancelled".equals(ev.optString("status"))) events.put(conv(ev, cal.optString("id"))); }
            JSONArray ser = pages(c, path, range + "&singleEvents=false&fields=" + enc("nextPageToken,items(id,recurrence)"));
            for (int j = 0; j < ser.length(); j++) {
                JSONObject ev = ser.getJSONObject(j); JSONArray rec = ev.optJSONArray("recurrence");
                if (rec == null) continue;
                StringBuilder sb = new StringBuilder(); for (int k = 0; k < rec.length(); k++) { if (k > 0) sb.append('\n'); sb.append(rec.optString(k)); }
                rules.put(ev.optString("id"), sb.toString());
            }
        }
        return new JSONObject().put("v", V).put("events", events).put("cals", cs).put("colors", pal).put("rules", rules).put("sig", sig).put("now", now);
    }

    private static JSONObject conv(JSONObject ev, String cal) throws Exception {
        JSONObject st = ev.optJSONObject("start"), en = ev.optJSONObject("end"), os = ev.optJSONObject("originalStartTime");
        boolean allDay = st != null && st.has("date");
        JSONObject ext = ev.optJSONObject("extendedProperties"), pr = ext == null ? null : ext.optJSONObject("private");
        Object ostart = "";
        if (os != null) ostart = os.has("date") ? os.optString("date") : (Object) parseIso(os.optString("dateTime"));
        return new JSONObject().put("gid", ev.optString("id")).put("cal", cal).put("title", ev.optString("summary", "(no title)")).put("desc", ev.optString("description", ""))
                .put("allDay", allDay).put("sd", allDay ? st.optString("date") : "").put("ed", allDay ? en.optString("date") : "")
                .put("start", allDay ? localMidnight(st.optString("date")) : parseIso(st.optString("dateTime")))
                .put("end", allDay ? localMidnight(en.optString("date")) : parseIso(en.optString("dateTime")))
                .put("rec", ev.has("recurringEventId")).put("series", ev.optString("recurringEventId", "")).put("ostart", ostart)
                .put("color", ev.optString("colorId", "")).put("upd", parseIso(ev.optString("updated"))).put("sid", pr == null ? "" : pr.optString("scaffoldId", ""));
    }

    // "Did the calendar list change?" Only compared with this device's own last answer, so any stable hash will do.
    private static String sig(String s) {
        try { byte[] d = MessageDigest.getInstance("MD5").digest(s.getBytes("UTF-8")); StringBuilder sb = new StringBuilder(); for (byte b : d) sb.append(String.format("%02x", b)); return sb.toString(); }
        catch (Exception e) { return String.valueOf(s.hashCode()); }
    }
}
