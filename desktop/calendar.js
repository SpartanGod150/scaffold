/* Two-way Google Calendar sync through the user's own Apps Script web app (ui/gcal-script.js).
   Every device pulls Google itself (-14 to +120 days) into its own copy; only edits travel through Scaffold's sync.
   The computer with the Google link pushes Scaffold-made events and one-time tasks with a time to Google. */
const https = require('https');
const { URL } = require('url');

const DAY = 86400000;

function call(url, body, redirects) {
  return new Promise((resolve, reject) => {
    const u = new URL(url), data = body ? JSON.stringify(body) : null;
    const mod = u.protocol === 'http:' ? require('http') : https;
    const req = mod.request({ port: u.port || undefined, hostname: u.hostname, host: u.host, path: u.pathname + u.search, method: data ? 'POST' : 'GET',
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && (redirects || 0) < 5) {
        res.resume();
        // Apps Script answers a POST with a redirect to the result, fetched with GET.
        return resolve(call(new URL(res.headers.location, url).toString(), res.statusCode === 307 || res.statusCode === 308 ? body : null, (redirects || 0) + 1));
      }
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
        try { const j = JSON.parse(buf); if (j.error) reject(new Error(j.error)); else resolve(j); }
        catch (e) { reject(new Error('Not a bridge reply (is the URL the /exec one?)')); }
      });
    });
    req.setTimeout(90000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(data || undefined);
  });
}

function hashId(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
function todoSlot(Engine, t) {
  if (!t || t.del || t.active === false || (t.repeat || 'none') !== 'none' || !t.date || !t.start) return null;
  const day = Engine.fromKey(t.date), start = Engine.at(day, t.start);
  let end = Engine.at(day, t.due || t.start);
  if (end <= start) end = start + 30 * 60000;
  return { title: (t.emoji ? t.emoji + ' ' : '') + t.title, start, end };
}

/* Google events -> this device's own copy, keyed like Scaffold events ({ id: {id, gid, title, start, end, allDay, ro, gupd} }).
   Events that are Scaffold tasks on Google (sid = a task id) are left out: they show as tasks. */
function toGev(google, todos) {
  const gev = {};
  for (const g of google) {
    if (g.sid && todos[g.sid]) continue;
    const key = g.gid + '|' + (g.rec ? g.start : ''), id = g.sid || ('g_' + hashId(key));
    gev[id] = { id, gid: g.gid, title: g.title, start: g.start, end: g.end, allDay: !!g.allDay, ro: !!g.rec, gupd: g.upd };
  }
  return gev;
}
async function pull(url, secret) {
  const now = Date.now();
  const res = await call(url, { secret, op: 'pull', from: now - 14 * DAY, to: now + 120 * DAY });
  return res.events || [];
}

/* One sync round on the computer that owns the Google link. ctx: { url, secret, state, local, Engine, by, apply(patch) }.
   Pulls Google into this device's copy (returned as gev; never sent through sync), pushes Scaffold-made or edited events
   and one-time tasks with a time. local.calMap = { todoId: { gid, sig } } remembers which tasks are on Google. */
async function syncOnce(ctx) {
  const { url, secret, state, local, Engine, by, apply } = ctx;
  const now = Date.now(), from = now - 14 * DAY, to = now + 120 * DAY;
  let google = await pull(url, secret);
  const events = state.events || {}, todos = state.todos || {};
  local.calMap = local.calMap || {};
  const seen = {}, patch = { events: {}, todos: {} };
  let pulled = 0, pushed = 0;

  for (const g of google) {
    seen[g.gid + '|' + (g.rec ? g.start : '')] = 1;
    if (g.sid && todos[g.sid]) { // a task that lives on Google: edits there move the task
      const t = todos[g.sid], slot = todoSlot(Engine, t), m = local.calMap[g.sid];
      seen['todo:' + g.sid] = 1;
      if (m && g.upd > (m.upd || 0) && g.upd > (t.ts || 0) && slot && (slot.start !== g.start || slot.end !== g.end)) {
        const c = JSON.parse(JSON.stringify(t));
        c.date = Engine.dateKey(g.start); c.start = Engine.hhmm(g.start); c.due = Engine.hhmm(g.end);
        Object.assign(patch.todos, Engine.opPut('todos', c, by, now).todos);
        local.calMap[g.sid] = { gid: g.gid, upd: g.upd, sig: JSON.stringify(todoSlot(Engine, c)) };
        pulled++;
      }
    }
  }

  // Scaffold-side changes go up (events made or edited in Scaffold, on any device).
  let changed = false;
  for (const id of Object.keys(events)) {
    const e = events[id];
    if (e.ro || (e.synced && e.synced >= (e.ts || 0))) continue;   // already on Google
    if (e.del) {
      if (e.gid) await call(url, { secret, op: 'delete', gid: e.gid });
      Object.assign(patch.events, { [id]: Object.assign({}, e, { synced: now + 3, ts: now + 3, by }) });
    } else {
      const r = await call(url, { secret, op: 'upsert', sid: id, gid: e.gid || '', title: e.title, start: e.start, end: e.end, allDay: !!e.allDay });
      Object.assign(patch.events, { [id]: Object.assign({}, e, { gid: r.gid, gupd: r.upd, synced: now + 3, ts: now + 3, by }) });
    }
    pushed++; changed = true;
  }
  for (const id of Object.keys(todos)) {
    if (patch.todos[id]) continue; // just moved from Google this round
    const slot = todoSlot(Engine, todos[id]), m = local.calMap[id];
    if (!slot) {
      if (m && m.gid) { await call(url, { secret, op: 'delete', gid: m.gid }); delete local.calMap[id]; pushed++; }
      continue;
    }
    const sig = JSON.stringify(slot);
    if (m && m.sig === sig && seen['todo:' + id]) continue;
    const r = await call(url, { secret, op: 'upsert', sid: id, gid: (m && m.gid) || '', title: slot.title, start: slot.start, end: slot.end, allDay: false });
    local.calMap[id] = { gid: r.gid, upd: r.upd, sig };
    pushed++;
  }
  if (Object.keys(patch.events).length || Object.keys(patch.todos).length) apply(patch);
  if (changed) google = await pull(url, secret);   // so this device shows Google's new version right away
  const gev = toGev(google, state.todos || {});
  return { gev, status: `synced ${new Date().toTimeString().slice(0, 5)} · ${google.length} Google events` + (pulled || pushed ? ` · ${pulled} in, ${pushed} out` : '') };
}

module.exports = { syncOnce, call, todoSlot, pull, toGev, hashId };
