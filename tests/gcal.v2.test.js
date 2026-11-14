// Runs the real bridge script (ui/gcal-script.js, v2) against a fake Google Calendar API, through desktop/calendar.js.
// Run: node tests/gcal.v2.test.js
const http = require('http'), assert = require('assert'), crypto = require('crypto');
const E = require('../shared/engine.js'), Cal = require('../desktop/calendar.js');
global.window = {}; require('../ui/gcal-script.js');
const SECRET = 's3cret', SRC = window.GCAL_SCRIPT.replace('__SECRET__', SECRET);

// ---------- fake Calendar advanced service ----------
let clock = Date.now();
const tick = () => (clock = Math.max(Date.now(), clock + 1));
const CALS = [
  { id: 'me@x', summary: 'Me', backgroundColor: '#9fe1e7', accessRole: 'owner', primary: true },
  { id: 'work@x', summary: 'Work', backgroundColor: '#f83a22', accessRole: 'writer' },
  { id: 'hol@x', summary: 'Holidays', backgroundColor: '#16a765', accessRole: 'reader' },
];
const store = { 'me@x': {}, 'work@x': {}, 'hol@x': {} }, exc = {};   // exc[series][ostartMs] = override | { status: 'cancelled' }
let nid = 1;
const calId = (c) => (c === 'primary' ? 'me@x' : c);
const ms = (t) => (t.dateTime ? Date.parse(t.dateTime) : E.at(E.fromKey(t.date), '00:00'));
const compact = (t) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
function setFields(ev, res) { for (const k of Object.keys(res)) { if (res[k] === null) delete ev[k]; else if (k === 'start' || k === 'end') { ev[k] = Object.assign({}, ev[k] || {}, res[k]); for (const kk of Object.keys(ev[k])) if (ev[k][kk] === null) delete ev[k][kk]; } else ev[k] = JSON.parse(JSON.stringify(res[k])); } }
function instancesOf(m) {
  const s = ms(m.start), len = ms(m.end) - s, rule = (m.recurrence || []).join('\n');
  return E.expandRule({ start: s, allDay: !!m.start.date, rrule: rule }, 500).map((t) => {
    const o = (exc[m.id] || {})[t] || {};
    const inst = Object.assign(JSON.parse(JSON.stringify(m)), { id: m.id + '_' + compact(t), recurringEventId: m.id, originalStartTime: m.start.date ? { date: E.dateKey(t) } : { dateTime: new Date(t).toISOString() } });
    delete inst.recurrence;
    if (m.start.date) { inst.start = { date: E.dateKey(t) }; inst.end = { date: E.dateKey(t + len) }; } else { inst.start = { dateTime: new Date(t).toISOString() }; inst.end = { dateTime: new Date(t + len).toISOString() }; }
    setFields(inst, o); inst.updated = new Date(Math.max(Date.parse(m.updated), o.upd || 0)).toISOString();
    return inst;
  });
}
function findInst(c, id) { const [series] = id.split('_'); const m = store[c][series]; return m && instancesOf(m).find((i) => i.id === id); }
const Calendar = {
  CalendarList: { list: () => ({ items: CALS }) },
  Colors: { get: () => ({ event: { 1: { background: '#a4bdfc' }, 5: { background: '#fbd75b' }, 11: { background: '#dc2127' } } }) },
  Events: {
    list(c, o) {
      c = calId(c);
      let items = Object.values(store[c]);
      if (o.privateExtendedProperty) { const [k, v] = o.privateExtendedProperty.split('='); return { items: items.filter((e) => ((e.extendedProperties || {}).private || {})[k] === v) }; }
      if (o.updatedMin) { const t = Date.parse(o.updatedMin); const hit = items.some((e) => Date.parse(e.updated) >= t) || Object.keys(exc).some((s) => store[c][s] && Object.values(exc[s]).some((x) => (x.upd || 0) >= t)) || (store[c]._deleted || 0) >= t; return { items: hit ? [{ id: 'x' }] : [] }; }
      const a = Date.parse(o.timeMin), b = Date.parse(o.timeMax);
      if (!o.singleEvents) return { items: items.filter((e) => e.id && e.recurrence) };
      const out = [];
      items.forEach((e) => { if (!e.id) return; (e.recurrence ? instancesOf(e) : [e]).forEach((i) => { if (ms(i.end) > a && ms(i.start) < b) out.push(i); }); });
      return { items: out };
    },
    get(c, id) { c = calId(c); const e = store[c][id] || findInst(c, id); if (!e) throw new Error('404 Not Found'); return JSON.parse(JSON.stringify(e)); },
    insert(res, c) { c = calId(c); const id = 'ev' + nid++; const e = { id, status: 'confirmed', updated: new Date(tick()).toISOString() }; setFields(e, res); store[c][id] = e; return e; },
    patch(res, c, id) {
      c = calId(c);
      if (store[c][id]) { setFields(store[c][id], res); store[c][id].updated = new Date(tick()).toISOString(); return store[c][id]; }
      const inst = findInst(c, id); if (!inst) throw new Error('404 Not Found');
      const t = ms(inst.originalStartTime.dateTime ? inst.originalStartTime : { date: inst.originalStartTime.date });
      exc[inst.recurringEventId] = exc[inst.recurringEventId] || {};
      const o = exc[inst.recurringEventId][t] = Object.assign(exc[inst.recurringEventId][t] || {}, JSON.parse(JSON.stringify(res)), { upd: tick() });
      return Object.assign(findInst(c, id), { updated: new Date(o.upd).toISOString() });
    },
    move(c, id, dest) { c = calId(c); store[dest][id] = store[c][id]; delete store[c][id]; store[dest][id].updated = new Date(tick()).toISOString(); return store[dest][id]; },
    remove(c, id) {
      c = calId(c);
      if (store[c][id]) { delete store[c][id]; store[c]._deleted = tick(); return; }
      const inst = findInst(c, id); if (!inst) throw new Error('410 deleted');
      const t = ms(inst.originalStartTime.dateTime ? inst.originalStartTime : { date: inst.originalStartTime.date });
      exc[inst.recurringEventId] = exc[inst.recurringEventId] || {}; exc[inst.recurringEventId][t] = { status: 'cancelled', upd: tick() };
    },
    instances(c, id, o) { c = calId(c); const b = o.timeMax ? Date.parse(o.timeMax) : Infinity; return { items: instancesOf(store[c][id]).filter((i) => ms(i.start) < b && i.status !== 'cancelled') }; },
  },
};
// cancelled instances are reported with status 'cancelled' (the script skips them)
const pad = (n) => String(n).padStart(2, '0');
const Utilities = {
  DigestAlgorithm: { MD5: 'md5' },
  computeDigest: (alg, s) => [...crypto.createHash('md5').update(s).digest()],
  base64Encode: (bytes) => Buffer.from(bytes).toString('base64'),
  formatDate(d, tz, f) {
    const Y = d.getUTCFullYear(), M = pad(d.getUTCMonth() + 1), D = pad(d.getUTCDate()), h = pad(d.getUTCHours()), m = pad(d.getUTCMinutes()), s = pad(d.getUTCSeconds());
    if (f === 'yyyyMMdd') return '' + Y + M + D;
    if (f === 'yyyy-MM-dd') return Y + '-' + M + '-' + D;
    return '' + Y + M + D + 'T' + h + m + s + 'Z';
  },
};
const LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }), getUserLock: () => ({ waitLock() {}, releaseLock() {} }) };
const ContentService = { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ s, setMimeType() { return this; } }) };
const doPost = new Function('Calendar', 'Utilities', 'LockService', 'ContentService', 'CacheService', SRC + '\nreturn doPost;')(Calendar, Utilities, LockService, ContentService, {});

