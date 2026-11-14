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

/* Google events -> this device's own copy, keyed like Scaffold events. res = the bridge's pull reply (or, from an old
   caller, its events array); prev = the last copy (kept when the bridge says nothing changed).
   Bridge v2 entries: { id, v: 2, gid, cal, title, desc, start, end, allDay, color, ro (read-only calendar), series, ostart, rrule, gupd }.
   Old bridge: { id, gid, title, start, end, allDay, ro (= repeating), gupd }. "_cals" holds the calendar list and colors, "_meta" the pull info.
   Events that are Scaffold tasks on Google (sid = a task id) are left out: they show as tasks. */
const FROM = 45 * DAY, TO = 300 * DAY;
function midnight(key) { const p = String(key).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]).getTime(); }
function toGev(res, todos, prev) {
  if (Array.isArray(res)) res = { events: res };
  if (res.same && prev && prev._meta) return Object.assign({}, prev, { _meta: Object.assign({}, prev._meta, { at: res.now || Date.now() }) });
  const gev = {}, v2 = res.v >= 2, cals = {};
  (res.cals || []).forEach((c) => { cals[c.id] = c; });
  let n = 0;
  for (const g of res.events || []) {
    if (g.sid && todos[g.sid]) continue;
    n++;
    if (!v2) {
      const key = g.gid + '|' + (g.rec ? g.start : ''), id = g.sid || ('g_' + hashId(key));
      gev[id] = { id, gid: g.gid, title: g.title, start: g.start, end: g.end, allDay: !!g.allDay, ro: !!g.rec, gupd: g.upd };
      continue;
    }
    const id = !g.series && g.sid ? g.sid : 'g_' + hashId(g.gid);
    gev[id] = { id, v: 2, gid: g.gid, cal: g.cal, title: g.title, desc: g.desc || '', allDay: !!g.allDay,
      start: g.allDay ? midnight(g.sd) : g.start, end: g.allDay ? midnight(g.ed) : g.end, color: g.color || '', ro: !!(cals[g.cal] || {}).ro,
      series: g.series || '', ostart: typeof g.ostart === 'string' && g.ostart ? midnight(g.ostart) : (g.ostart || 0),
      rrule: g.series ? (res.rules || {})[g.series] || '' : '', gupd: g.upd };
  }
  if (v2) gev._cals = { list: res.cals || [], colors: res.colors || {} };
  gev._meta = { v: res.v || 1, sig: res.sig || '', at: res.now || Date.now(), full: res.now || Date.now(), n };
  return gev;
}
// prev: the last copy; asks the bridge "anything new?" unless the last full read is over 6 h old.
async function pull(url, secret, prev) {
  const now = Date.now(), m = prev && prev._meta, req = { secret, op: 'pull', from: now - FROM, to: now + TO };
  if (m && m.v >= 2 && m.sig && m.at && now - (m.full || 0) < 6 * 3600e3) { req.since = m.at; req.sig = m.sig; req.from = m.full - FROM; req.to = m.full + TO; }
  const res = await call(url, req);
  if (res.same && m) res.full = m.full;
  return res;
}
function evCount(gev) { return (gev._meta && gev._meta.n) || Object.keys(gev).filter((k) => k[0] !== '_').length; }
function keyOf(t) { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

/* One sync round on the computer that owns the Google link. ctx: { url, secret, state, local, Engine, by, apply(patch) }.
   Pulls Google into this device's copy (returned as gev; never sent through sync), pushes Scaffold-made or edited events
   and one-time tasks with a time. local.calMap = { todoId: { gid, sig } } remembers which tasks are on Google. */
async function syncOnce(ctx) {
  const { url, secret, state, local, Engine, by, apply } = ctx, prevGev = ctx.gev || state.gev;
  const now = Date.now(), from = now - 14 * DAY, to = now + 120 * DAY;
  let res = await pull(url, secret, prevGev), google = res.events || [];
  const events = state.events || {}, todos = state.todos || {}, tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
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
      if (e.gid) await call(url, { secret, op: 'delete', gid: e.gid, cal: e.cal || '', scope: e.scope || '', series: e.series || '', ostart: e.allDay && e.ostart ? keyOf(e.ostart) : (e.ostart || '') });
      Object.assign(patch.events, { [id]: Object.assign({}, e, { synced: now + 3, ts: now + 3, by }) });
    } else {
      const r = await call(url, { secret, op: 'upsert', sid: id, gid: e.gid || '', cal: e.cal || '', oldCal: e.oldCal || '', title: e.title, desc: e.desc, color: e.color || '',
        start: e.start, end: e.end, allDay: !!e.allDay, sd: e.allDay ? keyOf(e.start) : '', ed: e.allDay ? keyOf(e.end) : '', tz,
        rrule: e.rrule || '', keepRule: !!e.keepRule, scope: e.scope || '', series: e.series || '', ostart: e.allDay && e.ostart ? keyOf(e.ostart) : (e.ostart || '') });
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
  if (changed) res = await pull(url, secret, null);   // so this device shows Google's new version right away
  const gev = toGev(res, state.todos || {}, prevGev);
  return { gev, v: gev._meta.v, status: `synced ${new Date().toTimeString().slice(0, 5)} · ${evCount(gev)} Google events` + (pulled || pushed ? ` · ${pulled} in, ${pushed} out` : '') };
}

module.exports = { syncOnce, call, todoSlot, pull, toGev, hashId, evCount };
