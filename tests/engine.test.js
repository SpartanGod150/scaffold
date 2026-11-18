// Run: node tests/engine.test.js   (also writes tests/fixture-out.json, which the Android self-test compares against)
const E = require('../shared/engine.js');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let pass = 0;
function t(name, fn) { try { fn(); pass++; } catch (e) { console.error('FAIL', name, '\n', e.message); process.exitCode = 1; } }

const day = new Date(2026, 10, 9); // Mon 9 Nov 2026
const at = (hhmm) => E.at(day.getTime(), hhmm);
const base = () => {
  const s = E.emptyState();
  Object.assign(s.tasks, E.opTask({ id: 'read', title: 'Read', emoji: '📖', dueOn: true, due: '21:00', rfrom: '20:00', rto: '21:00', push: 'nag', lock: true, kind: 'timer', minutes: 20, remind: 30 }, 'A', at('08:00')).tasks);
  Object.assign(s.tasks, E.opTask({ id: 'teeth', title: 'Brush teeth', emoji: '🪥', dueOn: true, due: '07:00', rfrom: '06:30', rto: '07:00', push: 'nag', lock: true, kind: 'check', remind: 15 }, 'A', at('06:00')).tasks);
  Object.assign(s.tasks, E.opTask({ id: 'study', title: 'Study', emoji: '📚', dueOn: true, due: '18:00', rfrom: '14:00', rto: '18:00', push: 'nag', days: [1, 3, 5], remind: 60 }, 'A', at('06:00')).tasks);
  Object.assign(s.tasks, E.opTask({ id: 'gym', title: 'Gym', emoji: '🏋️', dueOn: true, due: '11:00', rfrom: '10:00', rto: '11:00', push: 'nudge', days: [2, 4] }, 'A', at('06:00')).tasks);
  return s;
};

t('scheduling by weekday', () => {
  const r = E.compute(base(), at('12:00'));
  assert.deepStrictEqual(r.items.map(i => i.id), ['teeth', 'study', 'read']);
});

t('lock at deadline, until done or 23:30', () => {
  const s = base();
  assert.strictEqual(E.compute(s, at('06:59')).lock, null);
  assert.strictEqual(E.compute(s, at('07:00')).lock.id, 'teeth');
  E.merge(s, E.opComplete('teeth', 'full', 'B', at('07:05')));
  assert.strictEqual(E.compute(s, at('07:06')).lock, null);
  assert.strictEqual(E.compute(s, at('20:59')).lock, null);
  assert.strictEqual(E.compute(s, at('21:00')).lock.id, 'read');
  assert.strictEqual(E.compute(s, at('23:31')).lock, null, 'lock ends at 23:30');
});

t('old levels read as push + lock', () => {
  assert.strictEqual(E.pushOf({ level: 1 }, 'habit'), 'nudge');
  assert.strictEqual(E.pushOf({ level: 4 }, 'habit'), 'nag');
  assert.strictEqual(E.lockOf({ level: 3 }), true);
  assert.strictEqual(E.lockOf({ level: 2 }), false);
  assert.strictEqual(E.pushOf({ level: 1 }, 'todo'), 'off', 'old someday task');
  const s = E.emptyState();
  Object.assign(s.tasks, E.opTask({ id: 'old', title: 'Old', start: '07:00', due: '08:00', level: 4, remind: 15 }, 'A', at('06:00')).tasks);
  assert.strictEqual(E.compute(s, at('07:30')).lock, null, 'no more lock from start');
  assert.strictEqual(E.compute(s, at('08:00')).lock.id, 'old');
  assert.deepStrictEqual(E.reminderTimes(s.tasks.old, E.compute(s, at('06:00')).items[0]).slice(0, 3).map(E.hhmm), ['07:00', '07:10', '07:20']);
});

t('lock needs a deadline; push off means no reminders', () => {
  const s = E.emptyState();
  Object.assign(s.tasks, E.opTask({ id: 'h', title: 'H', push: 'off', lock: true }, 'A', at('06:00')).tasks);
  assert.strictEqual(E.compute(s, at('23:50')).lock, null);
  assert.deepStrictEqual(E.dueReminders(s, at('00:00'), at('23:59')), []);
  assert.strictEqual(E.compute(s, at('23:50')).items[0].status, 'open', 'no deadline: never late');
});

t('pause frees everything and is last-writer-wins', () => {
  const s = base();
  E.merge(s, E.opPause(true, 'B', at('07:01')));
  assert.strictEqual(E.compute(s, at('07:02')).lock, null);
  assert.deepStrictEqual(E.dueReminders(s, at('06:00'), at('21:30')), []);
  E.merge(s, E.opPause(false, 'C', at('07:00'))); // older: ignored
  assert.strictEqual(s.pause.on, true);
  E.merge(s, E.opPause(false, 'C', at('07:03')));
  assert.strictEqual(E.compute(s, at('07:04')).lock.id, 'teeth');
});