// ---------- HTTP wrapper (same redirect dance as Apps Script) ----------
const results = {}; let rid = 1;
const srv = http.createServer((req, res) => {
  if (req.method === 'GET') { res.setHeader('Content-Type', 'application/json'); return res.end(results[req.url.split('=')[1]]); }
  let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
    let out; try { out = doPost({ postData: { contents: body } }).s; } catch (e) { out = JSON.stringify({ error: String(e && e.stack || e) }); }
    const id = rid++; results[id] = out; res.writeHead(302, { Location: '/r?id=' + id }); res.end();
  });
});

if (process.env.SERVE) {   // manual mode: serve the fake Google with a few events (for testing a device against it)
  const d = E.addDays(Date.now(), 0), at = (k, h) => E.at(E.addDays(d, k), h);
  store['work@x'].w1 = { id: 'w1', summary: 'Standup', description: 'Room 4', colorId: '5', start: { dateTime: new Date(at(0, '09:00')).toISOString() }, end: { dateTime: new Date(at(0, '09:30')).toISOString() }, updated: new Date(tick()).toISOString() };
  store['hol@x'].h1 = { id: 'h1', summary: 'Holiday', start: { date: E.dateKey(at(1, '12:00')) }, end: { date: E.dateKey(at(2, '12:00')) }, updated: new Date(tick()).toISOString() };
  store['me@x'].s1 = { id: 's1', summary: 'Gym', recurrence: ['RRULE:FREQ=DAILY;COUNT=4'], start: { dateTime: new Date(at(0, '18:00')).toISOString() }, end: { dateTime: new Date(at(0, '19:00')).toISOString() }, updated: new Date(tick()).toISOString() };
  srv.listen(+process.env.SERVE, () => console.log('fake Google on', process.env.SERVE));
} else srv.listen(0, async () => {
  const url = 'http://127.0.0.1:' + srv.address().port + '/exec';
  const state = E.emptyState(), local = {};
  const run = async () => { const r = await Cal.syncOnce({ url, secret: SECRET, state, local, Engine: E, by: 'mac', apply: (p) => E.merge(state, p) }); state.gev = r.gev; return r; };
  const evs = () => Object.values(E.eventsFor(state));
  const put = (rec) => E.merge(state, E.opPut('events', rec, 'phone', tick()));
  const day = E.addDays(Date.now(), 2), at = (k, h) => E.at(E.addDays(day, k), h);
  let pass = 0; const ok = () => pass++;
  try {
    // Google side: one event in Work (yellow), one weekly series in Me, one holiday
    store['work@x'].w1 = { id: 'w1', summary: 'Standup', description: 'Room 4', colorId: '5', start: { dateTime: new Date(at(0, '09:00')).toISOString() }, end: { dateTime: new Date(at(0, '09:30')).toISOString() }, updated: new Date(tick()).toISOString() };
    store['hol@x'].h1 = { id: 'h1', summary: 'Holiday', start: { date: E.dateKey(at(1, '12:00')) }, end: { date: E.dateKey(at(2, '12:00')) }, updated: new Date(tick()).toISOString() };
    store['me@x'].s1 = { id: 's1', summary: 'Gym', recurrence: ['RRULE:FREQ=DAILY;COUNT=4'], start: { dateTime: new Date(at(0, '18:00')).toISOString() }, end: { dateTime: new Date(at(0, '19:00')).toISOString() }, updated: new Date(tick()).toISOString() };
    let r = await run();
    assert.strictEqual(r.v, 2);
    const g = state.gev;
    assert.deepStrictEqual(g._cals.list.map((c) => c.name + (c.ro ? '(ro)' : '')), ['Me', 'Work', 'Holidays(ro)']);
    const su = evs().find((e) => e.title === 'Standup');
    assert.ok(su.cal === 'work@x' && su.color === '5' && su.desc === 'Room 4' && !su.ro); ok();
    const hol = evs().find((e) => e.title === 'Holiday');
    assert.ok(hol.allDay && hol.ro && E.hhmm(hol.start) === '00:00'); ok();
    let gym = evs().filter((e) => e.title === 'Gym').sort((a, b) => a.start - b.start);
    assert.strictEqual(gym.length, 4); assert.ok(gym.every((e) => e.series === 's1' && /COUNT=4/.test(e.rrule) && e.ostart === e.start)); ok();

    // nothing changed: cheap answer, same copy
    const before = JSON.stringify(Object.keys(state.gev).sort());
    r = await run(); assert.ok(/synced/.test(r.status)); assert.strictEqual(JSON.stringify(Object.keys(state.gev).sort()), before); ok();

    // Scaffold: new event in Work, red, with a description
    put({ id: 'sc1', title: 'Review', cal: 'work@x', color: '11', desc: 'notes', start: at(1, '14:00'), end: at(1, '15:00') });
    await run();
    const rv = evs().find((e) => e.title === 'Review');
    assert.ok(rv && rv.id === 'sc1' && rv.cal === 'work@x' && rv.color === '11' && rv.desc === 'notes'); ok();

    // Scaffold: weekly series on 2 days, 4 times; shows locally before the push
    const ws = at(0, '07:00'), wd = new Date(ws).getDay();
    put({ id: 'sc2', title: 'Run', start: ws, end: ws + 1800e3, rrule: E.buildRule({ freq: 'weekly', days: [wd, (wd + 2) % 7], count: 4 }, false) });
    assert.strictEqual(evs().filter((e) => e.title === 'Run').length, 4, 'local preview of the series'); ok();
    await run();
    let run4 = evs().filter((e) => e.title === 'Run');
    assert.strictEqual(run4.length, 4); assert.ok(run4.every((e) => e.series && !e.virt), 'Google copies replace the preview'); ok();

    // Edit one occurrence
    gym = evs().filter((e) => e.title === 'Gym').sort((a, b) => a.start - b.start);
    put(Object.assign({}, gym[1], { title: 'Gym (legs)', scope: 'one' }));
    await run();
    assert.deepStrictEqual(evs().filter((e) => /^Gym/.test(e.title)).sort((a, b) => a.start - b.start).map((e) => e.title), ['Gym', 'Gym (legs)', 'Gym', 'Gym']); ok();

    // All events: move the 3rd one hour later -> every occurrence moves (shows right away, then from Google)
    gym = evs().filter((e) => /^Gym/.test(e.title)).sort((a, b) => a.start - b.start);
    put(Object.assign({}, gym[2], { title: 'Gym', start: gym[2].start + 3600e3, end: gym[2].end + 3600e3, scope: 'all', keepRule: true }));
    assert.ok(evs().filter((e) => e.series === 's1').every((e) => E.hhmm(e.start) === '19:00'), 'shown right away'); ok();
    await run();
    gym = evs().filter((e) => e.series === 's1').sort((a, b) => a.start - b.start);
    assert.strictEqual(gym.length, 4); assert.ok(gym.every((e) => E.hhmm(e.start) === '19:00'), 'Google moved them'); ok();

    // This and following from the 3rd: rename -> 2 old + 2 new, still 4 in total
    put(Object.assign({}, gym[2], { title: 'Swim', scope: 'following', keepRule: true }));
    await run();
    const all = evs().filter((e) => /^(Gym|Swim)/.test(e.title)).sort((a, b) => a.start - b.start);
    assert.deepStrictEqual(all.map((e) => e.title.replace(' (legs)', '')), ['Gym', 'Gym', 'Swim', 'Swim']);
    assert.ok(/UNTIL=/.test(store['me@x'].s1.recurrence[0]), 'old series ends'); ok();

    // Delete one occurrence, then all of a series
    const sw = all.filter((e) => e.title === 'Swim');
    E.merge(state, E.opDel('events', Object.assign({}, sw[0], { scope: 'one' }), 'phone', tick()));
    await run();
    assert.strictEqual(evs().filter((e) => e.title === 'Swim').length, 1); ok();
    run4 = evs().filter((e) => e.title === 'Run');
    E.merge(state, E.opDel('events', Object.assign({}, run4[0], { scope: 'all' }), 'phone', tick()));
    assert.strictEqual(evs().filter((e) => e.title === 'Run').length, 0, 'gone right away'); ok();
    await run();
    assert.strictEqual(evs().filter((e) => e.title === 'Run').length, 0); ok();

    // Move a single event to another calendar
    const rv2 = evs().find((e) => e.title === 'Review');
    put(Object.assign({}, rv2, { cal: 'me@x', oldCal: 'work@x' }));
    await run();
    assert.strictEqual(evs().find((e) => e.title === 'Review').cal, 'me@x'); assert.ok(!store['work@x'][rv2.gid]); ok();

    console.log(pass + ' bridge v2 checks passed');
  } catch (e) { console.error('FAIL', e); process.exitCode = 1; }
  srv.close();
});
