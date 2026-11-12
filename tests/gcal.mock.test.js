// Two-way calendar sync against a fake Apps Script (same ops, same redirect dance). Run: node tests/gcal.mock.test.js
const http = require('http'), assert = require('assert');
const E = require('../shared/engine.js'), Cal = require('../desktop/calendar.js');
const SECRET = 's3cret';
let g = {}, seq = 1, results = {};
const tick = () => Date.now() + (seq++);
const srv = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url.startsWith('/result')) { const id = req.url.split('=')[1]; res.setHeader('Content-Type', 'application/json'); return res.end(results[id]); }
  let body = ''; req.on('data', (c) => body += c); req.on('end', () => {
    const r = JSON.parse(body); let out;
    if (r.secret !== SECRET) out = { error: 'forbidden' };
    else if (r.op === 'pull') out = { events: Object.values(g).filter((e) => e.start < r.to && e.end > r.from).map((e) => ({ ...e })) };
    else if (r.op === 'upsert') {
      let e = (r.gid && g[r.gid]) || Object.values(g).find((x) => x.sid === r.sid);
      if (!e) { const gid = 'gid' + seq++; e = g[gid] = { gid, sid: r.sid }; }
      Object.assign(e, { title: r.title, start: r.start, end: r.end, allDay: r.allDay, rec: false, upd: tick() });
      out = { gid: e.gid, upd: e.upd };
    } else if (r.op === 'delete') { delete g[r.gid]; out = { ok: true }; }
    const id = String(seq++); results[id] = JSON.stringify(out);
    res.writeHead(302, { Location: '/result?id=' + id }); res.end();
  });
});
srv.listen(0, async () => {
  const url = 'http://127.0.0.1:' + srv.address().port + '/exec';
  const state = E.emptyState(), local = {};
  const run = async () => { const r = await Cal.syncOnce({ url, secret: SECRET, state, local, Engine: E, by: 'mac', apply: (p) => E.merge(state, p) }); state.gev = r.gev; return r.status; };
  const find = (pred) => Object.values(E.eventsFor(state)).find(pred);
  const now = Date.now(), day = E.dateKey(now);
  let pass = 0; const ok = (m) => { pass++; };
  try {
    g.g1 = { gid: 'g1', sid: '', title: 'Dentist', start: now + 3600e3, end: now + 7200e3, allDay: false, rec: false, upd: tick() };
    await run(); assert.ok(find((e) => e.gid === 'g1' && e.title === 'Dentist')); assert.ok(!Object.values(state.events).some((e) => e.gid === 'g1'), 'pulled events stay out of synced state'); ok('pull new');
    E.merge(state, E.opPut('events', { id: 'b', title: 'Gym', start: now + 86400e3, end: now + 90000e3 }, 'phone', Date.now()));
    await run(); assert.ok(Object.values(g).find((e) => e.sid === 'b' && e.title === 'Gym')); assert.ok(state.events.b.gid); ok('push new');
    await new Promise((r) => setTimeout(r, 5));
    Object.assign(g.g1, { title: 'Dentist (moved)', start: now + 2 * 3600e3, upd: tick() + 10 });
    await run(); assert.strictEqual(find((e) => e.gid === 'g1').title, 'Dentist (moved)'); ok('pull edit');
    await new Promise((r) => setTimeout(r, 5));
    E.merge(state, E.opPut('events', Object.assign({}, state.events.b, { title: 'Gym (legs)' }), 'phone', Date.now()));
    await run(); assert.strictEqual(g[state.events.b.gid].title, 'Gym (legs)'); ok('push edit');
    delete g.g1;
    await run(); assert.ok(!find((e) => e.gid === 'g1')); ok('pull delete');
    const bg = state.events.b.gid;
    await new Promise((r) => setTimeout(r, 50));   // the fake Google clock runs a few ms ahead
    E.merge(state, E.opDel('events', state.events.b, 'phone', Date.now()));
    assert.ok(!find((e) => e.id === 'b'), 'deleted event hidden before Google catches up');
    await run(); assert.ok(!g[bg]); ok('push delete');
    E.merge(state, E.opPut('todos', { id: 't1', title: 'Make HUD Sprites', emoji: '🎯', date: day, start: '15:00', due: '17:00' }, 'phone', Date.now()));
    await run(); const tg = Object.values(g).find((e) => e.sid === 't1'); assert.ok(tg && tg.title === '🎯 Make HUD Sprites'); ok('task -> google');
    await new Promise((r) => setTimeout(r, 5));
    Object.assign(tg, { start: E.at(now, '18:00'), end: E.at(now, '19:30'), upd: Date.now() + 1000 });
    await run(); assert.strictEqual(state.todos.t1.start, '18:00'); assert.strictEqual(state.todos.t1.due, '19:30'); assert.strictEqual(E.hhmm(tg.start), '18:00', 'google keeps the new time'); ok('google moves task');
    const st = await run();
    assert.ok(!/ in, /.test(st), 'idempotent: ' + st); ok('steady state');
    console.log(pass + ' calendar sync checks passed');
  } catch (e) { console.error('FAIL', e.message); process.exitCode = 1; }
  srv.close();
});