t('snooze lifts a lock for 10 min, max 2 per day', () => {
  const s = base();
  const p1 = E.opSnooze(s, 'teeth', 'A', at('07:00')); E.merge(s, p1);
  assert.strictEqual(E.compute(s, at('07:05')).lock, null);
  assert.strictEqual(E.compute(s, at('07:10')).lock.id, 'teeth');
  E.merge(s, E.opSnooze(s, 'teeth', 'A', at('07:10')));
  assert.strictEqual(E.opSnooze(s, 'teeth', 'A', at('07:20')), null);
});

t('reminder times: window, last hour, deadline, late', () => {
  const s = base();
  const it = E.compute(s, at('12:00')).items.find(i => i.id === 'read');
  const times = E.reminderTimes(it.task, it).map(E.hhmm);
  assert.deepStrictEqual(times.slice(0, 8), ['20:00', '20:10', '20:20', '20:30', '20:40', '20:50', '21:00', '21:20']);
  const st = E.compute(s, at('12:00')).items.find(i => i.id === 'study');
  assert.deepStrictEqual(E.reminderTimes(st.task, st).map(E.hhmm).slice(0, 6), ['14:00', '15:00', '16:00', '17:00', '17:10', '17:20']);
});

t('due reminders: one per task, popup for nag', () => {
  const s = base();
  E.merge(s, E.opComplete('teeth', 'full', 'A', at('07:10')));
  const r = E.dueReminders(s, at('13:59'), at('14:00'));
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].id, 'study');
  assert.strictEqual(r[0].popup, true);
  assert.strictEqual(E.dueReminders(s, at('14:00'), at('14:30')).length, 0);
});

t('next event', () => {
  const s = base();
  E.merge(s, E.opComplete('teeth', 'full', 'A', at('07:10')));
  assert.strictEqual(E.compute(s, at('12:00')).next, at('14:00'));
  E.merge(s, E.opComplete('study', 'full', 'A', at('12:00')));
  assert.strictEqual(E.compute(s, at('12:01')).next, at('20:00'));
});

t('merge is order independent', () => {
  const a = base(), b = base();
  const p = [E.opComplete('read', 'tiny', 'A', at('20:10')), E.opUndo('read', 'B', at('20:11')), E.opPause(true, 'C', at('20:12')), E.opComplete('read', 'full', 'D', at('20:13'))];
  p.forEach(x => E.merge(a, x));
  p.slice().reverse().forEach(x => E.merge(b, x));
  assert.deepStrictEqual(a, b);
  assert.strictEqual(E.merge(a, p[3]), false, 'idempotent');
});

t('chunks stay small and merge back', () => {
  const s = base();
  for (let i = 0; i < 300; i++) s.comps['read@2026-10-' + String(1 + (i % 28)).padStart(2, '0') + 'x' + i] = { kind: 'full', ts: i, by: 'A' };
  const cs = E.chunks(s);
  cs.forEach(c => assert.ok(JSON.stringify(c).length < 2900, 'chunk too big: ' + JSON.stringify(c).length));
  const back = E.emptyState(); cs.forEach(c => E.merge(back, c));
  assert.deepStrictEqual(back.comps, s.comps);
  assert.deepStrictEqual(back.tasks, s.tasks);
});

t('stats', () => {
  const s = base();
  E.merge(s, E.opComplete('teeth', 'full', 'A', at('07:10')));
  const st = E.stats(s, at('22:00'));
  const teeth = st.tasks.find(x => x.id === 'teeth');
  assert.strictEqual(teeth.cells[teeth.cells.length - 1].s, 'full');
  const read = st.tasks.find(x => x.id === 'read');
  assert.strictEqual(read.cells[read.cells.length - 1].s, 'miss');
  assert.ok(st.week > 0 && st.week < 1);
});

t('late tasks keep nagging every 20 min', () => {
  const r = E.dueReminders(base(), at('07:19'), at('07:20'));
  assert.deepStrictEqual(r.map(x => x.id + ':' + x.popup), ['teeth:true']);
});


t('inactive habits are skipped', () => {
  const s = base(); s.tasks.read.active = false;
  assert.ok(!E.compute(s, at('12:00')).items.some(i => i.id === 'read'));
});

const addTodo = (s, o) => Object.assign(s.todos, E.opPut('todos', o, 'A', at('06:00')).todos);

t('task with a deadline: on its day, then late until done; reminders every day before it', () => {
  const s = base();
  addTodo(s, { id: 'buy', title: 'Buy X', date: '2026-11-10', due: '12:00', push: 'off', lock: true });
  assert.ok(!E.compute(s, at('12:00')).items.some(i => i.id === 'buy'), 'no reminders: not before its day');
  const tue = E.fromKey('2026-11-10'), wed = E.fromKey('2026-11-11');
  const it = E.compute(s, E.at(tue, '11:00')).items.find(i => i.id === 'buy');
  assert.strictEqual(it.status, 'open'); assert.strictEqual(it.dueToday, true);
  assert.strictEqual(E.compute(s, E.at(tue, '12:00')).items.find(i => i.id === 'buy').locked, true);
  const late = E.compute(s, E.at(wed, '08:00')).items.find(i => i.id === 'buy');
  assert.strictEqual(late.status, 'late'); assert.strictEqual(late.locked, false, 'locks only on the deadline day');
  E.merge(s, E.opComplete('buy', 'full', 'A', E.at(wed, '08:30'), s));
  assert.ok(E.compute(s, E.at(wed, '09:00')).items.find(i => i.id === 'buy').done, 'shows as done the day it was done');
  assert.ok(!E.compute(s, E.at(E.fromKey('2026-11-12'), '08:00')).items.some(i => i.id === 'buy'), 'gone once done');
  addTodo(s, { id: 'pay', title: 'Pay', date: '2026-11-11', due: '', push: 'nudge', rfrom: '09:00', rto: '17:00', remind: 120 });
  const mon = E.compute(s, at('12:00')).items.find(i => i.id === 'pay');
  assert.strictEqual(mon.future, true);
  assert.deepStrictEqual(E.reminderTimes(mon.task, mon).map(E.hhmm), ['09:00', '11:00', '13:00', '15:00']);
  assert.strictEqual(mon.due, E.at(wed, '23:59'), 'blank time = end of the day');
});

