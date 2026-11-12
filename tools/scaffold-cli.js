#!/usr/bin/env node
/* Scaffold command line, for Claude sessions. Reads this computer's Scaffold app data, sends changes to every device.
   node scaffold-cli.js today                      what is due today, notes waiting
   node scaffold-cli.js list <habits|todos|projects|notes|events|vault>
   node scaffold-cli.js put <map> '<json>'         create, or update by "id" (only the given fields change)
   node scaffold-cli.js del <map> <id>
   node scaffold-cli.js done <id> [tiny]
   Maps: habits (stored as "tasks"), todos, projects, notes, events. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const here = __dirname;
const E = require(fs.existsSync(path.join(here, 'engine.js')) ? path.join(here, 'engine.js') : path.join(here, '..', 'shared', 'engine.js'));
const { Sync } = require(fs.existsSync(path.join(here, 'sync.js')) ? path.join(here, 'sync.js') : path.join(here, '..', 'desktop', 'sync.js'));

function dataDir() {
  if (process.env.SCAFFOLD_DATA) return process.env.SCAFFOLD_DATA;
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Scaffold');
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Scaffold');
  return path.join(os.homedir(), '.config', 'Scaffold');
}
function read(f) { try { return JSON.parse(fs.readFileSync(path.join(dataDir(), f), 'utf8')); } catch (e) { return null; } }
function die(msg) { console.error(msg); process.exit(1); }

const state = read('state.json') || E.emptyState();
const local = read('local.json') || {};
E.MAPS.forEach((m) => { state[m] = state[m] || {}; });
const MAP = { habits: 'tasks', habit: 'tasks', tasks: 'tasks', todos: 'todos', todo: 'todos', projects: 'projects', project: 'projects', notes: 'notes', note: 'notes', events: 'events', event: 'events' };
const BY = 'claude';

function send(patch) {
  if (!local.syncCode) die('This computer has no sync code: open Scaffold → Settings → Sync first.');
  const s = new Sync({ code: local.syncCode, deviceId: BY + '-' + (local.deviceId || 'x'), since: '', onPatch() {}, onStatus() {}, onSince() {} });
  s.publish(E.chunks(patch), false);
  const t0 = Date.now();
  const iv = setInterval(() => {
    if (!s.outbox.length && !s.sending) { clearInterval(iv); s.stop(); console.log('sent to all devices'); }
    else if (Date.now() - t0 > 20000) { clearInterval(iv); s.stop(); die('could not reach the relay; nothing was sent'); }
  }, 100);
}
function clean(r) { const o = Object.assign({}, r); delete o.ts; delete o.by; return o; }
function show(x) { console.log(JSON.stringify(x, null, 1)); }

const [cmd, a, b] = process.argv.slice(2);
const now = Date.now();
if (cmd === 'today') {
  const r = E.compute(state, now);
  show({
    paused: r.paused, done: r.done, total: r.total,
    items: r.items.map((i) => ({ id: i.id, type: i.type, title: i.task.title, status: i.status, done: i.done, locked: i.locked, window: i.nudge ? null : E.hhmm(i.start) + '-' + E.hhmm(i.due), deadlineDay: i.deadlineDay || E.dateKey(now) })),
    notesWaiting: r.notes.map((n) => n.note.text)
  });
} else if (cmd === 'list') {
  if (a === 'vault') show(E.vaultProjects(state));
  else { const m = MAP[a]; if (!m) die('list what? habits, todos, projects, notes, events, vault'); show(Object.values(state[m]).filter((x) => !x.del).map(clean)); }
} else if (cmd === 'put') {
  const m = MAP[a]; if (!m) die('put into which map? habits, todos, projects, notes, events');
  let rec; try { rec = JSON.parse(b); } catch (e) { die('the record must be JSON'); }
  const old = rec.id && state[m][rec.id];
  if (rec.id && !old) die('no ' + a + ' with id ' + rec.id + ' (leave "id" out to create one)');
  const merged = Object.assign({}, old ? clean(old) : {}, rec);
  if (m === 'notes' && (!old || (rec.every && rec.every !== old.every))) merged.anchor = now;
  const patch = E.opPut(m, merged, BY, now);
  console.log('id:', Object.keys(patch[m])[0]);
  send(patch);
} else if (cmd === 'del') {
  const m = MAP[a], r = m && state[m][b];
  if (!r) die('not found: ' + a + ' ' + b);
  send(E.opDel(m, r, BY, now));
} else if (cmd === 'done') {
  if (!state.tasks[a] && !state.todos[a]) die('no habit or task with id ' + a);
  send(E.opComplete(a, b === 'tiny' ? 'tiny' : 'full', BY, now, state));
} else {
  console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 9).join('\n').replace(/^\/\* ?|\*\/$/g, ''));
}
