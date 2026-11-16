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
    static final String NAG_STOP = "23:30";
    static final int MAX_SNOOZES = 2;
    static final int SNOOZE_MIN = 10;
    static final String[] MAPS = {"tasks", "todos", "projects", "events", "notes", "acks", "vault", "comps", "snoozes", "log", "cfg", "marks", "sess"};

    static final class Item {
        String id, type, key, sKey, status, doneKind, deadlineDay;
        JSONObject task;
        long start, due, stop, rEnd, snoozedUntil;
        boolean done, locked, hasDue, dueToday, future;
        String push;
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
    // repeat: "weekdays" (default: picked weekdays, none = every day; each day is a period), "week", "month", "every" (every N days).
    static boolean weekdayOk(JSONObject task, long t) {
        JSONArray days = task.optJSONArray("days");
        if (days == null || days.length() == 0) return true;
        int wd = cal(t).get(Calendar.DAY_OF_WEEK) - 1;
        for (int i = 0; i < days.length(); i++) if (days.optInt(i, -1) == wd) return true;
        return false;
    }
    /** {key, first, deadline} or null. */
    static String[] habitPeriod(JSONObject task, long t) {
        if (task == null || task.optBoolean("del", false) || !task.optBoolean("active", true)) return null;
        String today = dateKey(t), rep = task.optString("repeat", "weekdays");
        if (today.compareTo(task.optString("from", "0000-00-00")) < 0) return null;
        try {
            if (rep.equals("week") || rep.equals("month")) {
                JSONObject p = new JSONObject(); p.put("repeat", rep); if (task.has("dueDay") && !task.isNull("dueDay")) p.put("dueDay", task.opt("dueDay"));
                return periodOf(p, t);
            }
            if (rep.equals("every")) {
                JSONObject p = new JSONObject(); p.put("repeat", "days"); p.put("every", task.optInt("every", 2));
                String d = task.optString("date", ""); p.put("date", d.isEmpty() ? task.optString("from", "") : d);
                return periodOf(p, t);
            }
        } catch (Exception e) { throw new RuntimeException(e); }
        if (!weekdayOk(task, t)) return null;
        return new String[]{today, today, today};
    }
    static boolean scheduledOn(JSONObject task, long t) { return habitPeriod(task, t) != null; }

    // ---------- how hard Scaffold pushes (see engine.js) ----------
    static String pushOf(JSONObject task, String kind) {
        String p = task.optString("push", "");
        if (!p.isEmpty()) return p;
        if ("todo".equals(kind) && task.optString("date", "").isEmpty() && isNone(task.optString("repeat", "none"))) return "off";
        return task.optInt("level", 1) == 1 ? "nudge" : "nag";
    }
    static boolean lockOf(JSONObject task) { return task.has("lock") && !task.isNull("lock") ? task.optBoolean("lock", false) : task.optInt("level", 1) >= 3; }
    static boolean hasDue(JSONObject task, String kind) {
        if ("todo".equals(kind)) return !task.optString("date", "").isEmpty() || !isNone(task.optString("repeat", "none"));
        return task.has("dueOn") && !task.isNull("dueOn") ? task.optBoolean("dueOn", false) : !task.optString("due", "").isEmpty();
    }
    private static boolean isNone(String rep) { return rep.isEmpty() || rep.equals("none"); }
    private static String orStr(JSONObject o, String a, String b, String def) {
        String x = o.optString(a, ""); if (!x.isEmpty()) return x;
        x = b == null ? "" : o.optString(b, ""); return x.isEmpty() ? def : x;
    }

    static final class Timing { long start, due, rEnd, stop; boolean hasDue, dueToday, lock, future; String push; }
    static Timing timing(JSONObject task, String kind, String deadline, long now) {
        Timing w = new Timing();
        w.push = pushOf(task, kind);
        String from = orStr(task, "rfrom", "start", "09:00"), to = orStr(task, "rto", "due", "21:00"), day = dateKey(now);
        long end = midnightAfter(now) - MIN;
        long due = deadline != null && hasDue(task, kind) ? at(fromKey(deadline), task.optString("due", "").isEmpty() ? "23:59" : task.optString("due")) : 0;
        w.hasDue = due != 0; w.dueToday = w.hasDue && deadline.equals(day);
        w.start = "off".equals(w.push) ? at(now, "00:00") : at(now, from);
        w.rEnd = to.compareTo(from) <= 0 ? end : Math.min(end, at(now, to));
        w.stop = w.dueToday ? Math.min(Math.max(at(now, NAG_STOP), due + 30 * MIN), end) : w.rEnd;
        w.due = w.hasDue ? due : end;
        w.lock = lockOf(task) && w.dueToday;
        w.future = w.hasDue && deadline.compareTo(day) > 0;
        return w;
    }

    static List<Long> reminderTimes(JSONObject task, Item w) {
        List<Long> out = new ArrayList<>();
        if ("off".equals(w.push)) return out;
        long every = Math.max(1, task.optInt("remind", 30));
        long lastHour = w.dueToday ? w.due - 60 * MIN : Long.MAX_VALUE, end = w.dueToday ? Math.min(w.rEnd, w.due) : w.rEnd, t = w.start;
        while (t < end && out.size() < 1500) {
            out.add(t);
            long nt = t + (t >= lastHour ? Math.min(10, every) : every) * MIN;
            if (t < lastHour && nt > lastHour) nt = lastHour;
            t = nt;
        }
        if (w.dueToday) for (t = w.due; t < w.stop && out.size() < 1500; t += 20 * MIN) out.add(t);
        return out;
    }

    // ---------- tasks (todos) ----------
    /** {key, first, deadline} or null. Also serves habit periods and old repeating tasks. */
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
            String[] p = habitPeriod(task, now);
            if (p != null) push(r, state, now, id, task, "habit", compKey(id, p[0]), p[2]);
        }
        keys = todos.keys();
        while (keys.hasNext()) {
            String id = keys.next();
            JSONObject todo = todos.optJSONObject(id);
            if (!todoActive(todo)) continue;
            if (!isNone(todo.optString("repeat", "none"))) {   // old repeating task
                if (r.day.compareTo(todo.optString("from", "0000-00-00")) < 0) continue;
                String[] p = periodOf(todo, now);
                if (p != null) push(r, state, now, id, todo, "todo", compKey(id, p[0]), p[2]);
                continue;
            }
            String key = compKey(id, "once"), date = todo.optString("date", "");
            String deadline = date.isEmpty() ? null : date;
            JSONObject c = comps.optJSONObject(key);
            if (c != null && !c.optBoolean("undone", false)) {
                if (dateKey(c.optLong("ts", 0)).equals(r.day)) push(r, state, now, id, todo, "todo", key, deadline);
                continue;
            }
            boolean off = "off".equals(pushOf(todo, "todo"));
            if (deadline == null ? off : (deadline.compareTo(r.day) > 0 && off)) continue;
            push(r, state, now, id, todo, "todo", key, deadline);
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

    private static void push(Result r, JSONObject state, long now, String id, JSONObject task, String type, String key, String deadline) {
        JSONObject comps = map(state, "comps"), snoozes = map(state, "snoozes");
        Timing w = timing(task, type, deadline, now);
        Item it = new Item();
        it.id = id; it.type = type; it.task = task; it.key = key; it.sKey = compKey(id, r.day);
        it.start = w.start; it.due = w.due; it.stop = w.stop; it.rEnd = w.rEnd; it.hasDue = w.hasDue; it.dueToday = w.dueToday; it.future = w.future; it.push = w.push;
        it.deadlineDay = w.hasDue ? deadline : null;
        JSONObject c = comps.optJSONObject(key);
        it.done = c != null && !c.optBoolean("undone", false);
        it.doneKind = it.done ? c.optString("kind", "full") : null;
        JSONObject s = snoozes.optJSONObject(it.sKey);
        it.snoozedUntil = (s != null && s.optLong("until", 0) > now) ? s.optLong("until", 0) : 0;
        it.snoozesLeft = MAX_SNOOZES - (s != null ? s.optInt("n", 0) : 0);
        it.status = it.done ? "done" : (w.hasDue && now >= w.due) ? "late" : now < w.start ? "upcoming" : "open";
        it.locked = !r.paused && !it.done && w.lock && now >= w.due && now < w.stop && it.snoozedUntil == 0;
        r.items.add(it);
    }

    static long nextEvent(JSONObject state, List<Item> items, long now, boolean paused) {
        long best = midnightAfter(now) + 1000;
        if (paused) return best;
        for (Item it : items) {
            if (it.done) continue;
            List<Long> c = reminderTimes(it.task, it);
            c.add(it.start);
            if (it.dueToday) { c.add(it.due); c.add(it.stop); }
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
            for (long t : reminderTimes(it.task, it)) if (t > from && t <= to) hit = t;
            JSONObject s = snoozes.optJSONObject(it.sKey);
            if (s != null) { long u = s.optLong("until", 0); if (u > from && u <= to) hit = Math.max(hit, u); }
            if (hit > 0) {
                Reminder rm = new Reminder();
                rm.item = it; rm.at = hit; rm.popup = "nag".equals(it.push) || (it.dueToday && hit >= it.due);
                out.add(rm);
            }
        }
        return out;
    }

    // ---------- reminder notes ----------
    // days: weekdays (0=Sun..6=Sat) the note is active; none = every day. A window that crosses midnight belongs to the day it starts.
    static boolean dayOk(JSONObject note, long t) {
        JSONArray ds = note.optJSONArray("days");
        if (ds == null || ds.length() == 0) return true;
        int wd = cal(t).get(Calendar.DAY_OF_WEEK) - 1;
        for (int i = 0; i < ds.length(); i++) if (ds.optInt(i, -1) == wd) return true;
        return false;
    }
    static String nFrom(JSONObject note) { String f = note.optString("from", "00:00"); return f.isEmpty() ? "00:00" : f; }
    static String nTo(JSONObject note) { String t = note.optString("to", "24:00"); return t.isEmpty() ? "24:00" : t; }

    static boolean inHours(JSONObject note, long t) {
        String from = nFrom(note), to = nTo(note), x = hhmm(t);
        if (from.equals(to)) return dayOk(note, t);
        if (from.compareTo(to) < 0) return x.compareTo(from) >= 0 && x.compareTo(to) < 0 && dayOk(note, t);
        return (x.compareTo(from) >= 0 && dayOk(note, t)) || (x.compareTo(to) < 0 && dayOk(note, addDays(t, -1)));
    }
    static long nextOpen(JSONObject note, long t) {
        String from = nFrom(note), to = nTo(note), s = from.equals(to) ? "00:00" : from;
        for (int d = 0; d <= 8; d++) { long w = at(addDays(t, d), s); if (w > t && inHours(note, w)) return w; }
        return 0;
    }
    static long prevClose(JSONObject note, long t) {
        String from = nFrom(note), to = nTo(note);
        long best = 0;
        for (int d = 0; d <= 9; d++) {
            long D = addDays(t, -d);
            if (!dayOk(note, D)) continue;
            long e = from.equals(to) ? at(addDays(D, 1), "00:00") : from.compareTo(to) < 0 ? at(D, to) : at(addDays(D, 1), to);
            if (e <= t && e > best) best = e;
        }
        return best;
    }

    /** {last, next} */
    static long[] notePops(JSONObject note, long now) {
        if (note == null || note.optBoolean("del", false) || !note.optBoolean("active", true)) return new long[]{0, 0};
        long every = Math.max(1, note.optLong("every", 60)) * MIN;
        long anchor = note.has("anchor") ? note.optLong("anchor", 0) : note.optLong("ts", 0);
        if (now < anchor) return new long[]{0, anchor};
        long k = (now - anchor) / every, last = anchor + k * every, next = last + every;
        for (int j = 0; j < 500 && last >= anchor && !inHours(note, last); j++) {
            long e = prevClose(note, last);
            if (e == 0) { last = 0; break; }
            last -= Math.max(1, (last - e + 1 + every - 1) / every) * every;
        }
        if (last < anchor || !inHours(note, last)) last = 0;
        for (int i = 0; i < 500 && !inHours(note, next); i++) {
            long w = nextOpen(note, next);
            if (w == 0) { next = 0; break; }
            next += Math.max(1, (w - next + every - 1) / every) * every;
        }
        if (next != 0 && !inHours(note, next)) next = 0;
        return new long[]{last, next};
    }

    /** Note text without its Markdown marks (for notifications). */
    static String plainNote(String text) {
        StringBuilder out = new StringBuilder();
        for (String l : (text == null ? "" : text).split("\n", -1)) {
            if (out.length() > 0) out.append('\n');
            int ind = 0; while (ind < l.length() && l.charAt(ind) == '\t') { out.append("  "); ind++; }
            l = l.substring(ind);
            if (l.matches("^- \\[[xX]\\] .*")) l = "☑ " + l.substring(6);
            else if (l.startsWith("- [ ] ")) l = "☐ " + l.substring(6);
            else if (l.startsWith("- ")) l = "• " + l.substring(2);
            else if (l.startsWith("## ")) l = l.substring(3);
            else if (l.startsWith("# ")) l = l.substring(2);
            StringBuilder b = new StringBuilder();
            for (int i = 0; i < l.length(); i++) {
                char ch = l.charAt(i);
                if (ch == '\\' && i + 1 < l.length()) { b.append(l.charAt(++i)); continue; }
                if (ch == '*') continue;
                if ((ch == '~' || ch == '+') && i + 1 < l.length() && l.charAt(i + 1) == ch) { i++; continue; }
                b.append(ch);
            }
            out.append(b);
        }
        return out.toString();
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
        JSONObject todo = map(state, "todos").optJSONObject(id), habit = map(state, "tasks").optJSONObject(id);
        if (todo != null) { String[] p = isNone(todo.optString("repeat", "none")) ? null : periodOf(todo, now); return compKey(id, p != null ? p[0] : "once"); }
        String[] hp = habitPeriod(habit, now);
        return compKey(id, hp != null ? hp[0] : dateKey(now));
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
                while (it.hasNext()) { String k = it.next(); JSONObject e = ev.optJSONObject(k); long end = e == null ? 0 : e.optLong("end", e.optLong("start", 0)); if (end < now - 40L * DAY || isPulledCopy(e, now)) drop.add(k); }
                for (String k : drop) ev.remove(k);
            }
            return s;
        } catch (Exception e) { throw new RuntimeException(e); }
    }

    /** An old copy of a Google event (or a deletion Google already has): every device pulls Google itself now. */
    static boolean isPulledCopy(JSONObject e, long now) {
        if (e == null || e.optString("gid").isEmpty() || !e.has("synced") || e.has("link")) return false;
        long ts = e.optLong("ts", 0);
        return e.optLong("synced", 0) >= ts && ts < now - 3600_000L;
    }
    static int dropPulledCopies(JSONObject state, long now) {
        JSONObject ev = state.optJSONObject("events");
        if (ev == null) return 0;
        List<String> drop = new ArrayList<>();
        Iterator<String> it = ev.keys();
        while (it.hasNext()) { String k = it.next(); if (isPulledCopy(ev.optJSONObject(k), now)) drop.add(k); }
        for (String k : drop) ev.remove(k);
        return drop.size();
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
                List<String> pops = new ArrayList<>();
                JSONObject nm = map(state, "notes");
                List<String> nids = new ArrayList<>();
                Iterator<String> it2 = nm.keys();
                while (it2.hasNext()) nids.add(it2.next());
                Collections.sort(nids);
                for (String id : nids) { long[] p = notePops(nm.optJSONObject(id), now); pops.add(id + ":" + p[0] + ":" + p[1]); }
                String popS = join(pops), expPops = c.has("pops") ? join(c.getJSONArray("pops")) : popS;
                if (!popS.equals(expPops)) bad.append("case ").append(i).append(": pops ").append(popS).append('/').append(expPops).append('\n');
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