t('task with no deadline shows only with reminders on', () => {
  const s = base(); addTodo(s, { id: 'fix', title: 'Fix Y' });
  assert.ok(!E.compute(s, at('12:00')).items.some(i => i.id === 'fix'));
  addTodo(s, { id: 'fix2', title: 'Fix Z', push: 'nag', rfrom: '10:00', rto: '12:00', remind: 60, lock: true });
  const it = E.compute(s, at('12:00')).items.find(i => i.id === 'fix2');
  assert.strictEqual(it.hasDue, false); assert.strictEqual(it.locked, false);
  assert.deepStrictEqual(E.reminderTimes(it.task, it).map(E.hhmm), ['10:00', '11:00']);
});

t('old weekly task still works until it becomes a habit', () => {
  const s = base();
  addTodo(s, { id: 'chap', title: 'Read a chapter', repeat: 'week', dueDay: 5, start: '18:00', due: '21:00', level: 3 });
  const mon = E.compute(s, at('12:00')).items.find(i => i.id === 'chap');
  assert.strictEqual(mon.key, 'chap@W2026-11-08'); assert.strictEqual(mon.locked, false);
  const sat = E.fromKey('2026-11-14');
  assert.strictEqual(E.compute(s, E.at(sat, '21:05')).items.find(i => i.id === 'chap').locked, true, 'locks at the Saturday deadline');
  E.merge(s, E.opComplete('chap', 'full', 'A', at('13:00'), s));
  assert.ok(E.compute(s, E.at(sat, '21:05')).items.find(i => i.id === 'chap').done, 'Monday completion covers the week');
});

t('weekly habit: weeks run Sunday → Saturday, one completion per week, shown once in the tracker', () => {
  const s = E.emptyState();
  Object.assign(s.tasks, E.opTask({ id: 'wk', title: 'Clean', repeat: 'week', dueDay: 5, dueOn: true, due: '20:00', push: 'nag', rfrom: '10:00', rto: '20:00', remind: 120 }, 'A', at('06:00')).tasks);
  const mon = E.compute(s, at('12:00')).items[0];
  assert.strictEqual(mon.key, 'wk@W2026-11-08'); assert.strictEqual(mon.future, true); assert.strictEqual(mon.deadlineDay, '2026-11-14');
  E.merge(s, E.opComplete('wk', 'full', 'A', E.at(E.fromKey('2026-11-11'), '13:00'), s));
  assert.ok(E.compute(s, E.at(E.fromKey('2026-11-14'), '12:00')).items[0].done);
  const st = E.stats(s, E.at(E.fromKey('2026-11-14'), '22:00'), 7).tasks[0];
  assert.deepStrictEqual(st.cells.map(c => c.s), ['none', 'none', 'none', 'full', 'none', 'none', 'none']);
  assert.ok(!E.compute(s, E.at(E.fromKey('2026-11-15'), '12:00')).items[0].done, 'Sunday starts a new week');
  assert.deepStrictEqual(E.periodOf({ repeat: 'week', dueDay: 6 }, E.fromKey('2026-11-18')), { key: 'W2026-11-15', first: '2026-11-15', deadline: '2026-11-15' }, 'a Sunday deadline is the first day');
  assert.strictEqual(E.periodOf({ repeat: 'week' }, E.fromKey('2026-11-18')).deadline, '2026-11-21', 'no day set: Saturday');
});

t('monthly and every-N-days periods', () => {
  const m = E.periodOf({ repeat: 'month', dueDay: 31 }, E.fromKey('2026-11-09'));
  assert.deepStrictEqual(m, { key: '2026-11', first: '2026-11-01', deadline: '2026-11-30' });
  const d = E.periodOf({ repeat: 'days', every: 3, date: '2026-11-01' }, E.fromKey('2026-11-09'));
  assert.deepStrictEqual(d, { key: 'D2026-11-07', first: '2026-11-07', deadline: '2026-11-09' });
  assert.deepStrictEqual(E.habitPeriod({ repeat: 'every', every: 3, date: '2026-11-01' }, E.fromKey('2026-11-09')), d);
});

