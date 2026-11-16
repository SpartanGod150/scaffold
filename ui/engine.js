/* Scaffold engine: the rules every device follows.
   Used by the UI, the desktop app and the Claude command. android/src/.../Engine.java mirrors it: keep both in sync.

   State is a set of last-writer-wins records, so any two copies merge the same way on every device:
   tasks    habits (kept under the old name so existing data still works)
   todos    tasks: done once, optional deadline, optional project (old repeating ones are turned into habits)
   projects user projects, optionally linked to a vault project
   events   calendar events (two-way with Google Calendar through the desktop bridge)
   notes    reminder notes that pop up every N minutes until dismissed
   acks     note dismissals { noteId: { at } }
   vault    catalog of active Obsidian projects, published by the desktops
   comps    completions { id@period }, snoozes { id@day }, log { id: event }, pause { on }
   sess     sessions of designated periods (events linked to a task, habit or project)
   modes    restriction modes; devs: each device's name, platform and installed apps (for editing its lists from anywhere) */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var MIN = 60000, DAY = 1440 * MIN;
  var NAG_STOP = '23:30';
  var MAX_SNOOZES = 2;
  var SNOOZE_MIN = 10;
  var MAPS = ['tasks', 'todos', 'projects', 'events', 'notes', 'acks', 'vault', 'comps', 'snoozes', 'log', 'cfg', 'marks', 'sess', 'modes', 'devs'];   // cfg.relay = Google backup mailbox {url, secret}; marks = "Show in monthly" per event (key: event id, or 'gid:'+gid for repeating Google events)

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dateKey(t) { var d = new Date(t); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function at(t, hhmm) {
    var d = new Date(t), p = String(hhmm || '00:00').split(':');
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), +p[0] || 0, +p[1] || 0, 0, 0).getTime();
  }
  function fromKey(key) { var p = String(key).split('-'); return new Date(+p[0], +p[1] - 1, +p[2], 12).getTime(); }
  function addDays(t, n) { var d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12).getTime(); }
  function daysBetween(a, b) { return Math.round((fromKey(dateKey(b)) - fromKey(dateKey(a))) / DAY); }
  function midnightAfter(t) { var d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0).getTime(); }
  function compKey(taskId, day) { return taskId + '@' + day; }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function hhmm(t) { var d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }

  function emptyState() {
    var s = { v: 2, pause: { on: false, ts: 0, by: '' } };
    MAPS.forEach(function (m) { s[m] = {}; });
    return s;
  }

  function newer(a, b) {
    if (!a) return false;
    if (!b) return true;
    var ta = a.ts || 0, tb = b.ts || 0;
    if (ta !== tb) return ta > tb;
    return (a.by || '') > (b.by || '');
  }

  function merge(into, inc) {
    var changed = false;
    if (!inc) return false;
    MAPS.forEach(function (m) {
      if (!inc[m]) return;
      into[m] = into[m] || {};
      Object.keys(inc[m]).forEach(function (k) {
        if (newer(inc[m][k], into[m][k])) { into[m][k] = inc[m][k]; changed = true; }
      });
    });
    if (inc.pause && newer(inc.pause, into.pause)) { into.pause = inc.pause; changed = true; }
    return changed;
  }

  // ---------- habits ----------
  // Habits repeat forever and keep a record of each period. repeat: 'weekdays' (the default: on the picked weekdays,
  // none = every day; each day is a period), 'week' (dueDay 0=Mon..6=Sun), 'month' (dueDay 1..31), 'every' (every N days from date).
  function weekdayOk(task, t) {
    var wd = new Date(t).getDay();
    return !task.days || !task.days.length || task.days.indexOf(wd) >= 0;
  }
  function habitPeriod(task, t) {
    if (!task || task.del || task.active === false) return null;
    var today = dateKey(t), rep = task.repeat || 'weekdays';
    if (today < (task.from || '0000-00-00')) return null;
    if (rep === 'week' || rep === 'month') return periodOf({ repeat: rep, dueDay: task.dueDay }, t);
    if (rep === 'every') return periodOf({ repeat: 'days', every: task.every, date: task.date || task.from }, t);
    if (!weekdayOk(task, t)) return null;
    return { key: today, first: today, deadline: today };
  }
  function scheduledOn(task, t) { return !!habitPeriod(task, t); }

  // ---------- how hard Scaffold pushes (habits and tasks alike) ----------
  // push: 'off' | 'nudge' (notifications) | 'nag' (pop-ups), every `remind` minutes inside the reminder window rfrom–rto,
  // every day until it is done. lock: every device locks at the deadline until it is done (needs a deadline).
  // Habit deadline: dueOn + due (a time each day of the period's deadline day; blank = end of day). Task deadline: date + due.
  // Older records had level 1–4 (3 = lock at deadline, 4 = lock from start) and a start–due window: read the same way here.
  function pushOf(task, kind) {
    if (task.push) return task.push;
    if (kind === 'todo' && !task.date && (task.repeat || 'none') === 'none') return 'off';   // old someday tasks never reminded
    return (task.level || 1) === 1 ? 'nudge' : 'nag';
  }
  function lockOf(task) { return task.lock != null ? !!task.lock : (task.level || 1) >= 3; }
  function hasDue(task, kind) {
    if (kind === 'todo') return !!task.date || (task.repeat || 'none') !== 'none';
    return task.dueOn != null ? !!task.dueOn : !!task.due;
  }
  function remindWindow(task) { return { from: task.rfrom || task.start || '09:00', to: task.rto || task.due || '21:00' }; }

  // Timing of one item on the day of `now`, for a period p ({key, first, deadline}; deadline null = none).
  function timing(task, kind, p, now) {
    var push = pushOf(task, kind), rw = remindWindow(task), day = dateKey(now), end = midnightAfter(now) - MIN;
    var due = p.deadline && hasDue(task, kind) ? at(fromKey(p.deadline), task.due || '23:59') : 0, dueToday = !!due && p.deadline === day;
    var start = push === 'off' ? at(now, '00:00') : at(now, rw.from), rEnd = rw.to <= rw.from ? end : Math.min(end, at(now, rw.to));
    var stop = dueToday ? Math.min(Math.max(at(now, NAG_STOP), due + 30 * MIN), end) : rEnd;
    return { start: start, due: due || end, hasDue: !!due, dueToday: dueToday, rEnd: rEnd, stop: stop, push: push, lock: lockOf(task) && dueToday, future: !!due && p.deadline > day };
  }

  // When to remind: every `remind` minutes inside the window (every 10 min in the last hour before a deadline that day),
  // exactly at the deadline, then every 20 min while late. No reminders when push is off.
  function reminderTimes(task, w) {
    if (w.push === 'off') return [];
    var out = [], every = Math.max(1, task.remind || 30), lastHour = w.dueToday ? w.due - 60 * MIN : Infinity;
    var end = w.dueToday ? Math.min(w.rEnd, w.due) : w.rEnd, t = w.start;
    while (t < end && out.length < 1500) {
      out.push(t);
      var nt = t + (t >= lastHour ? Math.min(10, every) : every) * MIN;
      if (t < lastHour && nt > lastHour) nt = lastHour;
      t = nt;
    }
    if (w.dueToday) for (t = w.due; t < w.stop && out.length < 1500; t += 20 * MIN) out.push(t);
    return out;
  }

  // ---------- tasks (todos) ----------
  // A task is done once and then it is gone. date = its deadline day (none = no deadline), due = the deadline time.
  // periodOf also serves habit periods, and old repeating tasks until they are turned into habits.
  // repeat: 'none', 'custom' (picked weekdays), 'week' (dueDay 0=Mon..6=Sun), 'month' (dueDay 1..31), 'days' (every N days from date)
  function periodOf(todo, t) {
    var rep = todo.repeat || 'none', today = dateKey(t);
    if (rep === 'week') {
      var d = new Date(t), mon = addDays(t, -((d.getDay() + 6) % 7));
      var dd = todo.dueDay == null ? 6 : +todo.dueDay;
      return { key: 'W' + dateKey(mon), first: dateKey(mon), deadline: dateKey(addDays(mon, dd)) };
    }
    if (rep === 'month') {
      var m = new Date(t), last = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
      var day = Math.min(todo.dueDay ? +todo.dueDay : last, last);
      return { key: today.slice(0, 7), first: today.slice(0, 8) + '01', deadline: today.slice(0, 8) + pad(day) };
    }
    if (rep === 'custom') {   // on the picked weekdays (days: 0=Sun..6=Sat; none = every day), each day is its own period
      var wd = new Date(t).getDay();
      if (todo.days && todo.days.length && todo.days.indexOf(wd) < 0) return null;
      return { key: 'C' + today, first: today, deadline: today };
    }
    if (rep === 'days') {
      var n = Math.max(1, +todo.every || 2), anchor = todo.date || todo.from || today;
      if (today < anchor) return null;
      var idx = Math.floor(daysBetween(fromKey(anchor), t) / n), first = addDays(fromKey(anchor), idx * n);
      return { key: 'D' + dateKey(first), first: dateKey(first), deadline: dateKey(addDays(first, n - 1)) };
    }
    if (!todo.date) return null;
    return { key: 'once', first: todo.date, deadline: todo.date };
  }

  function todoActive(todo) { return todo && !todo.del && todo.active !== false; }

  // ---------- today ----------
  // Habits show on their days (every day of a longer period until it is done). A task shows on its deadline day and after it
  // until done; before it (or with no deadline) only while it has reminders. A finished task stays on the day it was finished.
  function compute(state, now) {
    var day = dateKey(now), paused = !!(state.pause && state.pause.on), items = [];
    var comps = state.comps || {}, snoozes = state.snoozes || {};
    function push(id, task, kind, key, p) {
      var c = comps[key], done = !!(c && !c.undone), w = timing(task, kind, p, now);
      var sKey = compKey(id, day), s = snoozes[sKey], snoozedUntil = s && s.until > now ? s.until : 0;
      var status = done ? 'done' : w.hasDue && now >= w.due ? 'late' : now < w.start ? 'upcoming' : 'open';
      var it = {
        id: id, type: kind, task: task, key: key, sKey: sKey, start: w.start, due: w.due, stop: w.stop, rEnd: w.rEnd,
        hasDue: w.hasDue, dueToday: w.dueToday, future: w.future, push: w.push, deadlineDay: w.hasDue ? p.deadline : null,
        status: status, done: done, doneKind: done ? (c.kind || 'full') : null,
        snoozedUntil: snoozedUntil, snoozesLeft: MAX_SNOOZES - (s ? s.n || 0 : 0),
        locked: !paused && !done && w.lock && now >= w.due && now < w.stop && !snoozedUntil
      };
      items.push(it);
    }
    Object.keys(state.tasks || {}).forEach(function (id) {
      var task = state.tasks[id], p = habitPeriod(task, now);
      if (p) push(id, task, 'habit', compKey(id, p.key), p);
    });
    Object.keys(state.todos || {}).forEach(function (id) {
      var todo = state.todos[id];
      if (!todoActive(todo)) return;
      if ((todo.repeat || 'none') !== 'none') {   // old repeating task
        if (day < (todo.from || '0000-00-00')) return;
        var rp = periodOf(todo, now);
        if (rp) push(id, todo, 'todo', compKey(id, rp.key), rp);
        return;
      }
      var key = compKey(id, 'once'), c = comps[key];
      if (c && !c.undone) { if (dateKey(c.ts || 0) === day) push(id, todo, 'todo', key, { key: 'once', deadline: todo.date || null }); return; }
      if (todo.date ? todo.date > day && pushOf(todo, 'todo') === 'off' : pushOf(todo, 'todo') === 'off') return;
      push(id, todo, 'todo', key, { key: 'once', deadline: todo.date || null });
    });
    items.sort(function (a, b) { return (a.due - b.due) || (a.start - b.start) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); });
    var lock = null, done = 0;
    items.forEach(function (it) { if (it.locked && !lock) lock = it; if (it.done) done++; });
    var notes = pendingNotes(state, now);
    return { day: day, paused: paused, items: items, lock: lock, done: done, total: items.length, notes: notes, next: nextEvent(state, items, now, paused) };
  }

  function nextEvent(state, items, now, paused) {
    var best = midnightAfter(now) + 1000;
    if (paused) return best;
    items.forEach(function (it) {
      if (it.done) return;
      var cands = reminderTimes(it.task, it).concat([it.start], it.dueToday ? [it.due, it.stop] : []);
      if (it.snoozedUntil) cands.push(it.snoozedUntil);
      cands.forEach(function (t) { if (t > now && t < best) best = t; });
    });
    Object.keys(state.notes || {}).forEach(function (id) {
      var n = notePops(state.notes[id], now);
      if (n.next && n.next > now && n.next < best) best = n.next;
    });
    return best;
  }

  // Reminders that fall in (from, to]. At most one per item; stale ones (over 30 min old) are skipped.
  // Nag reminders pop up; nudges are notifications, except at and after a deadline.
  function dueReminders(state, from, to) {
    var r = compute(state, to);
    if (r.paused) return [];
    from = Math.max(from, to - 30 * MIN);
    var out = [];
    r.items.forEach(function (it) {
      if (it.done || it.snoozedUntil) return;
      var hit = 0;
      reminderTimes(it.task, it).forEach(function (t) { if (t > from && t <= to) hit = t; });
      var s = (state.snoozes || {})[it.sKey];
      if (s && s.until > from && s.until <= to) hit = Math.max(hit, s.until);
      if (hit) out.push({ id: it.id, item: it, at: hit, popup: it.push === 'nag' || (it.dueToday && hit >= it.due) });
    });
    return out;
  }

  // ---------- reminder notes ----------
  // days: weekdays (0=Sun..6=Sat) the note is active; none = every day. A window that crosses midnight belongs to the day it starts.
  function dayOk(note, t) { var ds = note.days; return !ds || !ds.length || ds.indexOf(new Date(t).getDay()) >= 0; }
  function inHours(note, t) {
    var from = note.from || '00:00', to = note.to || '24:00', x = hhmm(t);
    if (from === to) return dayOk(note, t);
    if (from < to) return x >= from && x < to && dayOk(note, t);
    return (x >= from && dayOk(note, t)) || (x < to && dayOk(note, addDays(t, -1)));
  }
  // First moment after t when the note's window opens (0 = never).
  function nextOpen(note, t) {
    var from = note.from || '00:00', to = note.to || '24:00', s = from === to ? '00:00' : from;
    for (var d = 0; d <= 8; d++) { var w = at(addDays(t, d), s); if (w > t && inHours(note, w)) return w; }
    return 0;
  }
  // Latest window end (exclusive) at or before t (0 = none in the last 9 days).
  function prevClose(note, t) {
    var from = note.from || '00:00', to = note.to || '24:00', best = 0;
    for (var d = 0; d <= 9; d++) {
      var D = addDays(t, -d); if (!dayOk(note, D)) continue;
      var e = from === to ? at(addDays(D, 1), '00:00') : from < to ? at(D, to) : at(addDays(D, 1), to);
      if (e <= t && e > best) best = e;
    }
    return best;
  }
  // Pops at anchor + k*every, only inside the note's active hours and days. last = latest pop at or before now.
  function notePops(note, now) {
    if (!note || note.del || note.active === false) return { last: 0, next: 0 };
    var every = Math.max(1, +note.every || 60) * MIN, anchor = note.anchor || note.ts || 0;
    if (now < anchor) return { last: 0, next: anchor };
    var k = Math.floor((now - anchor) / every), last = anchor + k * every, next = last + every;
    for (var j = 0; j < 500 && last >= anchor && !inHours(note, last); j++) {
      var e = prevClose(note, last); if (!e) { last = 0; break; }
      last -= Math.max(1, Math.ceil((last - e + 1) / every)) * every;
    }
    if (last < anchor || !inHours(note, last)) last = 0;
    for (var i = 0; i < 500 && !inHours(note, next); i++) {
      var w = nextOpen(note, next); if (!w) { next = 0; break; }
      next += Math.max(1, Math.ceil((w - next) / every)) * every;
    }
    if (next && !inHours(note, next)) next = 0;
    return { last: last, next: next };
  }
  // Note text is light Markdown (a tab per indent level; # heading, - bullet, 1. numbered, - [ ] checklist, **bold** *italic* ~~strike~~ ++underline++).
  // plainNote: the same text without the marks, for notifications.
  function plainNote(text) {
    return String(text || '').split('\n').map(function (l) {
      var ind = /^\t*/.exec(l)[0]; l = l.slice(ind.length);
      return ind.replace(/\t/g, '  ') + l.replace(/^(#{1,2} |- \[[ xX]\] |- |\d+\. )/, function (m) { return /\[[xX]\]/.test(m) ? '☑ ' : /\[ \]/.test(m) ? '☐ ' : /^- /.test(m) ? '• ' : /^\d/.test(m) ? m : ''; })
        .replace(/\\(.)|\*\*|~~|\+\+|\*/g, function (m, c) { return c || ''; });
    }).join('\n');
  }
  function pendingNotes(state, now) {
    if (state.pause && state.pause.on) return [];
    var out = [];
    Object.keys(state.notes || {}).forEach(function (id) {
      var note = state.notes[id], p = notePops(note, now), ack = (state.acks || {})[id];
      if (p.last && (!ack || ack.at < p.last)) out.push({ id: id, note: note, since: p.last });
    });
    out.sort(function (a, b) { return a.since - b.since || (a.id < b.id ? -1 : 1); });
    return out;
  }

  // ---------- operations: each returns a patch to merge locally and broadcast ----------
  function one(map, key, val) { var p = {}; p[map] = {}; p[map][key] = val; return p; }
  function opPut(map, rec, by, now) {
    var t = JSON.parse(JSON.stringify(rec));
    if (!t.id) t.id = uid();
    if (!t.from && (map === 'tasks' || map === 'todos')) t.from = dateKey(now);
    if (map === 'notes' && !t.anchor) t.anchor = now;
    t.ts = now; t.by = by;
    return one(map, t.id, t);
  }
  function opDel(map, rec, by, now) {
    var t = JSON.parse(JSON.stringify(rec)); t.del = true; t.ts = now; t.by = by;
    return one(map, t.id, t);
  }
  function opTask(task, by, now) { return opPut('tasks', task, by, now); }
  function opDelete(task, by, now) { return opDel('tasks', task, by, now); }
  function itemKey(state, id, now) {
    var todo = (state.todos || {})[id], habit = (state.tasks || {})[id];
    if (todo) { var p = (todo.repeat || 'none') !== 'none' ? periodOf(todo, now) : null; return compKey(id, p ? p.key : 'once'); }
    var hp = habit && habitPeriod(habit, now);
    return compKey(id, hp ? hp.key : dateKey(now));
  }
  function opComplete(id, kind, by, now, state) { return one('comps', state ? itemKey(state, id, now) : compKey(id, dateKey(now)), { kind: kind || 'full', ts: now, by: by }); }
  function opUndo(id, by, now, state) { return one('comps', state ? itemKey(state, id, now) : compKey(id, dateKey(now)), { undone: true, ts: now, by: by }); }
  function opSnooze(state, id, by, now) {
    var key = compKey(id, dateKey(now)), s = (state.snoozes || {})[key], n = s ? s.n || 0 : 0;
    if (n >= MAX_SNOOZES) return null;
    return one('snoozes', key, { n: n + 1, until: now + SNOOZE_MIN * MIN, ts: now, by: by });
  }
  function opPause(on, by, now) {
    var p = one('log', uid(), { type: on ? 'stop' : 'resume', ts: now, by: by });
    p.pause = { on: !!on, ts: now, by: by };
    return p;
  }
  function opAck(noteId, by, now) { return one('acks', noteId, { at: now, ts: now, by: by }); }

  // ---------- stats (habit tracker) ----------
  function stats(state, now, days) {
    days = days || 28;
    var today = dateKey(now), d0 = new Date(now), tasks = [], sum = 0, count = 0;
    Object.keys(state.tasks || {}).forEach(function (id) {
      var task = state.tasks[id];
      if (task.del) return;
      var cells = [], tSum = 0, tCount = 0, streak = 0;
      for (var i = days - 1; i >= 0; i--) {
        var t = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() - i, 12).getTime(), day = dateKey(t);
        var p = habitPeriod(task, t);
        if (!p) { cells.push({ day: day, s: 'none' }); continue; }
        var c = (state.comps || {})[compKey(id, p.key)], done = c && !c.undone, s;
        if (p.key !== day && (done ? dateKey(c.ts || 0) !== day : day !== p.deadline)) { cells.push({ day: day, s: 'none' }); continue; }   // a longer period shows once: the day it was done, or its deadline day
        if (done) s = c.kind === 'tiny' ? 'tiny' : 'full';
        else if (day === today && now < timing(task, 'habit', p, now).due) s = 'pending';
        else s = 'miss';
        cells.push({ day: day, s: s });
        if (s !== 'pending' && i < 7) { tCount++; tSum += s === 'full' ? 1 : s === 'tiny' ? 0.5 : 0; }
      }
      for (var j = cells.length - 1; j >= 0; j--) {
        var cs = cells[j].s;
        if (cs === 'none' || cs === 'pending') continue;
        if (cs === 'miss') break;
        streak++;
      }
      sum += tSum; count += tCount;
      tasks.push({ id: id, task: task, cells: cells, week: tCount ? tSum / tCount : null, streak: streak });
    });
    var stops = 0, weekAgo = now - 7 * DAY;
    Object.keys(state.log || {}).forEach(function (k) { var e = state.log[k]; if (e.type === 'stop' && e.ts > weekAgo) stops++; });
    return { week: count ? sum / count : null, tasks: tasks, stops: stops };
  }

  // Project progress: share of its tasks done (current period for recurring ones).
  function projectProgress(state, pid, now) {
    var total = 0, done = 0;
    Object.keys(state.todos || {}).forEach(function (id) {
      var t = state.todos[id];
      if (!todoActive(t) || t.project !== pid) return;
      total++;
      var c = (state.comps || {})[itemKey(state, id, now)];
      if (c && !c.undone) done++;
    });
    return { total: total, done: done };
  }

  // ---------- calendar events ----------
  // Google events are pulled by each device into state.gev (local only, never synced; keys starting with "_" hold the
  // calendar list and colors). state.events holds what was made or edited in Scaffold; an edit wins over the Google copy
  // until Google has the newer version. Edits of a repeating event carry scope ('one' | 'following' | 'all'), series and
  // ostart (the occurrence's original start); 'following' / 'all' edits show on the other occurrences right away.
  // A new repeating event (rrule) shows its occurrences locally until Google has it.
  function gkey(e) { return e.gid + '|' + (e.ro && e.v !== 2 ? e.start : ''); }   // old bridge: one id for every occurrence
  function eventsFor(state) {
    var out = {}, gev = state.gev || {}, byGid = {}, spread = [], series = [];
    Object.keys(gev).forEach(function (id) { if (id.charAt(0) === '_') return; out[id] = gev[id]; byGid[gkey(gev[id])] = id; });
    Object.keys(state.events || {}).forEach(function (id) {
      var e = state.events[id], wide = e.series && e.scope && e.scope !== 'one';
      if ((wide || e.rrule) && e.synced && e.synced >= (e.ts || 0)) return;   // on Google now: its own copies show
      var gid = e.gid ? byGid[gkey(e)] : null;
      if (gid && (gev[gid].gupd || 0) >= (e.ts || 0)) return;   // Google already has this version (or newer)
      if (gid) delete out[gid];
      if (out[id] && (out[id].gupd || 0) >= (e.ts || 0)) return;
      if (wide) spread.push(e);
      if (e.del) { delete out[id]; return; }
      out[id] = e;
      if (e.rrule && !e.series) series.push(e);
    });
    spread.forEach(function (e) {
      Object.keys(out).forEach(function (k) {
        var g = out[k], os = g.ostart || g.start;
        if (g === e || g.series !== e.series || (g.gupd || 0) >= (e.ts || 0) || (e.scope === 'following' && os < e.ostart)) return;
        if (e.del) { delete out[k]; return; }
        var c = {}; for (var f in g) c[f] = g[f];
        c.title = e.title; c.desc = e.desc; c.color = e.color; c.cal = e.cal;
        if (!e.allDay && !g.allDay) { c.start = os + (e.start - e.ostart); c.end = c.start + (e.end - e.start); }
        out[k] = c;
      });
    });
    series.forEach(function (e) {
      expandRule(e, 400).slice(1).forEach(function (t, i) {
        var c = {}; for (var f in e) c[f] = e[f];
        c.id = e.id + '~' + (i + 1); c.virt = e.id; c.start = t; c.end = t + (e.end - e.start);
        out[c.id] = c;
      });
    });
    return out;
  }

  // ---------- designated periods: events linked to a task, a habit or a project ----------
  // A Scaffold event carries link { k: 'todo' | 'habit' | 'project' | '' (unlinked), id, o (the first linked event's id) }.
  // Google's copies have no link: they find it through the Scaffold record by id, gid or series (the newest record wins).
  // sess holds each session (one occurrence): key o@YYYY-MM-DD → { done: when "End Session" was pressed, tasks: [task ids] (project sessions) }.
  function linkIndex(state) {
    var ix = {};
    function put(k, e, id) { if (k && (!ix[k] || (ix[k].ts || 0) < (e.ts || 0))) ix[k] = { link: e.link || null, o: (e.link && e.link.o) || id, mode: e.mode, ts: e.ts || 0 }; }
    Object.keys(state.events || {}).forEach(function (id) {
      var e = state.events[id];
      if (!e || e.del || (!e.link && e.mode == null)) return;
      put('i:' + id, e, id);
      if (e.gid) put('g:' + e.gid, e, id);
      if (e.series && e.scope && e.scope !== 'one') put('g:' + e.series, e, id);
    });
    return ix;
  }
  function linkOf(ix, e) {
    var L = ix['i:' + (e.virt || e.id)] || (e.gid && ix['g:' + e.gid]) || (e.series && ix['g:' + e.series]) || null;
    return L && L.link && L.link.k ? L : null;
  }
  function sessKey(L, e) { return L.o + '@' + dateKey(e.ostart || e.start); }
  // The time blocks of one task / habit / project between from and to, soonest first. A task also gets the project
  // sessions it was given. Each: { e (the event), key (its session key), start, end, done (session ended), via ('project' or '') }.
  function blocksFor(state, k, id, from, to) {
    var ix = linkIndex(state), evs = eventsFor(state), sess = state.sess || {}, out = [], pid = k === 'todo' && state.todos && state.todos[id] ? state.todos[id].project : '';
    Object.keys(evs).forEach(function (eid) {
      var e = evs[eid];
      if (!e || e.del || e.start >= to || (e.end || e.start) <= from) return;
      var L = linkOf(ix, e); if (!L) return;
      var key = sessKey(L, e), s = sess[key], via = '';
      if (L.link.k !== k || L.link.id !== id) {
        if (!(k === 'todo' && L.link.k === 'project' && L.link.id === pid && s && (s.tasks || []).indexOf(id) >= 0)) return;
        via = 'project';
      }
      out.push({ e: e, link: L.link, key: key, start: e.start, end: e.end || e.start, done: !!(s && s.done), via: via });
    });
    out.sort(function (a, b) { return a.start - b.start; });
    return out;
  }
  // Every linked block between from and to (for the calendar and the Today session card).
  function linkedBlocks(state, from, to) {
    var ix = linkIndex(state), evs = eventsFor(state), sess = state.sess || {}, out = [];
    Object.keys(evs).forEach(function (eid) {
      var e = evs[eid];
      if (!e || e.del || e.start >= to || (e.end || e.start) <= from) return;
      var L = linkOf(ix, e); if (!L) return;
      var key = sessKey(L, e), s = sess[key];
      out.push({ e: e, link: L.link, key: key, start: e.start, end: e.end || e.start, done: !!(s && s.done), tasks: (s && s.tasks) || [] });
    });
    out.sort(function (a, b) { return a.start - b.start; });
    return out;
  }

  // ---------- restriction modes ----------
  // modes: { name, emoji, color, list: 'black' (block the listed) | 'white' (block all but the listed), dev: { deviceId: { apps: [ids], sites: [domains] } } }.
  // Full Lock is built in: a white list with nothing on it. Only one mode runs at a time: a deadline lock's mode (lockMode, Full Lock
  // by default) wins; otherwise the newest of the hand-picked mode (cfg.modeOn { mode, at, until (0 = until turned off) }) and the
  // running events with a mode. When the newest ends, the one it replaced comes back. Unblockable apps / sites per device: cfg.unblock.
  var FULL_LOCK = { id: 'full', name: 'Full Lock', emoji: '🔒', color: '#ff7a90', list: 'white', dev: {}, builtin: true };
  function modeById(state, id) { if (id === 'full') return FULL_LOCK; var m = id && (state.modes || {})[id]; return m && !m.del ? m : null; }
  function modeOfRec(ix, e) {
    if (e.mode != null) return e.mode;
    var L = ix['i:' + (e.virt || e.id)] || (e.gid && ix['g:' + e.gid]) || (e.series && ix['g:' + e.series]);
    return L ? L.mode || '' : '';
  }
  // Events running at `now` that turn on a mode. Scaffold's own records count until Google has them; Google's copies find their
  // mode through those records (by id, gid or series), like links do.
  function modeEvents(state, now) {
    var ix = linkIndex(state), out = [], gev = state.gev || {}, local = state.events || {}, mine = {};
    Object.keys(local).forEach(function (id) {
      var e = local[id];
      if (!e || (e.synced && e.synced >= (e.ts || 0))) return;
      mine['i:' + id] = 1; if (e.gid) mine['g:' + e.gid] = 1;
      if (e.del) return;
      var len = (e.end || e.start) - e.start, m = modeOfRec(ix, e);
      if (!m) return;
      (e.rrule && !e.series ? expandRule(e, 400) : [e.start]).forEach(function (t) { if (t <= now && now < t + len) out.push({ id: id, start: t, end: t + len, mode: m, title: e.title || '' }); });
    });
    Object.keys(gev).forEach(function (id) {
      var g = gev[id];
      if (id.charAt(0) === '_' || !g || mine['i:' + id] || (g.gid && mine['g:' + g.gid])) return;
      if (g.start <= now && now < (g.end || g.start)) { var m = modeOfRec(ix, g); if (m) out.push({ id: id, start: g.start, end: g.end, mode: m, title: g.title || '' }); }
    });
    return out;
  }
  // The mode running now: { mode, src: 'lock' | 'event' | 'manual', start, until (0 = no set end), item / event, title } or null.
  function activeMode(state, now, r) {
    if (state.pause && state.pause.on) return null;
    r = r || compute(state, now);
    if (r.lock) return { mode: modeById(state, r.lock.task.lockMode || 'full') || FULL_LOCK, src: 'lock', start: r.lock.due, until: 0, item: r.lock.id, title: r.lock.task.title || '' };
    var best = null;
    function cand(c) { if (!best || c.start > best.start || (c.start === best.start && (c.src === 'event' && best.src !== 'event' || (c.src === best.src && (c.event || '') > (best.event || ''))))) best = c; }
    var mo = (state.cfg || {}).modeOn;
    if (mo && !mo.del && mo.mode && (!mo.until || mo.until > now) && (mo.at || 0) <= now) { var mm = modeById(state, mo.mode); if (mm) cand({ mode: mm, src: 'manual', start: mo.at || 0, until: mo.until || 0, title: '' }); }
    modeEvents(state, now).forEach(function (e) { var m = modeById(state, e.mode); if (m) cand({ mode: m, src: 'event', start: e.start, until: e.end, event: e.id, title: e.title }); });
    return best;
  }
  function unblockOf(state, dev) { var u = (state.cfg || {}).unblock; return u && !u.del && u.dev && u.dev[dev] ? u.dev[dev] : null; }   // null: not set yet, the device's preset applies
  function modeList(mode, dev) { var d = (mode && mode.dev || {})[dev] || {}; return { apps: d.apps || [], sites: d.sites || [] }; }
  // preset: this device's default unblockables { apps, sites }, used until the user sets the list.
  function appBlocked(state, act, dev, app, preset) {
    if (!act || !app) return false;
    var u = unblockOf(state, dev) || preset || {};
    if ((u.apps || []).indexOf(app) >= 0) return false;
    var listed = modeList(act.mode, dev).apps.indexOf(app) >= 0;
    return act.mode.list === 'white' ? !listed : listed;
  }
  // Websites (computers): new tabs, the browser's own pages and search always work; only actual websites are blocked.
  function parseUrl(text) {
    var t = String(text || '').trim();
    if (!t) return { host: '', path: '/' };
    var m = /^([a-z][a-z0-9+.-]*):\/\/([^\/?#]*)([^?#]*)/i.exec(t);
    if (!m) { if (/^[a-z]+:/i.test(t) && !/^[\w.-]+:\d/.test(t)) return { host: '', path: '/', internal: true }; m = /^()([^\/?#\s]*)([^?#\s]*)/.exec(t); if (!m || m[2].indexOf('.') < 0) return { host: '', path: '/', internal: true }; }
    var scheme = (m[1] || 'https').toLowerCase();
    if (scheme !== 'http' && scheme !== 'https') return { host: '', path: '/', internal: true };
    return { host: m[2].toLowerCase().replace(/^.*@/, '').replace(/:\d+$/, '').replace(/^www\./, ''), path: m[3] || '/' };
  }
  function isSearch(u) {
    var h = u.host, p = u.path;
    if (/^google\.[a-z.]+$/.test(h)) return /^\/(search|webhp)?\/?$/.test(p);
    if (h === 'bing.com' || h === 'ecosia.org' || h === 'yandex.com' || h === 'yandex.ru') return /^\/(search)?\/?$/.test(p);
    return h === 'duckduckgo.com' || h === 'search.brave.com' || h === 'search.yahoo.com' || h === 'startpage.com';
  }
  function siteMatch(host, list) {
    return list.some(function (s) { var x = parseUrl(s).host || String(s).toLowerCase().trim(); return x && (host === x || host.slice(-x.length - 1) === '.' + x); });
  }
  function siteBlocked(state, act, dev, url, preset) {
    if (!act) return false;
    var u = parseUrl(url);
    if (!u.host || isSearch(u)) return false;
    var ub = unblockOf(state, dev) || preset || {};
    if (siteMatch(u.host, ub.sites || [])) return false;
    var listed = siteMatch(u.host, modeList(act.mode, dev).sites);
    return act.mode.list === 'white' ? !listed : listed;
  }

  // Repeat rules (Google's RRULE). The simple ones Scaffold can edit: daily, weekly on days, monthly, yearly; ends by count or date.
  var RDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  function parseRule(text) {
    var m = /(?:^|\n)RRULE:([^\n]*)/.exec(text || ''); if (!m) return null;
    var o = {}; m[1].split(';').forEach(function (p) { var kv = p.split('='); o[kv[0]] = kv[1] || ''; });
    var r = { freq: (o.FREQ || '').toLowerCase(), days: o.BYDAY ? o.BYDAY.split(',').map(function (d) { return RDAYS.indexOf(d); }) : [], count: o.COUNT ? +o.COUNT : 0, until: '' };
    if (o.UNTIL) {
      var u = o.UNTIL;
      if (u.length > 8) { r.untilMs = Date.UTC(+u.slice(0, 4), +u.slice(4, 6) - 1, +u.slice(6, 8), +u.slice(9, 11), +u.slice(11, 13), +u.slice(13, 15)); r.until = dateKey(r.untilMs); }
      else r.until = u.slice(0, 4) + '-' + u.slice(4, 6) + '-' + u.slice(6, 8);
    }
    r.simple = ['daily', 'weekly', 'monthly', 'yearly'].indexOf(r.freq) >= 0 && (!o.INTERVAL || o.INTERVAL === '1') && (r.freq === 'weekly' || !o.BYDAY) &&
      r.days.every(function (d) { return d >= 0; }) && Object.keys(o).every(function (k) { return ['FREQ', 'BYDAY', 'COUNT', 'UNTIL', 'INTERVAL', 'WKST'].indexOf(k) >= 0; });
    return r;
  }
  // r: { freq, days (weekly, 0=Sun), count, until (YYYY-MM-DD, last day included) }
  function buildRule(r, allDay) {
    if (!r || !r.freq) return '';
    var s = 'RRULE:FREQ=' + r.freq.toUpperCase();
    if (r.freq === 'weekly' && r.days && r.days.length) s += ';BYDAY=' + r.days.slice().sort().map(function (d) { return RDAYS[d]; }).join(',');
    if (r.count) s += ';COUNT=' + r.count;
    else if (r.until) {
      if (allDay) s += ';UNTIL=' + r.until.replace(/-/g, '');
      else { var u = new Date(at(fromKey(r.until), '23:59') + 59000); s += ';UNTIL=' + u.getUTCFullYear() + pad(u.getUTCMonth() + 1) + pad(u.getUTCDate()) + 'T' + pad(u.getUTCHours()) + pad(u.getUTCMinutes()) + pad(u.getUTCSeconds()) + 'Z'; }
    }
    return s;
  }
  // Start times of the first occurrences (at most max) of event e with e.rrule.
  function expandRule(e, max) {
    var r = parseRule(e.rrule), out = [], hm = hhmm(e.start), d0 = new Date(e.start);
    if (!r || !r.simple) return [e.start];
    for (var i = 0; i < 800 && out.length < max; i++) {
      var day = addDays(e.start, i), dd = new Date(day), ok;
      if (r.freq === 'daily') ok = true;
      else if (r.freq === 'weekly') ok = r.days.length ? r.days.indexOf(dd.getDay()) >= 0 : dd.getDay() === d0.getDay();
      else if (r.freq === 'monthly') ok = dd.getDate() === d0.getDate();
      else ok = dd.getDate() === d0.getDate() && dd.getMonth() === d0.getMonth();
      if (!ok) continue;
      var t = e.allDay ? at(day, '00:00') : at(day, hm);
      if (r.untilMs ? t > r.untilMs : r.until && dateKey(day) > r.until) break;
      out.push(t);
      if (r.count && out.length >= r.count) break;
    }
    return out;
  }
  // Old pulled copies (unchanged since they came from Google, or deletions Google already has) are dropped: each device now pulls Google itself.
  function isPulledCopy(e, now) { return !!(e && e.gid && !e.link && e.mode == null && e.synced && e.synced >= (e.ts || 0) && (e.ts || 0) < now - 3600000); }   // older than 1 h: every device has pulled the Google version by then
  function dropPulledCopies(state, now) {
    var n = 0;
    Object.keys(state.events || {}).forEach(function (k) { if (isPulledCopy(state.events[k], now)) { delete state.events[k]; n++; } });
    return n;
  }

  // Everything that falls on a given day, for the calendar.
  function dayAgenda(state, t) {
    var day = dateKey(t), start = at(t, '00:00'), end = midnightAfter(t), out = [], evs = eventsFor(state);
    Object.keys(evs).forEach(function (id) {
      var e = evs[id];
      if (e.del || e.task) return;
      if (e.start < end && (e.end || e.start) > start) out.push({ kind: 'event', id: id, rec: e, t: e.allDay ? start : e.start });
    });
    Object.keys(state.todos || {}).forEach(function (id) {   // task deadlines (habits and tasks themselves show through their designated events)
      var td = state.todos[id];
      if (!todoActive(td) || (td.repeat || 'none') !== 'none' || td.date !== day) return;
      var c = (state.comps || {})[compKey(id, 'once')];
      out.push({ kind: 'todo', id: id, rec: td, t: at(t, td.due || '23:59'), done: !!(c && !c.undone) });
    });
    out.sort(function (a, b) { return a.t - b.t; });
    return out;
  }

  // Vault catalog records may be split in parts (key#n); join them back per project.
  function vaultProjects(state) {
    var by = {};
    Object.keys(state.vault || {}).forEach(function (k) {
      var r = state.vault[k];
      if (r.del) return;
      var base = k.split('#')[0];
      var p = by[base] || (by[base] = { key: base, items: [], parts: [] });
      p.parts.push(r);
      if (r.name) { p.name = r.name; p.path = r.path; p.desc = r.desc || ''; p.total = r.total; }
    });
    return Object.keys(by).map(function (k) {
      var p = by[k];
      p.parts.sort(function (a, b) { return (a.part || 0) - (b.part || 0); });
      p.parts.forEach(function (r) { p.items = p.items.concat(r.items || []); });
      delete p.parts;
      return p;
    }).filter(function (p) { return p.name; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
  }

  // ---------- sync helpers: split a patch into pieces small enough for one relay message ----------
  function chunks(patch, maxRaw) {
    maxRaw = maxRaw || 2600;
    var out = [], cur = {}, size = 2;
    function flush() { if (Object.keys(cur).length) out.push(cur); cur = {}; size = 2; }
    if (patch.pause) { cur.pause = patch.pause; size += JSON.stringify(patch.pause).length + 10; }
    MAPS.forEach(function (m) {
      if (!patch[m]) return;
      Object.keys(patch[m]).forEach(function (k) {
        var len = JSON.stringify(patch[m][k]).length + k.length + 8;
        if (size + len > maxRaw && size > 2) flush();
        cur[m] = cur[m] || {};
        cur[m][k] = patch[m][k];
        size += len + m.length;
      });
    });
    flush();
    return out;
  }

  // Full state minus old completions and events, for snapshots.
  function snapshot(state, now) {
    var cut = dateKey(now - 40 * DAY), s = JSON.parse(JSON.stringify(state));
    Object.keys(s.comps || {}).forEach(function (k) { var p = k.split('@')[1] || ''; if (/^\d{4}-\d\d-\d\d$/.test(p) && p < cut) delete s.comps[k]; });
    Object.keys(s.snoozes || {}).forEach(function (k) { if ((k.split('@')[1] || '') < cut) delete s.snoozes[k]; });
    Object.keys(s.events || {}).forEach(function (k) { var e = s.events[k]; if ((e.end || e.start || 0) < now - 40 * DAY || isPulledCopy(e, now)) delete s.events[k]; });
    delete s.gev;
    return s;
  }

  return {
    MIN: MIN, DAY: DAY, MAPS: MAPS, MAX_SNOOZES: MAX_SNOOZES, SNOOZE_MIN: SNOOZE_MIN,
    pad: pad, dateKey: dateKey, fromKey: fromKey, addDays: addDays, at: at, hhmm: hhmm, compKey: compKey, uid: uid, emptyState: emptyState,
    newer: newer, merge: merge, eventsFor: eventsFor, parseRule: parseRule, buildRule: buildRule, expandRule: expandRule, dropPulledCopies: dropPulledCopies, isPulledCopy: isPulledCopy, scheduledOn: scheduledOn, habitPeriod: habitPeriod, pushOf: pushOf, lockOf: lockOf, hasDue: hasDue, timing: timing, reminderTimes: reminderTimes, periodOf: periodOf,
    compute: compute, dueReminders: dueReminders, notePops: notePops, pendingNotes: pendingNotes, plainNote: plainNote, stats: stats,
    projectProgress: projectProgress, dayAgenda: dayAgenda, linkIndex: linkIndex, linkOf: linkOf, sessKey: sessKey, blocksFor: blocksFor, linkedBlocks: linkedBlocks, FULL_LOCK: FULL_LOCK, modeById: modeById, modeEvents: modeEvents, activeMode: activeMode, unblockOf: unblockOf, modeList: modeList, appBlocked: appBlocked, siteBlocked: siteBlocked, parseUrl: parseUrl, vaultProjects: vaultProjects, itemKey: itemKey,
    chunks: chunks, snapshot: snapshot,
    opPut: opPut, opDel: opDel, opTask: opTask, opDelete: opDelete, opComplete: opComplete, opUndo: opUndo, opSnooze: opSnooze, opPause: opPause, opAck: opAck
  };
});
