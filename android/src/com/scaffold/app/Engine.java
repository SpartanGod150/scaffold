package com.scaffold.app;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

/** Mirror of shared/engine.js. Keep both in sync; MainActivity's self-test checks them against tests/fixture-out.json. */
public final class Engine {
    static final long MIN = 60000L, DAY = 1440 * MIN;
    static final String NAG_STOP = "23:30", NUDGE_AT = "09:00";
    static final int MAX_SNOOZES = 2;
    static final int SNOOZE_MIN = 10;
    static final String[] MAPS = {"tasks", "todos", "projects", "events", "notes", "acks", "vault", "comps", "snoozes", "log", "cfg"};

    static final class Item {
        String id, type, key, sKey, status, doneKind, deadlineDay;
        JSONObject task;
        long start, due, stop, snoozedUntil, nudge;
        boolean done, locked;
        int snoozesLeft;
    }

    static final class Note {
        String id;
        JSONObject note;
        long since;
    }

    static final class Result {
        String day;
        boolean paused;
        List<Item> items = new ArrayList<>();
        List<Note> notes = new ArrayList<>();
        Item lock;
        int done, total;
        long next;
    }

    static final class Reminder {
        Item item;
        long at;
        boolean popup;
    }

    private static Calendar cal(long t) { Calendar c = Calendar.getInstance(); c.setTimeInMillis(t); return c; }