t('custom weekday repeat', () => {
  assert.deepStrictEqual(E.periodOf({ repeat: 'custom', days: [1, 3] }, E.fromKey('2026-11-09')), { key: 'C2026-11-09', first: '2026-11-09', deadline: '2026-11-09' });
  assert.strictEqual(E.periodOf({ repeat: 'custom', days: [1, 3] }, E.fromKey('2026-11-10')), null);
});

t('designated periods: linked blocks, Google copies, project sessions', () => {
  const s = base();
  addTodo(s, { id: 'hit', title: 'Fix hitbox', project: 'game' });
  Object.assign(s.events, E.opPut('events', { id: 'ev1', title: 'Math', start: at('15:00'), end: at('16:00'), rrule: 'RRULE:FREQ=DAILY;COUNT=3', link: { k: 'todo', id: 'buy' } }, 'A', at('06:00')).events);
  Object.assign(s.events, E.opPut('events', { id: 'ev2', title: 'Game dev', start: at('18:00'), end: at('19:00'), link: { k: 'project', id: 'game' } }, 'A', at('06:00')).events);
  let b = E.blocksFor(s, 'todo', 'buy', at('00:00'), at('00:00') + 10 * E.DAY);
  assert.deepStrictEqual(b.map(x => x.key), ['ev1@2026-11-09', 'ev1@2026-11-10', 'ev1@2026-11-11']);
  assert.strictEqual(E.blocksFor(s, 'todo', 'hit', 0, Infinity).length, 0);
  s.sess['ev2@2026-11-09'] = { tasks: ['hit'], ts: 1, by: 'A' };
  assert.deepStrictEqual(E.blocksFor(s, 'todo', 'hit', 0, Infinity).map(x => x.via), ['project']);
  // once on Google: the Scaffold record hides, Google's copies carry no link but find it by gid / series
  s.events.ev2 = Object.assign({}, s.events.ev2, { gid: 'G2', synced: at('06:01'), ts: at('06:00') });
  s.gev = { ev2: { id: 'ev2', v: 2, gid: 'G2', title: 'Game dev', start: at('18:00'), end: at('19:00'), gupd: at('06:02') } };
  assert.strictEqual(E.blocksFor(s, 'project', 'game', 0, Infinity)[0].e.gupd, at('06:02'));
  assert.strictEqual(E.isPulledCopy(s.events.ev2, at('12:00')), false, 'linked records are kept');
});

t('restriction modes: newest wins, the replaced one comes back, a deadline lock wins, pause ends all', () => {
  const s = E.emptyState();
  Object.assign(s.modes, E.opPut('modes', { id: 'draw', name: 'Drawing', list: 'black', dev: { pc: { apps: ['steam.exe'], sites: ['youtube.com'] } } }, 'A', at('06:00')).modes);
  Object.assign(s.modes, E.opPut('modes', { id: 'study', name: 'Study', list: 'white', dev: { pc: { apps: ['code.exe'], sites: ['wikipedia.org'] } } }, 'A', at('06:00')).modes);
  Object.assign(s.events, E.opPut('events', { id: 'eA', title: 'Draw', start: at('09:00'), end: at('11:00'), mode: 'draw' }, 'A', at('06:00')).events);
  Object.assign(s.events, E.opPut('events', { id: 'eB', title: 'Study', start: at('10:00'), end: at('10:30'), mode: 'study' }, 'A', at('06:00')).events);
  assert.strictEqual(E.activeMode(s, at('08:59')), null);
  assert.strictEqual(E.activeMode(s, at('09:30')).mode.id, 'draw');
  assert.strictEqual(E.activeMode(s, at('10:10')).mode.id, 'study');
  assert.strictEqual(E.activeMode(s, at('10:31')).mode.id, 'draw', 'comes back');
  s.cfg.modeOn = { id: 'modeOn', mode: 'study', at: at('10:40'), until: 0, ts: at('10:40'), by: 'A' };
  assert.strictEqual(E.activeMode(s, at('10:45')).src, 'manual', 'a newer hand-picked mode replaces it');
  s.cfg.modeOn = { id: 'modeOn', mode: 'study', at: at('08:00'), until: at('12:00'), ts: at('08:00'), by: 'A' };
  assert.strictEqual(E.activeMode(s, at('09:30')).mode.id, 'draw', 'a later event replaces the hand-picked one');
  assert.strictEqual(E.activeMode(s, at('11:30')).src, 'manual', 'and it comes back after');
  Object.assign(s.tasks, E.opTask({ id: 'h', title: 'H', dueOn: true, due: '09:45', lock: true, push: 'off' }, 'A', at('06:00')).tasks);
  const lk = E.activeMode(s, at('09:50'));
  assert.strictEqual(lk.src, 'lock'); assert.strictEqual(lk.mode.id, 'full');
  E.merge(s, E.opPause(true, 'A', at('09:55')));
  assert.strictEqual(E.activeMode(s, at('09:56')), null);
});

