package com.scaffold.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;

import org.json.JSONObject;

import java.util.UUID;

/** The device's copy of the shared state plus this device's own settings. */
public final class Store {
    private static JSONObject state;

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences("scaffold", Context.MODE_PRIVATE); }

    static synchronized JSONObject state(Context c) {
        if (state == null) {
            try { state = new JSONObject(prefs(c).getString("state", "")); }
            catch (Exception e) { state = Engine.emptyState(); }
            if (Engine.dropPulledCopies(state, System.currentTimeMillis()) > 0) prefs(c).edit().putString("state", state.toString()).apply();
        }
        return state;
    }

    /** The state for the interface, plus this device's own copy of Google Calendar (gev, never synced). */
    static synchronized String stateJson(Context c) {
        try { return new JSONObject(state(c).toString()).put("gev", new JSONObject(prefs(c).getString("gev", "{}"))).toString(); }
        catch (Exception e) { return state(c).toString(); }
    }

    static String deviceId(Context c) {
        SharedPreferences p = prefs(c);
        String id = p.getString("deviceId", null);
        if (id == null) {
            boolean tablet = c.getResources().getConfiguration().smallestScreenWidthDp >= 600;
            String hw = hw(c);   // same id after a reinstall, so the device keeps its place in Devices
            id = (tablet ? "tab-" : "phone-") + (hw.length() >= 8 ? hw.substring(0, 8) : UUID.randomUUID().toString().substring(0, 8));
            p.edit().putString("deviceId", id).putString("deviceName", tablet ? "Tablet" : "Phone").apply();
        }
        return id;
    }

    /** A key for this device that survives reinstalling Scaffold (Android's own id for this app + device, hashed). */
    static String hw(Context c) {
        try {
            String raw = android.provider.Settings.Secure.getString(c.getContentResolver(), android.provider.Settings.Secure.ANDROID_ID);
            if (raw == null || raw.isEmpty()) return "";
            byte[] h = java.security.MessageDigest.getInstance("SHA-256").digest(("scaffold:" + raw).getBytes("UTF-8"));
            StringBuilder b = new StringBuilder(); for (int i = 0; i < 8; i++) b.append(String.format("%02x", h[i]));
            return b.toString();
        } catch (Exception e) { return ""; }
    }

    /** "Still here" (every 6 h, from CoreService): other devices show this one as inactive once it stops. */
    static void heartbeat(Context c) {
        try {
            if (get(c, "syncCode", "").isEmpty()) return;
            String id = deviceId(c) + "#seen";
            JSONObject r = new JSONObject().put("id", id).put("ts", System.currentTimeMillis()).put("by", deviceId(c));
            String hw = hw(c); if (!hw.isEmpty()) r.put("hw", hw);
            apply(c, new JSONObject().put("devs", new JSONObject().put(id, r)), true);
        } catch (Exception ignored) {}
    }

    static String get(Context c, String k, String d) { return prefs(c).getString(k, d); }
    static void put(Context c, String k, String v) { prefs(c).edit().putString(k, v).apply(); }
    static long getLong(Context c, String k, long d) { return prefs(c).getLong(k, d); }
    static void putLong(Context c, String k, long v) { prefs(c).edit().putLong(k, v).apply(); }

    /** Merge a patch. publish=true for local changes (sent to the other devices). */
    static void apply(Context c, JSONObject patch, boolean publish) {
        boolean changed, test = false, release = false;
        synchronized (Store.class) {
            JSONObject log = patch.optJSONObject("log"), have = state(c).optJSONObject("log");
            if (log != null) {
                java.util.Iterator<String> it = log.keys();
                while (it.hasNext()) {
                    String k = it.next();
                    JSONObject e = log.optJSONObject(k);
                    if (e != null && "release".equals(e.optString("type")) && (have == null || !have.has(k)) && e.optLong("ts", 0) > System.currentTimeMillis() - 3600_000L
                            && Updater.newer(e.optString("v", "0"), Updater.version(c))) release = true;
                    if (e != null && "test-remind".equals(e.optString("type")) && (have == null || !have.has(k)) && e.optLong("ts", 0) > System.currentTimeMillis() - 120000) test = true;
                }
            }
            changed = Engine.merge(state(c), patch);
            if (changed) Engine.dropPulledCopies(state, System.currentTimeMillis());
            if (changed) prefs(c).edit().putString("state", state.toString()).apply();
        }
        if (publish) Sync.publish(c, patch, false);
        if (changed || publish) onChanged(c);
        if (test) Notif.testReminder(c.getApplicationContext());
        if (release) Updater.maybeCheck(c.getApplicationContext(), true);   // a new version was just released
    }

    /** Everything that depends on the state refreshes here. */
    static void onChanged(Context c) {
        Context a = c.getApplicationContext();
        Enforcer.evaluate(a);
        Engine.Result r = now(a);
        for (Engine.Item it : r.items) if (it.done) Notif.cancelTask(a, it.id);
        if (Notif.notes(a, r.notes)) Blocker.showNote(a);
        Scheduler.reschedule(a);
        CoreService.refresh(a);
        TaskWidget.updateAll(a);
        KillTile.refresh(a);
        MainActivity.notifyState();
    }

    static Engine.Result now(Context c) {
        synchronized (Store.class) { return Engine.compute(state(c), System.currentTimeMillis()); }
    }

    private static String gevRaw;
    private static JSONObject gevObj = new JSONObject();
    /** This device's copy of Google Calendar (for event modes). */
    static synchronized JSONObject gev(Context c) {
        String raw = prefs(c).getString("gev", "{}");
        if (!raw.equals(gevRaw)) { try { gevObj = new JSONObject(raw); } catch (Exception e) { gevObj = new JSONObject(); } gevRaw = raw; }
        return gevObj;
    }
    /** The restriction mode running now (null = none). */
    static Engine.Active mode(Context c) { return Engine.activeMode(state(c), gev(c), System.currentTimeMillis(), now(c)); }
}