    static String dateKey(long t) {
        Calendar c = cal(t);
        return String.format(Locale.US, "%04d-%02d-%02d", c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH));
    }

    static String hhmm(long t) { Calendar c = cal(t); return String.format(Locale.US, "%02d:%02d", c.get(Calendar.HOUR_OF_DAY), c.get(Calendar.MINUTE)); }

    static long at(long t, String hhmm) {
        Calendar c = cal(t);
        String[] p = (hhmm == null || hhmm.isEmpty() ? "00:00" : hhmm).split(":");
        int h = 0, m = 0;
        try { h = Integer.parseInt(p[0]); m = p.length > 1 ? Integer.parseInt(p[1]) : 0; } catch (Exception ignored) {}
        c.set(Calendar.HOUR_OF_DAY, h); c.set(Calendar.MINUTE, m); c.set(Calendar.SECOND, 0); c.set(Calendar.MILLISECOND, 0);
        return c.getTimeInMillis();
    }

    static long fromKey(String key) {
        String[] p = key.split("-");
        Calendar c = Calendar.getInstance();
        c.clear();
        c.set(Integer.parseInt(p[0]), Integer.parseInt(p[1]) - 1, Integer.parseInt(p[2]), 12, 0, 0);
        return c.getTimeInMillis();
    }

    static long addDays(long t, int n) {
        Calendar c = cal(t);
        c.set(Calendar.HOUR_OF_DAY, 12); c.set(Calendar.MINUTE, 0); c.set(Calendar.SECOND, 0); c.set(Calendar.MILLISECOND, 0);
        c.add(Calendar.DAY_OF_MONTH, n);
        return c.getTimeInMillis();
    }

    static int daysBetween(long a, long b) { return (int) Math.round((fromKey(dateKey(b)) - fromKey(dateKey(a))) / (double) DAY); }

    static long midnightAfter(long t) {
        Calendar c = cal(t);
        c.set(Calendar.HOUR_OF_DAY, 0); c.set(Calendar.MINUTE, 0); c.set(Calendar.SECOND, 0); c.set(Calendar.MILLISECOND, 0);
        c.add(Calendar.DAY_OF_MONTH, 1);
        return c.getTimeInMillis();
    }

    static String compKey(String id, String day) { return id + "@" + day; }

    static JSONObject emptyState() {
        try {
            JSONObject s = new JSONObject();
            s.put("v", 2);
            for (String m : MAPS) s.put(m, new JSONObject());
            JSONObject p = new JSONObject(); p.put("on", false); p.put("ts", 0); p.put("by", "");
            s.put("pause", p);
            return s;
        } catch (Exception e) { throw new RuntimeException(e); }
    }

    static boolean newer(JSONObject a, JSONObject b) {
        if (a == null) return false;
        if (b == null) return true;
        long ta = a.optLong("ts", 0), tb = b.optLong("ts", 0);
        if (ta != tb) return ta > tb;
        return a.optString("by", "").compareTo(b.optString("by", "")) > 0;
    }

    static boolean merge(JSONObject into, JSONObject inc) {
        boolean changed = false;
        if (inc == null) return false;
        try {
            for (String m : MAPS) {
                JSONObject src = inc.optJSONObject(m);
                if (src == null) continue;
                JSONObject dst = into.optJSONObject(m);
                if (dst == null) { dst = new JSONObject(); into.put(m, dst); }
                Iterator<String> it = src.keys();
                while (it.hasNext()) {
                    String k = it.next();
                    JSONObject v = src.optJSONObject(k);
                    if (newer(v, dst.optJSONObject(k))) { dst.put(k, v); changed = true; }
                }
            }
            JSONObject p = inc.optJSONObject("pause");
            if (p != null && newer(p, into.optJSONObject("pause"))) { into.put("pause", p); changed = true; }
        } catch (Exception e) { throw new RuntimeException(e); }
        return changed;
    }

    private static JSONObject map(JSONObject state, String m) { JSONObject o = state.optJSONObject(m); return o == null ? new JSONObject() : o; }

    // ---------- habits ----------
    static boolean scheduledOn(JSONObject task, long t) {
        if (task == null || task.optBoolean("del", false) || !task.optBoolean("active", true)) return false;
        JSONArray days = task.optJSONArray("days");
        if (days != null && days.length() > 0) {
            int wd = cal(t).get(Calendar.DAY_OF_WEEK) - 1;
            boolean found = false;
            for (int i = 0; i < days.length(); i++) if (days.optInt(i, -1) == wd) { found = true; break; }
            if (!found) return false;
        }
        return dateKey(t).compareTo(task.optString("from", "0000-00-00")) >= 0;
    }

    static long[] windowOf(JSONObject task, long t) {
        long start = at(t, task.optString("start", "00:00")), due = at(t, task.optString("due", "23:00"));
        if (task.optString("start", "").isEmpty()) start = at(t, "00:00");
        if (task.optString("due", "").isEmpty()) due = at(t, "23:00");
        if (due < start) due = start;
        long stop = Math.max(at(t, NAG_STOP), due + 30 * MIN);
        stop = Math.min(stop, midnightAfter(t) - MIN);
        return new long[]{start, due, stop};
    }

    static List<Long> reminderTimes(JSONObject task, long start, long due, long stop, long nudge) {
        List<Long> out = new ArrayList<>();
        if (nudge > 0) { out.add(nudge); return out; }
        long every = Math.max(1, task.optInt("remind", 30));
        long t = start, lastHour = due - 60 * MIN;
        while (t < stop && out.size() < 1500) {
            out.add(t);
            long step = t >= due ? 20 : (t >= lastHour ? Math.min(10, every) : every);
            long nt = t + step * MIN;
            if (t < due && nt > due) nt = due;
            if (t < lastHour && nt > lastHour) nt = lastHour;
            t = nt;
        }
        return out;
    }

    // ---------- tasks (todos) ----------
    /** {key, first, deadline} or null. */
    static String[] periodOf(JSONObject todo, long t) {
        String rep = todo.optString("repeat", "none"), today = dateKey(t);
        if (rep.isEmpty()) rep = "none";
        if (rep.equals("week")) {
            int wd = cal(t).get(Calendar.DAY_OF_WEEK) - 1;
            long mon = addDays(t, -((wd + 6) % 7));
            int dd = todo.isNull("dueDay") ? 6 : todo.optInt("dueDay", 6);
            return new String[]{"W" + dateKey(mon), dateKey(mon), dateKey(addDays(mon, dd))};
        }
        if (rep.equals("month")) {
            Calendar c = cal(t);
            int last = c.getActualMaximum(Calendar.DAY_OF_MONTH);
            int dd = todo.optInt("dueDay", 0);
            int day = Math.min(dd > 0 ? dd : last, last);
            return new String[]{today.substring(0, 7), today.substring(0, 8) + "01", today.substring(0, 8) + String.format(Locale.US, "%02d", day)};
        }
        if (rep.equals("custom")) {
            JSONArray days = todo.optJSONArray("days");
            int wd = cal(t).get(Calendar.DAY_OF_WEEK) - 1;
            if (days != null && days.length() > 0) {
                boolean on = false;
                for (int i = 0; i < days.length(); i++) if (days.optInt(i, -1) == wd) on = true;
                if (!on) return null;
            }
            return new String[]{"C" + today, today, today};
        }
        if (rep.equals("days")) {
            int n = Math.max(1, todo.optInt("every", 2));
            String anchor = todo.optString("date", "");
            if (anchor.isEmpty()) anchor = todo.optString("from", today);
            if (today.compareTo(anchor) < 0) return null;
            int idx = (int) Math.floor(daysBetween(fromKey(anchor), t) / (double) n);
            long first = addDays(fromKey(anchor), idx * n);
            return new String[]{"D" + dateKey(first), dateKey(first), dateKey(addDays(first, n - 1))};
        }
        String date = todo.optString("date", "");
        if (date.isEmpty()) return null;
        return new String[]{"once", date, date};
    }

    static boolean todoActive(JSONObject t) { return t != null && !t.optBoolean("del", false) && t.optBoolean("active", true); }

    // ---------- today ----------
    static Result compute(JSONObject state, long now) {
        Result r = new Result();
        r.day = dateKey(now);
        JSONObject pause = state.optJSONObject("pause");
        r.paused = pause != null && pause.optBoolean("on", false);
        JSONObject tasks = map(state, "tasks"), todos = map(state, "todos"), comps = map(state, "comps");
        Iterator<String> keys = tasks.keys();
        while (keys.hasNext()) {
            String id = keys.next();
            JSONObject task = tasks.optJSONObject(id);
            if (!scheduledOn(task, now)) continue;
            long[] w = windowOf(task, now);
            push(r, state, now, id, task, "habit", compKey(id, r.day), w[0], w[1], w[2], 0, null);
        }
        keys = todos.keys();
        while (keys.hasNext()) {
            String id = keys.next();
            JSONObject todo = todos.optJSONObject(id);
            if (!todoActive(todo)) continue;
            String rep = todo.optString("repeat", "none");
            if (!rep.equals("none") && !rep.isEmpty() && r.day.compareTo(todo.optString("from", "0000-00-00")) < 0) continue;
            String[] p = periodOf(todo, now);
            if (p == null) continue;
            String key = compKey(id, p[0]);
            JSONObject c = comps.optJSONObject(key);
            boolean done = c != null && !c.optBoolean("undone", false);
            if (p[0].equals("once") && p[2].compareTo(r.day) < 0 && done) continue;
            if (p[0].equals("once") && p[2].compareTo(r.day) > 0) continue;
            if (p[2].equals(r.day)) {
                long[] w = windowOf(todo, now);
                push(r, state, now, id, todo, "todo", key, w[0], w[1], w[2], 0, p[2]);
            } else {
                long dueT = at(fromKey(p[2]), todo.optString("due", "").isEmpty() ? "21:00" : todo.optString("due"));
                push(r, state, now, id, todo, "todo", key, dueT, dueT, dueT, at(now, NUDGE_AT), p[2]);
            }
        }
        Collections.sort(r.items, (a, b) -> {
            if (a.due != b.due) return a.due < b.due ? -1 : 1;
            if (a.start != b.start) return a.start < b.start ? -1 : 1;
            return a.id.compareTo(b.id);
        });
        for (Item it : r.items) { if (it.locked && r.lock == null) r.lock = it; if (it.done) r.done++; }
        r.total = r.items.size();
        r.notes = pendingNotes(state, now);
        r.next = nextEvent(state, r.items, now, r.paused);
        return r;
    }

    private static void push(Result r, JSONObject state, long now, String id, JSONObject task, String type, String key,
                             long start, long due, long stop, long nudge, String deadlineDay) {
        JSONObject comps = map(state, "comps"), snoozes = map(state, "snoozes");
        Item it = new Item();
        it.id = id; it.type = type; it.task = task; it.key = key; it.sKey = compKey(id, r.day);
        it.start = start; it.due = due; it.stop = stop; it.nudge = nudge; it.deadlineDay = deadlineDay;
        JSONObject c = comps.optJSONObject(key);
        it.done = c != null && !c.optBoolean("undone", false);
        it.doneKind = it.done ? c.optString("kind", "full") : null;
        JSONObject s = snoozes.optJSONObject(it.sKey);
        it.snoozedUntil = (s != null && s.optLong("until", 0) > now) ? s.optLong("until", 0) : 0;
        it.snoozesLeft = MAX_SNOOZES - (s != null ? s.optInt("n", 0) : 0);
        it.status = it.done ? "done" : now < start ? "upcoming" : now < due ? "open" : "late";
        int level = task.optInt("level", 1);
        boolean lockable = nudge == 0 && ((level >= 4 && now >= start) || (level >= 3 && now >= due));
        it.locked = !r.paused && !it.done && lockable && now < stop && it.snoozedUntil == 0;
        r.items.add(it);
    }

    static long nextEvent(JSONObject state, List<Item> items, long now, boolean paused) {
        long best = midnightAfter(now) + 1000;
        if (paused) return best;
        for (Item it : items) {
            if (it.done) continue;
            List<Long> c = reminderTimes(it.task, it.start, it.due, it.stop, it.nudge);
            if (it.nudge == 0) { c.add(it.start); c.add(it.due); c.add(it.stop); }
            if (it.snoozedUntil > 0) c.add(it.snoozedUntil);
            for (long t : c) if (t > now && t < best) best = t;
        }
        JSONObject notes = map(state, "notes");
        Iterator<String> keys = notes.keys();
        while (keys.hasNext()) {
            long[] p = notePops(notes.optJSONObject(keys.next()), now);
            if (p[1] > now && p[1] < best) best = p[1];
        }
        return best;
    }

    static List<Reminder> dueReminders(JSONObject state, long from, long to) {
        List<Reminder> out = new ArrayList<>();
        Result r = compute(state, to);
        if (r.paused) return out;
        from = Math.max(from, to - 30 * MIN);
        JSONObject snoozes = map(state, "snoozes");
        for (Item it : r.items) {
            if (it.done || it.snoozedUntil > 0) continue;
            long hit = 0;
            for (long t : reminderTimes(it.task, it.start, it.due, it.stop, it.nudge)) if (t > from && t <= to) hit = t;
            JSONObject s = snoozes.optJSONObject(it.sKey);
            if (s != null) { long u = s.optLong("until", 0); if (u > from && u <= to) hit = Math.max(hit, u); }
            if (hit > 0) {
                Reminder rm = new Reminder();
                rm.item = it; rm.at = hit; rm.popup = it.nudge == 0 && (it.task.optInt("level", 1) >= 2 || hit >= it.due);
                out.add(rm);
            }
        }
        return out;
    }

    // ---------- reminder notes ----------
    static boolean inHours(JSONObject note, long t) {
        String from = note.optString("from", "00:00"), to = note.optString("to", "24:00"), x = hhmm(t);
        if (from.isEmpty()) from = "00:00";
        if (to.isEmpty()) to = "24:00";
        if (from.equals(to)) return true;
        return from.compareTo(to) < 0 ? (x.compareTo(from) >= 0 && x.compareTo(to) < 0) : (x.compareTo(from) >= 0 || x.compareTo(to) < 0);
    }

    /** {last, next} */
    static long[] notePops(JSONObject note, long now) {
        if (note == null || note.optBoolean("del", false) || !note.optBoolean("active", true)) return new long[]{0, 0};
        long every = Math.max(1, note.optLong("every", 60)) * MIN;
        long anchor = note.has("anchor") ? note.optLong("anchor", 0) : note.optLong("ts", 0);
        if (now < anchor) return new long[]{0, anchor};
        long k = (now - anchor) / every, last = anchor + k * every, next = last + every;
        for (int j = 0; j < 3000 && last >= anchor && !inHours(note, last); j++) last -= every;
        if (last < anchor || !inHours(note, last)) last = 0;
        for (int i = 0; i < 3000 && !inHours(note, next); i++) next += every;
        return new long[]{last, next};
    }

    static List<Note> pendingNotes(JSONObject state, long now) {
        List<Note> out = new ArrayList<>();
        JSONObject pause = state.optJSONObject("pause");
        if (pause != null && pause.optBoolean("on", false)) return out;
        JSONObject notes = map(state, "notes"), acks = map(state, "acks");
        Iterator<String> keys = notes.keys();
        while (keys.hasNext()) {
            String id = keys.next();
            JSONObject n = notes.optJSONObject(id);
            long[] p = notePops(n, now);
            JSONObject ack = acks.optJSONObject(id);
            if (p[0] > 0 && (ack == null || ack.optLong("at", 0) < p[0])) {
                Note x = new Note(); x.id = id; x.note = n; x.since = p[0]; out.add(x);
            }
        }
        Collections.sort(out, (a, b) -> a.since != b.since ? (a.since < b.since ? -1 : 1) : a.id.compareTo(b.id));
        return out;
    }

    // ---------- operations ----------
    private static JSONObject one(String map, String key, JSONObject val) {
        try { JSONObject p = new JSONObject(); JSONObject m = new JSONObject(); m.put(key, val); p.put(map, m); return p; }
        catch (Exception e) { throw new RuntimeException(e); }
    }

    static String itemKey(JSONObject state, String id, long now) {
        JSONObject todo = map(state, "todos").optJSONObject(id);
        if (todo != null) { String[] p = periodOf(todo, now); return compKey(id, p != null ? p[0] : "once"); }
        return compKey(id, dateKey(now));
    }

    static JSONObject opComplete(JSONObject state, String id, String kind, String by, long now) {
        try { JSONObject c = new JSONObject(); c.put("kind", kind == null ? "full" : kind); c.put("ts", now); c.put("by", by); return one("comps", itemKey(state, id, now), c); }
        catch (Exception e) { throw new RuntimeException(e); }
    }

    static JSONObject opSnooze(JSONObject state, String id, String by, long now) {
        try {
            String key = compKey(id, dateKey(now));
            JSONObject s = map(state, "snoozes").optJSONObject(key);
            int n = s != null ? s.optInt("n", 0) : 0;
            if (n >= MAX_SNOOZES) return null;
            JSONObject v = new JSONObject(); v.put("n", n + 1); v.put("until", now + SNOOZE_MIN * MIN); v.put("ts", now); v.put("by", by);
            return one("snoozes", key, v);
        } catch (Exception e) { throw new RuntimeException(e); }
    }

    static JSONObject opPause(boolean on, String by, long now) {
        try {
            JSONObject ev = new JSONObject(); ev.put("type", on ? "stop" : "resume"); ev.put("ts", now); ev.put("by", by);
            JSONObject p = one("log", Long.toString(now, 36) + UUID.randomUUID().toString().substring(0, 6), ev);
            JSONObject pause = new JSONObject(); pause.put("on", on); pause.put("ts", now); pause.put("by", by);
            p.put("pause", pause);
            return p;
        } catch (Exception e) { throw new RuntimeException(e); }
    }

    static JSONObject opAck(String noteId, String by, long now) {
        try { JSONObject a = new JSONObject(); a.put("at", now); a.put("ts", now); a.put("by", by); return one("acks", noteId, a); }
        catch (Exception e) { throw new RuntimeException(e); }
    }

    // ---- sync helpers ----
    static List<JSONObject> chunks(JSONObject patch) {
        final int maxRaw = 2600;
        List<JSONObject> out = new ArrayList<>();
        try {
            JSONObject cur = new JSONObject();
            int size = 2;
            JSONObject pause = patch.optJSONObject("pause");
            if (pause != null) { cur.put("pause", pause); size += pause.toString().length() + 10; }
            for (String m : MAPS) {
                JSONObject src = patch.optJSONObject(m);
                if (src == null) continue;
                Iterator<String> it = src.keys();
                while (it.hasNext()) {
                    String k = it.next();
                    JSONObject v = src.optJSONObject(k);
                    if (v == null) continue;
                    int len = v.toString().length() + k.length() + 8;
                    if (size + len > maxRaw && size > 2) { out.add(cur); cur = new JSONObject(); size = 2; }
                    JSONObject dst = cur.optJSONObject(m);
                    if (dst == null) { dst = new JSONObject(); cur.put(m, dst); }
                    dst.put(k, v);
                    size += len + m.length();
                }
            }
            if (cur.length() > 0) out.add(cur);
        } catch (Exception e) { throw new RuntimeException(e); }
        return out;
    }

    static JSONObject snapshot(JSONObject state, long now) {
        try {
            JSONObject s = new JSONObject(state.toString());
            String cut = dateKey(now - 40L * DAY);
            JSONObject comps = s.optJSONObject("comps");
            if (comps != null) {
                List<String> drop = new ArrayList<>();
                Iterator<String> it = comps.keys();
                while (it.hasNext()) { String k = it.next(); String[] p = k.split("@"); if (p.length > 1 && p[1].matches("\\d{4}-\\d\\d-\\d\\d") && p[1].compareTo(cut) < 0) drop.add(k); }
                for (String k : drop) comps.remove(k);
            }
            JSONObject sn = s.optJSONObject("snoozes");
            if (sn != null) {
                List<String> drop = new ArrayList<>();
                Iterator<String> it = sn.keys();
                while (it.hasNext()) { String k = it.next(); String[] p = k.split("@"); if (p.length > 1 && p[1].compareTo(cut) < 0) drop.add(k); }
                for (String k : drop) sn.remove(k);
            }
            JSONObject ev = s.optJSONObject("events");
            if (ev != null) {
                List<String> drop = new ArrayList<>();
                Iterator<String> it = ev.keys();
                while (it.hasNext()) { String k = it.next(); JSONObject e = ev.optJSONObject(k); long end = e == null ? 0 : e.optLong("end", e.optLong("start", 0)); if (end < now - 40L * DAY) drop.add(k); }
                for (String k : drop) ev.remove(k);
            }
            return s;
        } catch (Exception e) { throw new RuntimeException(e); }
    }

    /** Runs the shared fixture (tests/fixture-out.json) and returns mismatches; empty string = all good. */
    static String selfTest(String fixtureJson) {
        StringBuilder bad = new StringBuilder();
        try {
            JSONObject fx = new JSONObject(fixtureJson);
            JSONObject state = fx.getJSONObject("state");
            JSONArray cases = fx.getJSONArray("cases");
            for (int i = 0; i < cases.length(); i++) {
                JSONObject c = cases.getJSONObject(i);
                long now = c.getLong("now");
                Result r = compute(state, now);
                String lock = r.lock == null ? "null" : r.lock.id;
                String expLock = c.isNull("lock") ? "null" : c.getString("lock");
                String rem = join(remStrings(state, now)), exp = join(c.getJSONArray("rem"));
                List<String> ns = new ArrayList<>(), ks = new ArrayList<>();
                for (Note n : r.notes) ns.add(n.id + ":" + n.since);
                for (Item it : r.items) ks.add(it.key + ":" + it.status);
                String notes = join(ns), expNotes = join(c.getJSONArray("notes")), itemKeys = join(ks), expKeys = join(c.getJSONArray("keys"));
                if (!lock.equals(expLock) || r.next != c.getLong("next") || r.done != c.getInt("done") || r.total != c.getInt("total")
                        || !rem.equals(exp) || !notes.equals(expNotes) || !itemKeys.equals(expKeys))
                    bad.append("case ").append(i).append(": lock ").append(lock).append('/').append(expLock)
                            .append(" next ").append(r.next).append('/').append(c.getLong("next"))
                            .append(" rem ").append(rem).append('/').append(exp)
                            .append(" notes ").append(notes).append('/').append(expNotes)
                            .append(" items ").append(itemKeys).append('/').append(expKeys).append('\n');
            }
        } catch (Exception e) { bad.append("error ").append(e); }
        return bad.toString();
    }

    private static List<String> remStrings(JSONObject state, long now) {
        List<String> out = new ArrayList<>();
        for (Reminder x : dueReminders(state, now - 60000, now)) out.add(x.item.id + ":" + x.popup);
        return out;
    }

    private static String join(List<String> l) { StringBuilder sb = new StringBuilder(); for (String s : l) sb.append(s).append(','); return sb.toString(); }

    private static String join(JSONArray a) { StringBuilder sb = new StringBuilder(); for (int i = 0; i < a.length(); i++) sb.append(a.optString(i)).append(','); return sb.toString(); }
}
