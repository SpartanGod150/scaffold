// Live test against ntfy.sh: device B must receive what device A publishes, decrypted and merged.
const { Sync } = require('../desktop/sync.js'); const E = require('../shared/engine.js');
const code = 'test-' + Math.random().toString(36).slice(2) + '-otter-1234';
const got = []; let ready = 0;
const mk = (id) => new Sync({ code, deviceId: id, since: 'all', onPatch: (p) => got.push([id, p]), onStatus: (s) => { if (s === 'connected') ready++; }, onSince: () => {} });
const A = mk('A'), B = mk('B'); A.start(); B.start();
const t0 = Date.now();
const iv = setInterval(() => {
  if (ready >= 2 && !A.sent) { A.sent = true; A.publish(E.chunks(E.opPause(true, 'A', Date.now())), false); }
  const b = got.find(([id, p]) => id === 'B' && p.pause && p.pause.on);
  if (b || Date.now() - t0 > 20000) {
    clearInterval(iv); A.stop(); B.stop();
    console.log(b ? `SYNC OK in ${Date.now() - t0} ms; A ignored own msg: ${!got.some(([id]) => id === 'A')}` : 'SYNC FAILED');
    process.exit(b ? 0 : 1);
  }
}, 100);
