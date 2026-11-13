// Tells every Scaffold device that a new version is out, so they check for it right away instead of on their
// next 15-minute check. Sent through ntfy and, when this computer has the Google script, its backup mailbox too.
//   node tools/announce.js 0.3.7      (called by tools/release.sh)
const fs = require('fs'), path = require('path'), os = require('os'), https = require('https');
const E = require('../shared/engine.js'), S = require('../desktop/sync.js'), C = require('../desktop/calendar.js');
const dir = process.platform === 'darwin' ? path.join(os.homedir(), 'Library/Application Support/Scaffold') : path.join(process.env.APPDATA || '', 'Scaffold');
const local = JSON.parse(fs.readFileSync(path.join(dir, 'local.json'), 'utf8'));
if (!local.syncCode) { console.log('announce: no sync code here, skipped'); process.exit(0); }
const v = process.argv[2], now = Date.now(), patch = { log: {} };
patch.log[E.uid()] = { type: 'release', v, ts: now, by: 'release' };
const msg = S.encrypt(S.keyFor(local.syncCode), { d: 'release-' + local.deviceId, p: patch, s: 0 });
const ntfy = new Promise((ok) => {
  const req = https.request({ host: 'ntfy.sh', path: '/' + S.topicFor(local.syncCode), method: 'POST', headers: { 'User-Agent': 'Scaffold/0.1', 'Content-Type': 'text/plain' } }, (r) => { r.resume(); ok('ntfy ' + r.statusCode); });
  req.setTimeout(15000, () => req.destroy(new Error('timeout'))); req.on('error', (e) => ok('ntfy failed (' + e.message + ')')); req.end(msg);
});
const google = local.calUrl ? C.call(local.calUrl, { secret: local.calSecret, op: 'relay-post', msgs: [msg] }).then(() => 'google ok', (e) => 'google failed (' + e.message + ')') : Promise.resolve('no google script');
const st = (() => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')); } catch (e) { return {}; } })();
const fbUrl = st.cfg && st.cfg.fb && !st.cfg.fb.del && st.cfg.fb.url;
const fb = fbUrl ? require('../desktop/firebase.js').req('POST', fbUrl + '/s/' + S.topicFor(local.syncCode) + '/m.json', { d: msg, t: { '.sv': 'timestamp' } }).then(() => 'firebase ok', (e) => 'firebase failed (' + e.message + ')') : Promise.resolve('no firebase');
Promise.all([fb, ntfy, google]).then((r) => console.log('announce ' + v + ': ' + r.join(', ')));
