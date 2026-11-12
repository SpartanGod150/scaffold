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
            id = (tablet ? "tab-" : "phone-") + UUID.randomUUID().toString().substring(0, 8);
            p.edit().putString("deviceId", id).putString("deviceName", tablet ? "Tablet" : "Phone").apply();
        }
        return id;
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
        if (Notif.notes(a, r.notes)) BlockerService.showNote();
        Scheduler.reschedule(a);
        CoreService.refresh(a);
        TaskWidget.updateAll(a);
        KillTile.refresh(a);
        MainActivity.notifyState();
    }

    static Engine.Result now(Context c) {
        synchronized (Store.class) { return Engine.compute(state(c), System.currentTimeMillis()); }
    }
}