t('restriction modes: apps and websites', () => {
  const s = E.emptyState();
  const draw = { mode: { list: 'black', dev: { pc: { apps: ['steam.exe'], sites: ['youtube.com'] } } } };
  const full = { mode: E.FULL_LOCK };
  const preset = { apps: ['opera.exe', 'whatsapp.exe'], sites: ['web.whatsapp.com'] };
  assert.strictEqual(E.appBlocked(s, draw, 'pc', 'steam.exe', preset), true);
  assert.strictEqual(E.appBlocked(s, draw, 'pc', 'code.exe', preset), false);
  assert.strictEqual(E.appBlocked(s, full, 'pc', 'code.exe', preset), true);
  assert.strictEqual(E.appBlocked(s, full, 'pc', 'opera.exe', preset), false, 'unblockable');
  assert.strictEqual(E.siteBlocked(s, draw, 'pc', 'https://www.youtube.com/watch?v=1', preset), true);
  assert.strictEqual(E.siteBlocked(s, draw, 'pc', 'm.youtube.com/x', preset), true, 'subdomains, no scheme');
  assert.strictEqual(E.siteBlocked(s, full, 'pc', 'https://www.google.com/search?q=x', preset), false, 'search works');
  assert.strictEqual(E.siteBlocked(s, full, 'pc', 'opera://startpage', preset), false, 'new tab works');
  assert.strictEqual(E.siteBlocked(s, full, 'pc', '', preset), false);
  assert.strictEqual(E.siteBlocked(s, full, 'pc', 'https://web.whatsapp.com/', preset), false);
  assert.strictEqual(E.siteBlocked(s, full, 'pc', 'https://maps.google.com/', preset), true);
  s.cfg.unblock = { id: 'unblock', dev: { pc: { apps: ['code.exe'], sites: [] } }, ts: 1, by: 'A' };
  assert.strictEqual(E.appBlocked(s, full, 'pc', 'code.exe', preset), false, 'the set list replaces the preset');
  assert.strictEqual(E.appBlocked(s, full, 'pc', 'opera.exe', preset), true);
});

t('event modes follow Google copies', () => {
  const s = E.emptyState();
  Object.assign(s.modes, E.opPut('modes', { id: 'draw', name: 'Drawing', list: 'black' }, 'A', at('06:00')).modes);
  s.events.ev = { id: 'ev', title: 'Draw', start: at('09:00'), end: at('10:00'), rrule: 'RRULE:FREQ=DAILY;COUNT=3', mode: 'draw', gid: 'M1', synced: at('06:01'), ts: at('06:00'), by: 'A' };
  s.gev = { g1: { id: 'g1', v: 2, gid: 'M1_x', series: 'M1', title: 'Draw', start: at('09:00') + E.DAY, end: at('10:00') + E.DAY, gupd: at('06:02') } };
  assert.strictEqual(E.activeMode(s, at('09:30') + E.DAY).mode.id, 'draw');
  assert.strictEqual(E.activeMode(s, at('09:30')), null, 'the synced record itself no longer counts');
  assert.strictEqual(E.isPulledCopy(s.events.ev, at('12:00')), false);
});

t('project progress', () => {
  const s = base();
  addTodo(s, { id: 'a', title: 'A', project: 'p1', date: '2026-11-09' });
  addTodo(s, { id: 'b', title: 'B', project: 'p1' });
  E.merge(s, E.opComplete('a', 'full', 'A', at('10:00'), s));
  assert.deepStrictEqual(E.projectProgress(s, 'p1', at('11:00')), { total: 2, done: 1 });
});

t('notes pop every N minutes inside active hours until dismissed', () => {
  const s = base();
  Object.assign(s.notes, E.opPut('notes', { id: 'n1', text: 'Call mom', every: 30, hold: 5, from: '08:00', to: '23:00' }, 'A', at('10:00')).notes);
  assert.strictEqual(E.pendingNotes(s, at('10:20')).length, 1, 'pops right away at creation');
  E.merge(s, E.opAck('n1', 'B', at('10:21')));
  assert.strictEqual(E.pendingNotes(s, at('10:29')).length, 0);
  assert.strictEqual(E.pendingNotes(s, at('10:30')).length, 1, 'pops again 30 min later');
  assert.strictEqual(E.notePops(s.notes.n1, at('22:45')).next, at('08:00') + E.DAY, 'skips the night');
  assert.strictEqual(E.pendingNotes(s, at('23:10')).length, 1, 'last in-hours pop (22:30) still pending if not dismissed');
  E.merge(s, E.opAck('n1', 'B', at('23:11')));
  assert.strictEqual(E.pendingNotes(s, at('23:40')).length, 0, 'no pops at night');
  E.merge(s, E.opPause(true, 'C', at('10:31')));
  assert.strictEqual(E.pendingNotes(s, at('10:40')).length, 0, 'emergency stop silences notes');
});

t('notes only pop on their active days; a night window belongs to the day it starts', () => {
  const s = base();   // 2026-11-09 is a Monday
  Object.assign(s.notes, E.opPut('notes', { id: 'n2', text: 'x', every: 60, from: '22:00', to: '02:00', days: [1] }, 'A', at('10:00')).notes);
  assert.strictEqual(E.pendingNotes(s, at('12:00')).length, 0, 'not inside the window yet');
  assert.strictEqual(E.notePops(s.notes.n2, at('12:00')).next, at('22:00'), 'Monday night');
  assert.strictEqual(E.notePops(s.notes.n2, at('23:30')).next, at('00:00') + E.DAY, 'runs into Tuesday 00:00');
  assert.strictEqual(E.notePops(s.notes.n2, at('01:30') + E.DAY).next, at('22:00') + 7 * E.DAY, 'then waits for next Monday');
  assert.strictEqual(E.plainNote('# T\n- [ ] a **b** ++c++'), 'T\n☐ a b c');
  assert.strictEqual(E.plainNote('- a\n\t- [x] b\n\t\t1. c'), '• a\n  ☑ b\n    1. c');
});

