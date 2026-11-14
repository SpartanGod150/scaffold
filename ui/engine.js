/* Scaffold engine: the rules every device follows.
   Used by the UI, the desktop app and the Claude command. android/src/.../Engine.java mirrors it: keep both in sync.

   State is a set of last-writer-wins records, so any two copies merge the same way on every device:
   tasks    habits (kept under the old name so existing data still works)
   todos    tasks: one-time or recurring, optional deadline, optional project
   projects user projects, optionally linked to a vault project
   events   calendar events (two-way with Google Calendar through the desktop bridge)
   notes    reminder notes that pop up every N minutes until dismissed
   acks     note dismissals { noteId: { at } }
   vault    catalog of active Obsidian projects, published by the desktops
   comps    completions { id@period }, snoozes { id@day }, log { id: event }, pause { on } */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var MIN = 60000, DAY = 1440 * MIN;
  var NAG_STOP = '23:30';
  var NUDGE_AT = '09:00';
  var MAX_SNOOZES = 2;
  var SNOOZE_MIN = 10;
  var MAPS = ['tasks', 'todos', 'projects', 'events', 'notes', 'acks', 'vault', 'comps', 'snoozes', 'log', 'cfg', 'marks'];   // cfg.relay = Google backup mailbox {url, secret}; marks = "Show in monthly" per event (key: event id, or 'gid:'+gid for repeating Google events)

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
  function scheduledOn(task, t) {
    if (!task || task.del || task.active === false) return false;
    var wd = new Date(t).getDay();
    if (task.days && task.days.length && task.days.indexOf(wd) < 0) return false;
    return dateKey(t) >= (task.from || '0000-00-00');
  }

  function windowOf(task, t) {
    var start = at(t, task.start || '00:00'), due = at(t, task.due || '23:00');
    if (due < start) due = start;
    var stop = Math.max(at(t, NAG_STOP), due + 30 * MIN);
    stop = Math.min(stop, midnightAfter(t) - MIN);
    return { start: start, due: due, stop: stop };
  }

  // When to remind: at the start, every `remind` minutes, every 10 min in the last hour, exactly at the deadline, then every 20 min while late.
  // Tasks whose deadline is on another day get one nudge, at 09:00.
  function reminderTimes(task, w) {
    if (w.nudge) return [w.nudge];
    var out = [], every = Math.max(1, task.remind || 30), t = w.start, lastHour = w.due - 60 * MIN;
    while (t < w.stop && out.length < 1500) {
      out.push(t);
      var step = t >= w.due ? 20 : (t >= lastHour ? Math.min(10, every) : every);
      var nt = t + step * MIN;
      if (t < w.due && nt > w.due) nt = w.due;
      if (t < lastHour && nt > lastHour) nt = lastHour;
      t = nt;
    }
    return out;
  }

  // ---------- tasks (todos) ----------
  // repeat: 'none' (date optional: no date = someday), 'custom' (picked weekdays), 'week' (dueDay 0=Mon..6=Sun), 'month' (dueDay 1..31), 'days' (every N days from date)
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
  function compute(state, now) {
    var day = dateKey(now), paused = !!(state.pause && state.pause.on), items = [];
    var comps = state.comps || {}, snoozes = state.snoozes || {};
    function push(id, task, kind, key, w, extra) {
      var c = comps[key], done = !!(c && !c.undone);
      var sKey = compKey(id, day), s = snoozes[sKey], snoozedUntil = s && s.until > now ? s.until : 0;
      var status = done ? 'done' : now < w.start ? 'upcoming' : now < w.due ? 'open' : 'late';
      var lv = task.level || 1;
      var lockable = !w.nudge && ((lv >= 4 && now >= w.start) || (lv >= 3 && now >= w.due));
      var it = {
        id: id, type: kind, task: task, key: key, sKey: sKey, start: w.start, due: w.due, stop: w.stop, nudge: w.nudge || 0,
        status: status, done: done, doneKind: done ? (c.kind || 'full') : null,
        snoozedUntil: snoozedUntil, snoozesLeft: MAX_SNOOZES - (s ? s.n || 0 : 0),
        locked: !paused && !done && lockable && now < w.stop && !snoozedUntil
      };
      for (var k in extra) it[k] = extra[k];
      items.push(it);
    }
    Object.keys(state.tasks || {}).forEach(function (id) {
      var task = state.tasks[id];
      if (!scheduledOn(task, now)) return;
      push(id, task, 'habit', compKey(id, day), windowOf(task, now), {});
    });
    Object.keys(state.todos || {}).forEach(function (id) {
      var todo = state.todos[id];
      if (!todoActive(todo) || dateKey(now) < (todo.from || '0000-00-00') && (todo.repeat || 'none') !== 'none') return;
      var p = periodOf(todo, now);
      if (!p) return;
      var key = compKey(id, p.key), c = comps[key], done = !!(c && !c.undone);
      if (p.key === 'once' && p.deadline < day && done) return; // finished in the past
      if (p.key === 'once' && p.deadline > day) return;           // not yet
      if (p.deadline === day) {
        push(id, todo, 'todo', key, windowOf(todo, now), { deadlineDay: p.deadline });
      } else {
        var dueT = at(fromKey(p.deadline), todo.due || '21:00');
        var nudge = at(now, NUDGE_AT);
        push(id, todo, 'todo', key, { start: dueT, due: dueT, stop: dueT, nudge: nudge }, { deadlineDay: p.deadline });
      }
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
      var cands = reminderTimes(it.task, it).concat(it.nudge ? [] : [it.start, it.due, it.stop]);
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
      if (hit) out.push({ id: it.id, item: it, at: hit, popup: !it.nudge && ((it.task.level || 1) >= 2 || hit >= it.due) });
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
  // Note text is light Markdown (# heading, - bullet, 1. numbered, - [ ] checklist, **bold** *italic* ~~strike~~ ++underline++).
  // plainNote: the same text without the marks, for notifications.
  function plainNote(text) {
    return String(text || '').split('\n').map(function (l) {
      return l.replace(/^(#{1,2} |- \[[ xX]\] |- |\d+\. )/, function (m) { return /\[[xX]\]/.test(m) ? '☑ ' : /\[ \]/.test(m) ? '☐ ' : /^- /.test(m) ? '• ' : /^\d/.test(m) ? m : ''; })
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
    var todo = (state.todos || {})[id];
    if (todo) { var p = periodOf(todo, now); return compKey(id, p ? p.key : 'once'); }
    return compKey(id, dateKey(now));
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
        if (!scheduledOn(task, t)) { cells.push({ day: day, s: 'none' }); continue; }
        var c = (state.comps || {})[compKey(id, day)], done = c && !c.undone, s;
        if (done) s = c.kind === 'tiny' ? 'tiny' : 'full';
        else if (day === today && now < windowOf(task, now).due) s = 'pending';
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
  // Google events are pulled by each device into state.gev (local only, never synced). state.events holds what was
  // made or edited in Scaffold; an edit wins over the Google copy until Google has the newer version.
  function eventsFor(state) {
    var out = {}, gev = state.gev || {}, byGid = {};
    Object.keys(gev).forEach(function (id) { out[id] = gev[id]; byGid[gev[id].gid + '|' + (gev[id].ro ? gev[id].start : '')] = id; });
    Object.keys(state.events || {}).forEach(function (id) {
      var e = state.events[id], gid = e.gid ? byGid[e.gid + '|' + (e.ro ? e.start : '')] : null;
      if (gid && (gev[gid].gupd || 0) >= (e.ts || 0)) return;   // Google already has this version (or newer)
      if (gid) delete out[gid];
      if (out[id] && (out[id].gupd || 0) >= (e.ts || 0)) return;
      if (e.del) { delete out[id]; return; }
      out[id] = e;
    });
    return out;
  }
  // Old pulled copies (unchanged since they came from Google, or deletions Google already has) are dropped: each device now pulls Google itself.
  function isPulledCopy(e, now) { return !!(e && e.gid && e.synced && e.synced >= (e.ts || 0) && (e.ts || 0) < now - 3600000); }   // older than 1 h: every device has pulled the Google version by then
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
    Object.keys(state.todos || {}).forEach(function (id) {
      var td = state.todos[id];
      if (!todoActive(td)) return;
      if ((td.repeat || 'none') !== 'none' && day < (td.from || '0000-00-00')) return;
      var p = periodOf(td, t);
      if (!p || p.deadline !== day) return;
      var c = (state.comps || {})[compKey(id, p.key)];
      out.push({ kind: 'todo', id: id, rec: td, t: at(t, td.start || td.due || '09:00'), done: !!(c && !c.undone) });
    });
    Object.keys(state.tasks || {}).forEach(function (id) {
      var h = state.tasks[id];
      if (!scheduledOn(h, t)) return;
      var c = (state.comps || {})[compKey(id, day)];
      out.push({ kind: 'habit', id: id, rec: h, t: at(t, h.start || '00:00'), done: !!(c && !c.undone) });
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
    newer: newer, merge: merge, eventsFor: eventsFor, dropPulledCopies: dropPulledCopies, isPulledCopy: isPulledCopy, scheduledOn: scheduledOn, windowOf: windowOf, reminderTimes: reminderTimes, periodOf: periodOf,
    compute: compute, dueReminders: dueReminders, notePops: notePops, pendingNotes: pendingNotes, plainNote: plainNote, stats: stats,
    projectProgress: projectProgress, dayAgenda: dayAgenda, vaultProjects: vaultProjects, itemKey: itemKey,
    chunks: chunks, snapshot: snapshot,
    opPut: opPut, opDel: opDel, opTask: opTask, opDelete: opDelete, opComplete: opComplete, opUndo: opUndo, opSnooze: opSnooze, opPause: opPause, opAck: opAck
  };
});
