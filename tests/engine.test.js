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
  Object.assign(s.tasks, E.opTask({ id: 'read', title: 'Read', emoji: '📖', start: '20:00', due: '21:00', level: 3, kind: 'timer', minutes: 20, remind: 30 }, 'A', at('08:00')).tasks);
  Object.assign(s.tasks, E.opTask({ id: 'teeth', title: 'Brush teeth', emoji: '🪥', start: '07:00', due: '08:00', level: 4, kind: 'check', remind: 15 }, 'A', at('06:00')).tasks);
  Object.assign(s.tasks, E.opTask({ id: 'study', title: 'Study', emoji: '📚', start: '14:00', due: '18:00', level: 2, days: [1, 3, 5], remind: 60 }, 'A', at('06:00')).tasks);
  Object.assign(s.tasks, E.opTask({ id: 'gym', title: 'Gym', emoji: '🏋️', start: '10:00', due: '11:00', level: 1, days: [2, 4] }, 'A', at('06:00')).tasks);
  return s;
};

t('scheduling by weekday', () => {
  const r = E.compute(base(), at('12:00'));
  assert.deepStrictEqual(r.items.map(i => i.id), ['teeth', 'study', 'read']);
});

t('level 4 locks from start until done', () => {
  const s = base();
  assert.strictEqual(E.compute(s, at('06:59')).lock, null);
  assert.strictEqual(E.compute(s, at('07:00')).lock.id, 'teeth');
  E.merge(s, E.opComplete('teeth', 'full', 'B', at('07:05')));
  assert.strictEqual(E.compute(s, at('07:06')).lock, null);
});