t('calendar agenda', () => {
  const s = base();
  Object.assign(s.events, E.opPut('events', { id: 'e1', title: 'Dentist', start: at('15:00'), end: at('16:00') }, 'A', at('06:00')).events);
  addTodo(s, { id: 'buy', title: 'Buy X', date: '2026-11-09', start: '10:00', due: '12:00' });
  const a = E.dayAgenda(s, at('12:00'));
  assert.deepStrictEqual(a.map(x => x.kind + ':' + x.id), ['todo:buy', 'event:e1'], 'habits and tasks show through their events; task deadlines show');
});

t('vault catalog parts join back', () => {
  const s = base();
  s.vault = { 'v1': { name: 'Game', path: 'a/Game.md', items: ['x', 'y'], part: 0, ts: 1, by: 'A' }, 'v1#1': { items: ['z'], part: 1, ts: 1, by: 'A' } };
  assert.deepStrictEqual(E.vaultProjects(s)[0].items, ['x', 'y', 'z']);
});

t('event reminders: every occurrence, Google copies through the record, one per occurrence, a Nag makes it a pop-up', () => {
  const s = base();
  Object.assign(s.events, E.opPut('events', { id: 'd', title: 'Daily', start: at('09:00'), end: at('09:30'), rrule: 'RRULE:FREQ=DAILY;COUNT=3', rem: [{ m: 0, push: 'nudge' }, { m: 15, push: 'nag' }] }, 'A', at('06:00')).events);
  const hits = (from, to) => E.eventReminders(s, at(from), at(to)).map(x => x.key + ':' + x.popup + ':' + x.m);
  assert.deepStrictEqual(hits('08:44', '08:45'), ['d@' + at('09:00') + ':true:15'], '15 min before: Nag pop-up');
  assert.deepStrictEqual(hits('08:59', '09:00'), ['d@' + at('09:00') + ':false:0'], 'at the start: Nudge');
  assert.deepStrictEqual(hits('08:40', '09:00'), ['d@' + at('09:00') + ':true:0'], 'both in one check: one reminder, a pop-up');
  assert.deepStrictEqual(E.eventReminders(s, at('08:44') + E.DAY, at('08:45') + E.DAY).length, 1, 'the next day too');
  assert.strictEqual(E.nextEventReminder(s, at('08:00')), at('08:45'));
  assert.deepStrictEqual(hits('07:00', '09:00'), ['d@' + at('09:00') + ':true:0'], 'older than 30 min: skipped');
  // On Google now: its copies carry no rem, they find it through the record (gid / series).
  s.events.d.synced = at('06:01'); s.events.d.gid = 'GS';
  s.gev = { x1: { id: 'x1', gid: 'GS_1', series: 'GS', title: 'Daily', start: at('09:00'), end: at('09:30') }, _meta: { at: at('06:02') } };
  assert.strictEqual(hits('08:44', '08:45').length, 1, 'Google copy reminds');
  Object.assign(s.events, E.opPut('events', { id: 'd2', gid: 'GS', series: 'GS', scope: 'all', title: 'Daily', start: at('09:00'), end: at('09:30'), rem: [] }, 'A', at('07:00')).events);
  s.events.d2.synced = at('07:01'); s.gev._meta.at = at('07:02');
  assert.strictEqual(hits('08:44', '08:45').length, 0, 'reminders removed for the whole series');
  E.merge(s, E.opPause(true, 'A', at('07:30')));
  assert.strictEqual(E.nextEventReminder(s, at('08:00')), 0, 'nothing while stopped');
  assert.strictEqual(E.remWhen({ m: 90, start: at('10:00'), end: at('11:00') }), 'Starts in 90 min · 10:00–11:00');
  assert.strictEqual(E.remWhen({ m: 60, start: at('10:00'), end: at('11:00') }), 'Starts in 1 hour · 10:00–11:00');
});

t('task reminders every N days: only on every Nth day from the day it was saved', () => {
  const s = base();
  Object.assign(s.tasks, E.opTask({ id: 'n2', title: 'Water', push: 'nudge', rfrom: '10:00', rto: '12:00', remind: 2880 }, 'A', at('06:00')).tasks);
  const rems = (d) => E.dueReminders(s, at('09:59') + d * E.DAY, at('10:00') + d * E.DAY).filter(x => x.id === 'n2').length;
  assert.deepStrictEqual([0, 1, 2, 3, 4].map(rems), [1, 0, 1, 0, 1]);
});

