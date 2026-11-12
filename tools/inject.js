// Dev helper: node tools/inject.js <kind>   writes a patch the dev desktop app picks up within 5 s.
const E = require('../shared/engine.js'); const fs = require('fs'); const os = require('os'); const path = require('path');
const F = path.join(os.homedir(), 'Library/Application Support/Scaffold-dev/inject.json');
const n = Date.now(), d = new Date(n), hm = (t) => { const x = new Date(t); return E.pad(x.getHours()) + ':' + E.pad(x.getMinutes()); };
const k = process.argv[2], arg = process.argv[3];
let p;
if (k === 'lock') p = E.opTask({ id: 'tlock', title: 'Test lock', emoji: '🧪', start: hm(n - 60000), due: hm(n + 600000), level: 4, kind: 'check', desktop: arg || 'lock', color: '#ff7a90' }, 'dev', n);
if (k === 'remind') p = E.opTask({ id: 'trem', title: 'Drink water', emoji: '💧', start: hm(n + 60000), due: hm(n + 3600000), level: 2, kind: 'check', color: '#5cc8ff' }, 'dev', n);
if (k === 'done') p = E.opComplete(arg, 'full', 'dev', n);
if (k === 'del') p = { tasks: { [arg]: { id: arg, del: true, ts: n, by: 'dev' } } };
if (k === 'undo') p = E.opUndo(arg, 'dev', n);
if (k === 'stop') p = E.opPause(true, 'dev', n);
if (k === 'resume') p = E.opPause(false, 'dev', n);
fs.writeFileSync(F, JSON.stringify(p)); console.log('injected', k);