t('level 3 locks at deadline, not before', () => {
  const s = base();
  E.merge(s, E.opComplete('teeth', 'full', 'B', at('07:05')));
  assert.strictEqual(E.compute(s, at('20:59')).lock, null);
  assert.strictEqual(E.compute(s, at('21:00')).lock.id, 'read');
  assert.strictEqual(E.compute(s, at('23:31')).lock, null, 'lock ends at 23:30');
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

t('reminder times escalate', () => {
  const s = base();
  const it = E.compute(s, at('12:00')).items.find(i => i.id === 'read');
  const times = E.reminderTimes(it.task, it).map(x => new Date(x).toTimeString().slice(0, 5));
  assert.deepStrictEqual(times.slice(0, 8), ['20:00', '20:10', '20:20', '20:30', '20:40', '20:50', '21:00', '21:20']);
  const st = E.compute(s, at('12:00')).items.find(i => i.id === 'study');
  const t2 = E.reminderTimes(st.task, st).map(x => new Date(x).toTimeString().slice(0, 5));
  assert.deepStrictEqual(t2.slice(0, 6), ['14:00', '15:00', '16:00', '17:00', '17:10', '17:20']);
});

t('due reminders: one per task, popup by level', () => {
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
  const r = E.dueReminders(base(), at('08:19'), at('08:20'));
  assert.deepStrictEqual(r.map(x => x.id + ':' + x.popup), ['teeth:true']);
});


t('inactive habits are skipped', () => {
  const s = base(); s.tasks.read.active = false;
  assert.ok(!E.compute(s, at('12:00')).items.some(i => i.id === 'read'));
});

const addTodo = (s, o) => Object.assign(s.todos, E.opPut('todos', o, 'A', at('06:00')).todos);

t('one-time task: shows on its date, then stays late until done', () => {
  const s = base();
  addTodo(s, { id: 'buy', title: 'Buy X', date: '2026-11-10', start: '10:00', due: '12:00', level: 1 });
  assert.ok(!E.compute(s, at('12:00')).items.some(i => i.id === 'buy'), 'not before its date');
  const tue = E.fromKey('2026-11-10'), wed = E.fromKey('2026-11-11');
  const it = E.compute(s, E.at(tue, '11:00')).items.find(i => i.id === 'buy');
  assert.strictEqual(it.status, 'open'); assert.strictEqual(it.nudge, 0);
  const late = E.compute(s, E.at(wed, '08:00')).items.find(i => i.id === 'buy');
  assert.strictEqual(late.status, 'late'); assert.ok(late.nudge > 0);
  E.merge(s, E.opComplete('buy', 'full', 'A', E.at(wed, '08:30'), s));
  assert.ok(!E.compute(s, E.at(E.fromKey('2026-11-12'), '08:00')).items.some(i => i.id === 'buy'), 'gone once done');
});

t('someday task (no date) never shows on Today', () => {
  const s = base(); addTodo(s, { id: 'fix', title: 'Fix Y' });
  assert.ok(!E.compute(s, at('12:00')).items.some(i => i.id === 'fix'));
});

t('weekly task: nudged during the week, real window on the deadline day, one completion per week', () => {
  const s = base();
  addTodo(s, { id: 'chap', title: 'Read a chapter', repeat: 'week', dueDay: 6, start: '18:00', due: '21:00', level: 3 });
  const mon = E.compute(s, at('12:00')).items.find(i => i.id === 'chap');
  assert.strictEqual(mon.key, 'chap@W2026-11-09'); assert.ok(mon.nudge); assert.strictEqual(mon.locked, false);
  assert.deepStrictEqual(E.dueReminders(s, at('08:59'), at('09:00')).map(x => x.id + ':' + x.popup).filter(x => x.startsWith('chap')), ['chap:false']);
  const sun = E.fromKey('2026-11-15');
  assert.strictEqual(E.compute(s, E.at(sun, '21:05')).items.find(i => i.id === 'chap').locked, true, 'locks at the Sunday deadline');
  E.merge(s, E.opComplete('chap', 'full', 'A', at('13:00'), s));
  assert.ok(E.compute(s, E.at(sun, '21:05')).items.find(i => i.id === 'chap').done, 'Monday completion covers the week');
  assert.ok(!E.compute(s, E.at(E.fromKey('2026-11-16'), '12:00')).items.find(i => i.id === 'chap').done, 'new week resets');
});

t('monthly and every-N-days periods', () => {
  const m = E.periodOf({ repeat: 'month', dueDay: 31 }, E.fromKey('2026-11-09'));
  assert.deepStrictEqual(m, { key: '2026-11', first: '2026-11-01', deadline: '2026-11-30' });
  const d = E.periodOf({ repeat: 'days', every: 3, date: '2026-11-01' }, E.fromKey('2026-11-09'));
  assert.deepStrictEqual(d, { key: 'D2026-11-07', first: '2026-11-07', deadline: '2026-11-09' });
});

t('custom weekday repeat', () => {
  assert.deepStrictEqual(E.periodOf({ repeat: 'custom', days: [1, 3] }, E.fromKey('2026-11-09')), { key: 'C2026-11-09', first: '2026-11-09', deadline: '2026-11-09' });
  assert.strictEqual(E.periodOf({ repeat: 'custom', days: [1, 3] }, E.fromKey('2026-11-10')), null);
  assert.strictEqual(E.periodOf({ repeat: 'custom', days: [] }, E.fromKey('2026-11-10')).key, 'C2026-11-10');
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

t('calendar agenda', () => {
  const s = base();
  Object.assign(s.events, E.opPut('events', { id: 'e1', title: 'Dentist', start: at('15:00'), end: at('16:00') }, 'A', at('06:00')).events);
  addTodo(s, { id: 'buy', title: 'Buy X', date: '2026-11-09', start: '10:00', due: '12:00' });
  const a = E.dayAgenda(s, at('12:00'));
  assert.deepStrictEqual(a.map(x => x.kind + ':' + x.id), ['habit:teeth', 'todo:buy', 'habit:study', 'event:e1', 'habit:read']);
});

t('vault catalog parts join back', () => {
  const s = base();
  s.vault = { 'v1': { name: 'Game', path: 'a/Game.md', items: ['x', 'y'], part: 0, ts: 1, by: 'A' }, 'v1#1': { items: ['z'], part: 1, ts: 1, by: 'A' } };
  assert.deepStrictEqual(E.vaultProjects(s)[0].items, ['x', 'y', 'z']);
});

// Fixture for the Java mirror: same state, a list of instants, expected lock / next / reminders.
const fx = base();
E.merge(fx, E.opSnooze(fx, 'teeth', 'A', at('07:00')));
addTodo(fx, { id: 'chap', title: 'Chapter', repeat: 'week', dueDay: 0, start: '18:00', due: '21:00', level: 3 });
addTodo(fx, { id: 'buy', title: 'Buy', date: '2026-11-08', due: '12:00' });
addTodo(fx, { id: 'mon', title: 'Bills', repeat: 'month', dueDay: 9, start: '10:00', due: '11:00', level: 2 });
addTodo(fx, { id: 'cus', title: 'Gym', repeat: 'custom', days: [1, 4], due: '23:59', start: '18:00', level: 4 });
addTodo(fx, { id: 'ev3', title: 'Water plants', repeat: 'days', every: 3, date: '2026-11-03', start: '17:00', due: '17:30', level: 1 });
Object.assign(fx.notes, E.opPut('notes', { id: 'n1', text: 'x', every: 45, from: '08:00', to: '22:00' }, 'A', at('07:10')).notes);
fx.tasks.gym.active = false;
E.merge(fx, E.opAck('n1', 'B', at('13:00')));
const instants = ['06:59', '07:00', '07:05', '07:10', '08:00', '09:00', '10:30', '13:59', '14:00', '17:05', '17:30', '20:59', '21:00', '21:10', '23:31'];
const out = instants.map(h => {
  const now = at(h), r = E.compute(fx, now);
  return { now, lock: r.lock ? r.lock.id : null, next: r.next, done: r.done, total: r.total, rem: E.dueReminders(fx, now - 60000, now).map(x => x.id + ':' + x.popup), notes: r.notes.map(n => n.id + ':' + n.since), keys: r.items.map(i => i.key + ':' + i.status) };
});
fs.writeFileSync(path.join(__dirname, 'fixture-out.json'), JSON.stringify({ state: fx, cases: out }, null, 1));

console.log(pass + ' tests passed' + (process.exitCode ? ', some FAILED' : ''));