t('habit history: every instance since it started, and fixing one by hand', () => {
  const s = E.emptyState();
  Object.assign(s.tasks, E.opTask({ id: 'h', title: 'Read', from: '2026-11-05', days: [1, 3, 5], dueOn: true, due: '21:00', push: 'nudge' }, 'A', at('06:00')).tasks);
  E.merge(s, E.opComplete('h', 'full', 'A', E.at(E.fromKey('2026-11-06'), '10:00'), s));
  const h = (now) => E.habitHistory(s, 'h', now).map(x => x.key + ':' + x.s);
  assert.deepStrictEqual(h(at('12:00')), ['2026-11-09:pending', '2026-11-06:full'], 'Mon/Wed/Fri since Thu 5th, newest first');
  assert.deepStrictEqual(h(at('22:00')), ['2026-11-09:miss', '2026-11-06:full']);
  E.merge(s, E.opSetDone('h', '2026-11-09', true, 'A', at('22:05'), s));
  E.merge(s, E.opSetDone('h', '2026-11-06', false, 'A', at('22:06'), s));
  assert.deepStrictEqual(h(at('22:10')), ['2026-11-09:full', '2026-11-06:miss'], 'flipped both ways');
  s.tasks.h.active = false;
  assert.strictEqual(h(at('22:10')).length, 2, 'a paused habit keeps its history');
  // A weekly instance marked done later shows on its deadline day, not on the day it was fixed.
  Object.assign(s.tasks, E.opTask({ id: 'w', title: 'Clean', repeat: 'week', dueDay: 5, from: '2026-11-01', dueOn: true, due: '20:00' }, 'A', at('06:00')).tasks);
  E.merge(s, E.opSetDone('w', 'W2026-11-01', true, 'A', at('12:00'), s));
  const w = E.habitHistory(s, 'w', at('12:00'));
  assert.deepStrictEqual(w.map(x => x.key + ':' + x.s + ':' + x.day), ['W2026-11-08:pending:2026-11-09', 'W2026-11-01:full:2026-11-07']);
  const st = E.stats(s, at('12:00'), 10).tasks.find(x => x.id === 'w');
  assert.strictEqual(st.cells.find(c => c.day === '2026-11-07').s, 'full');
});

// Fixture for the Java mirror: same state, a list of instants, expected lock / next / reminders.
const fx = base();
E.merge(fx, E.opSnooze(fx, 'teeth', 'A', at('07:00')));
addTodo(fx, { id: 'chap', title: 'Chapter', repeat: 'week', dueDay: 0, start: '18:00', due: '21:00', level: 3 });
addTodo(fx, { id: 'buy', title: 'Buy', date: '2026-11-08', due: '12:00', push: 'nudge', rfrom: '09:00', rto: '18:00', remind: 90 });
addTodo(fx, { id: 'pay', title: 'Pay', date: '2026-11-09', due: '', push: 'off', lock: true });
addTodo(fx, { id: 'fut', title: 'Later', date: '2026-11-12', due: '10:00', push: 'nag', rfrom: '13:00', rto: '17:30', remind: 45, lock: true });
addTodo(fx, { id: 'some', title: 'Someday', push: 'nudge', rfrom: '10:00', rto: '11:00', remind: 30 });
addTodo(fx, { id: 'old', title: 'Old someday', level: 2 });
addTodo(fx, { id: 'cus', title: 'Gym', repeat: 'custom', days: [1, 4], due: '23:59', start: '18:00', level: 4 });
Object.assign(fx.tasks, E.opTask({ id: 'wk', title: 'Clean', repeat: 'week', dueDay: 0, dueOn: true, due: '17:00', push: 'nag', rfrom: '16:00', rto: '22:00', remind: 20 }, 'A', at('06:00')).tasks);
Object.assign(fx.tasks, E.opTask({ id: 'free', title: 'Free', push: 'nudge', rfrom: '21:00', rto: '20:00', remind: 60, lock: true }, 'A', at('06:00')).tasks);
Object.assign(fx.tasks, E.opTask({ id: 'mo', title: 'Bills', repeat: 'month', dueDay: 9, dueOn: false, push: 'nag', rfrom: '10:00', rto: '10:30', remind: 15 }, 'A', at('06:00')).tasks);
Object.assign(fx.modes, E.opPut('modes', { id: 'draw', name: 'Drawing', list: 'black', dev: { ph: { apps: ['com.game'] } } }, 'A', at('06:00')).modes);
Object.assign(fx.events, E.opPut('events', { id: 'em1', title: 'Draw', start: at('09:00'), end: at('11:00'), rrule: 'RRULE:FREQ=DAILY;COUNT=2', mode: 'draw', rem: [{ m: 60, push: 'nudge' }] }, 'A', at('06:00')).events);
Object.assign(fx.events, E.opPut('events', { id: 'em2', title: 'Short', start: at('10:00'), end: at('10:45'), mode: 'full', rem: [{ m: 0, push: 'nudge' }, { m: 15, push: 'nag' }, { m: 30, push: 'nudge' }] }, 'A', at('06:00')).events);
fx.events.em3 = { id: 'em3', title: 'G', start: at('13:00'), end: at('14:30'), mode: 'draw', gid: 'G3', synced: at('06:01'), ts: at('06:00'), by: 'A', rem: [{ m: 30, push: 'nudge' }] };
fx.events.r4 = { id: 'r4', title: 'From Google', start: at('15:00'), end: at('16:00'), gid: 'G4', synced: at('06:01'), ts: at('06:00'), by: 'A', rem: [{ m: 60, push: 'nag' }, { m: 1440, push: 'nudge' }] };
fx.gev = { em3: { id: 'em3', v: 2, gid: 'G3', title: 'G', start: at('13:30'), end: at('14:30'), gupd: at('06:02') }, g4: { id: 'g4', v: 2, gid: 'G4', title: 'From Google', start: at('15:00') + E.DAY, end: at('16:00') + E.DAY, gupd: at('06:02') }, _meta: { v: 2 } };
fx.cfg.modeOn = { id: 'modeOn', mode: 'draw', at: at('16:00'), until: at('17:20'), ts: at('16:00'), by: 'A' };
Object.assign(fx.notes, E.opPut('notes', { id: 'n1', text: 'x', every: 45, from: '08:00', to: '22:00' }, 'A', at('07:10')).notes);
Object.assign(fx.notes, E.opPut('notes', { id: 'n2', text: '- [ ] y', every: 90, from: '20:00', to: '01:00', days: [1, 3] }, 'A', at('07:10')).notes);
Object.assign(fx.notes, E.opPut('notes', { id: 'n3', text: 'z', every: 30, from: '09:00', to: '09:00', days: [2] }, 'A', at('07:10')).notes);
fx.tasks.gym.active = false;
E.merge(fx, E.opAck('n1', 'B', at('13:00')));
const instants = ['06:59', '07:00', '07:05', '07:10', '08:00', '09:00', '09:30', '09:45', '10:00', '10:30', '10:50', '12:00', '13:10', '13:40', '13:59', '14:00', '15:00', '16:00', '17:00', '17:05', '17:30', '20:59', '21:00', '21:10', '23:31', '23:59'];
// Modes without the habit lock in the way: same events, no tasks.
const fxm = JSON.parse(JSON.stringify(fx)); fxm.tasks = {}; fxm.todos = {};
const mstr = (m) => m ? m.mode.id + ':' + m.src + ':' + m.start + ':' + m.until : 'none';
const out = instants.map(h => {
  const now = at(h), r = E.compute(fx, now);
  return { now, lock: r.lock ? r.lock.id : null, next: r.next, done: r.done, total: r.total, rem: E.dueReminders(fx, now - 60000, now).map(x => x.id + ':' + x.popup), notes: r.notes.map(n => n.id + ':' + n.since), keys: r.items.map(i => i.key + ':' + i.status), erem: E.eventReminders(fx, now - 60000, now).map(x => x.key + ':' + x.popup + ':' + x.m), enext: E.nextEventReminder(fx, now), mode: mstr(E.activeMode(fx, now, r)), mode2: mstr(E.activeMode(fxm, now)), pops: Object.keys(fx.notes).sort().map(id => { const p = E.notePops(fx.notes[id], now); return id + ':' + p.last + ':' + p.next; }) };
});
fs.writeFileSync(path.join(__dirname, 'fixture-out.json'), JSON.stringify({ state: fx, modeState: fxm, cases: out }, null, 1));

