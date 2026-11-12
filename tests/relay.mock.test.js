// Run: node tests/relay.mock.test.js  (~80 s). Two devices that can't reach ntfy exchange a change through a
// local stand-in for the Google script's backup mailbox (same ops as ui/gcal-script.js relay()).
const http = require('http'), assert = require('assert');
global.window = {}; require('../ui/gcal-script.js');
const { Sync } = require('../desktop/sync.js');
// In-memory Apps Script: run the real relay() code with fake CacheService / LockService / ContentService.
const store = {};
const env = {
  CacheService: { getScriptCache: () => ({ get: (k) => store[k] || null, put: (k, v) => { store[k] = v; }, putAll: (o) => Object.assign(store, o), getAll: (ks) => { const o = {}; ks.forEach((k) => { if (store[k]) o[k] = store[k]; }); return o; } }) },
  LockService: { getUserLock: () => ({ waitLock() {}, releaseLock() {} }), getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  ContentService: { createTextOutput: (s) => ({ setMimeType: () => s }), MimeType: { JSON: 1 } },
  CalendarApp: {}
};
const doPost = new Function(...Object.keys(env), window.GCAL_SCRIPT.replace('__SECRET__', 'sec') + '\nreturn doPost;')(...Object.values(env));
const srv = http.createServer((req, res) => { let b = ''; req.on('data', (c) => b += c); req.on('end', () => res.end(doPost({ postData: { contents: b } }))); });
srv.listen(0, async () => {
  const url = 'http://127.0.0.1:' + srv.address().port + '/exec', got = { A: [], B: [] };
  const mk = (id) => new Sync({ code: 'test-' + process.pid, deviceId: id, since: '1m', onPatch: (p) => got[id].push(p), onStatus: () => {}, onSince: () => {}, relay: () => ({ url, secret: 'sec' }) });
  const A = mk('A'), B = mk('B');
  A._connect = B._connect = function () { this._retry('blocked (test)'); };   // pretend ntfy is unreachable
  A.downSince = B.downSince = Date.now() - 60000;
  A.start(); B.start();
  await new Promise((r) => setTimeout(r, 15000));
  assert.ok(A.blocked() && A.backupActive(), 'A sees itself blocked');
  A.publish([{ todos: { x: { id: 'x', title: 'via Google', ts: 1, by: 'A' } } }], false);
  await new Promise((r) => setTimeout(r, 25000));
  A.stop(); B.stop(); srv.close();
  assert.ok(got.B.some((p) => p.todos && p.todos.x), 'B got A\'s change through the backup mailbox');
  assert.ok(!got.A.some((p) => p.todos && p.todos.x), 'A ignores its own message');
  console.log('relay fallback ok');
  process.exit(0);
});