t('a change pushed to Google: its own copies show only once this device read Google after the push', () => {
  const day = (d, h) => new Date(2026, 10, d, h).getTime(), st = E.emptyState(), T = day(16, 10);
  // Stale copy of Google (read at T): a daily series S, Nov 22-24 at 08:00.
  st.gev = { _meta: { v: 2, at: T } };
  [22, 23, 24].forEach((d) => { st.gev['g' + d] = { id: 'g' + d, v: 2, gid: 'S_' + d, title: 'Org', start: day(d, 8), end: day(d, 8) + 1800000, series: 'S', ostart: day(d, 8), rrule: 'RRULE:FREQ=DAILY', gupd: T - 5000 }; });
  // "Delete this and following" from Nov 23, already on Google (pushed after the copy was read).
  st.events.g23 = Object.assign({}, st.gev.g23, { del: true, scope: 'following', ts: T + 1000, synced: T + 1000, pushed: T + 2000, by: 'A' });
  // A new daily series made in Scaffold, also pushed after that read.
  st.events.n = { id: 'n', title: 'New', start: day(22, 9), end: day(22, 10), rrule: 'RRULE:FREQ=DAILY;COUNT=3', gid: 'NEW', ts: T + 1000, synced: T + 1000, pushed: T + 2000, by: 'A' };
  let ev = E.eventsFor(st);
  assert.deepStrictEqual(['g22', 'g23', 'g24'].filter((k) => ev[k]), ['g22'], 'stale copies of deleted occurrences stay hidden');
  assert.strictEqual(Object.values(ev).filter((e) => e.title === 'New').length, 3, "the new series shows from Scaffold's own record");
  st.gev._meta.at = T + 9000; delete st.gev.g23; delete st.gev.g24;   // read again: Google's own copies take over
  ev = E.eventsFor(st);
  assert.ok(ev.g22 && !ev.g23 && !ev.g24 && !Object.values(ev).some((e) => e.title === 'New'), 'fresh copy: Google decides');
});

console.log(pass + ' tests passed' + (process.exitCode ? ', some FAILED' : ''));
