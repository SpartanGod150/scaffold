/* Scaffold desktop (Mac + Windows): tray app that reminds, pops up, locks the screen and syncs with every other device. */
const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, screen, globalShortcut, nativeImage, dialog, shell, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Engine = require('./ui/engine.js');
const { Sync } = require('./sync.js');
const Modes = require('./modes.js');
const Vault = require('./vault.js');
const Calendar = require('./calendar.js');
const Gauth = require('./gauth.js');
let GBridge; try { GBridge = require('../shared/gbridge.js'); } catch (e) { GBridge = require('./ui/gbridge.js'); }   // packaged app: copied into ui/
const Updater = require('./updater.js');
const KeepAlive = require('./keepalive.js');
const UPDATE_CFG = (() => { try { return require('./ui/update.json'); } catch (e) { return {}; } })();

if (process.env.SCAFFOLD_DEV) app.setPath('userData', process.env.SCAFFOLD_DATA || (app.getPath('userData') + '-dev'));   // SCAFFOLD_DATA: run several test devices
const GOT_LOCK = !!process.env.SCAFFOLD_DATA || app.requestSingleInstanceLock();
if (!GOT_LOCK) app.quit();

const UI = path.join(__dirname, 'ui', 'index.html');
const DATA = app.getPath('userData');
const STATE_F = path.join(DATA, 'state.json');
const LOCAL_F = path.join(DATA, 'local.json');
const STOP_F = path.join(DATA, 'STOP');           // creating this file triggers an emergency stop (escape hatch)
// Always on: after "Quit Scaffold" it stays off until opened by hand; automatic starts (login, keep-alive) see quit.flag and leave.
const KA = KeepAlive.flags(DATA);
const KEEPALIVE_ON = !process.env.SCAFFOLD_DEV || !!process.env.SCAFFOLD_KEEPALIVE_TEST;
const AUTO_START = process.argv.includes('--background') || (process.platform === 'darwin' && (() => { try { return app.getLoginItemSettings().wasOpenedAtLogin; } catch (e) { return false; } })());
if (GOT_LOCK) {
  if (fs.existsSync(KA.quit)) { if (AUTO_START) app.exit(0); else try { fs.unlinkSync(KA.quit); } catch (e) {} }
  try { fs.unlinkSync(KA.updating); } catch (e) {}
}
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

let state, local, tray, mainWin, popupWin, noteWin, waWin, lockWin, closeWin, coverWin, blockedWin, guard = null, sync = null;

function readJSON(f, d) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } }
function writeJSON(f, v) { try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(f + '.tmp', JSON.stringify(v)); fs.renameSync(f + '.tmp', f); } catch (e) { console.error(e); } }
function saveState() { writeJSON(STATE_F, state); }
// This device's own copy of Google Calendar (never synced; every device pulls it).
const GEV_F = path.join(DATA, 'gcal.json');
let gev = {};
function saveLocal() { writeJSON(LOCAL_F, local); }
function E_MAPS_FIX() { Engine.MAPS.forEach((m) => { state[m] = state[m] || {}; }); }
function rec(id) { return (state.tasks || {})[id] || (state.todos || {})[id] || {}; }

// A key for this computer that survives reinstalling Scaffold (the OS's own machine id, hashed), so a reinstall
// gets its old place in Devices back instead of showing up twice.
function hardwareKey() {
  try {
    const { execFileSync } = require('child_process');
    let raw = '';
    if (process.platform === 'darwin') raw = (/"IOPlatformUUID" = "([^"]+)"/.exec(execFileSync('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf8', timeout: 5000 })) || [])[1] || '';
    else if (process.platform === 'win32') raw = (/MachineGuid\s+REG_SZ\s+(\S+)/.exec(execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { encoding: 'utf8', timeout: 5000, windowsHide: true })) || [])[1] || '';
    return raw ? crypto.createHash('sha256').update('scaffold:' + raw).digest('hex').slice(0, 16) : '';
  } catch (e) { return ''; }
}
function loadAll() {
  state = readJSON(STATE_F, Engine.emptyState());
  gev = readJSON(GEV_F, {});
  if (Engine.dropPulledCopies(state, Date.now())) saveState();
  const hw = hardwareKey();
  local = Object.assign({
    deviceId: (process.platform === 'darwin' ? 'mac-' : 'pc-') + (hw ? hw.slice(0, 8) : crypto.randomBytes(4).toString('hex')),
    deviceName: process.platform === 'darwin' ? 'MacBook' : 'PC',
    syncCode: '', since: '', timer: null, autostart: true, frozen: {},
    lastCheck: Date.now(), lastSnapSeen: 0, firstRun: true,
    vaultPath: '', vaultSig: '', ticked: {}, calUrl: '', calSecret: crypto.randomBytes(18).toString('hex'), calMap: {}
  }, readJSON(LOCAL_F, {}));
  local.hw = hw;
  E_MAPS_FIX();
  saveLocal();
}

// ---------- state changes ----------
function applyPatch(patch, publish) {
  const tests = Object.keys(patch.log || {}).filter((k) => patch.log[k].type === 'test-remind' && !(state.log || {})[k] && patch.log[k].ts > Date.now() - 120000);
  const changed = Engine.merge(state, patch);
  if (changed) Engine.dropPulledCopies(state, Date.now());   // old Google copies from devices on older versions
  if (tests.length) testRemind();
  const rel = Object.keys(patch.log || {}).some((k) => patch.log[k].type === 'release' && !(state.log || {})[k] && patch.log[k].ts > Date.now() - 3600e3 && Updater.newer(patch.log[k].v || '0', app.getVersion()));
  if (rel) setTimeout(runUpdate, 5000 + Math.random() * 20000);   // a new version was just released
  if (changed) saveState();
  if (publish && sync) sync.publish(Engine.chunks(patch), false);
  if (changed || publish) { evaluate(); notifyUI(); }
  if (changed) {
    tickVault(patch);
    const at = (gev._meta && gev._meta.at) || 0;
    const ops = Object.keys(patch.cfg || {}).filter((k) => k.indexOf('calop:') === 0).map((k) => patch.cfg[k]);
    if (Object.values(patch.events || {}).concat(ops).some((e) => e && e.pushed > at)) lastPull = 0;   // Google just changed: read it soon
    if (patch.events || patch.todos || ops.some((o) => o && !o.done && !o.err)) calSoon();
  }
}
function notifyUI() {
  BrowserWindow.getAllWindows().forEach((w) => { if (!w.isDestroyed() && w !== waWin) w.webContents.send('native'); });
  updateTray();
}

// ---------- sync ----------
function startSync() {
  if (sync) { sync.stop(); sync = null; }
  local.sync = { status: local.syncCode ? 'connecting…' : 'off' };
  if (!local.syncCode) return;
  sync = new Sync({
    code: local.syncCode, deviceId: local.deviceId, since: local.since,
    onPatch: (p, isSnap) => { if (isSnap) local.lastSnapSeen = Date.now(); applyPatch(p, false); },
    onStatus: (s) => { local.sync = { status: s }; notifyUI(); },
    onSince: (id) => { local.since = id; saveLocalSoon(); },
    relay: () => { const r = relayCfg(); return r && r.url !== 'google' ? r : null; },   // the backup mailbox is the script's only
    firebase: () => Engine.fbUrl(state),
    fbSince: local.fbSince || 0,
    onFbSince: (t) => { local.fbSince = t; saveLocalSoon(); },
    onScriptOld: (old) => { if (!!local.scriptOld !== old && local.calUrl) { local.scriptOld = old; saveLocalSoon(); notifyUI(); } },
    onBackupStart: () => maybeSnapshot(true)
  });
  sync.start();
  setTimeout(() => { shareRelay(); maybeSnapshot(true); }, 4000);
}
// Google backup mailbox (the calendar script): this computer's own link, else the one another device shared.
function relayCfg() {
  if (Engine.google(state)) return { url: 'google', secret: '' };   // "Sign in with Google" wins over the old script
  if (local.calUrl) return { url: local.calUrl, secret: local.calSecret };
  const r = state.cfg && state.cfg.relay;
  return r && !r.del && r.url ? { url: r.url, secret: r.secret } : null;
}
function shareRelay() {
  const r = state.cfg && state.cfg.relay;
  if (local.calUrl && (!r || r.url !== local.calUrl || r.secret !== local.calSecret))
    applyPatch(Engine.opPut('cfg', { id: 'relay', url: local.calUrl, secret: local.calSecret }, local.deviceId, Date.now()), true);
}
let saveT;
function saveLocalSoon() { clearTimeout(saveT); saveT = setTimeout(saveLocal, 2000); }
function maybeSnapshot(force) {
  if (!sync) return;
  const quiet = Date.now() - (local.lastSnapSeen || 0) > (5 * 3600e3 + Math.random() * 3600e3);
  if (force || quiet) { sync.publish(Engine.chunks(Engine.snapshot(state, Date.now())), true); local.lastSnapSeen = Date.now(); saveLocal(); }
}

// ---------- the loop ----------
function evaluate() {
  const now = Date.now();
  if (fs.existsSync(STOP_F)) { try { fs.unlinkSync(STOP_F); } catch (e) {} if (!state.pause.on) applyPatch(Engine.opPause(true, local.deviceId, now), true); }
  // dev only: tests feed patches through this file
  const INJ = path.join(DATA, 'inject.json');
  if (process.env.SCAFFOLD_DEV && fs.existsSync(INJ)) { try { const p = JSON.parse(fs.readFileSync(INJ, 'utf8')); fs.unlinkSync(INJ); applyPatch(p, true); return; } catch (e) { console.error('inject', e); } }
  // timer
  if (local.timer && now >= local.timer.endsAt) {
    const id = local.timer.taskId; local.timer = null; saveLocal();
    applyPatch(Engine.opComplete(id, 'full', local.deviceId, now, state), true);
    notify('✅ Timer done', (rec(id).title || 'Task') + ' counts as done.');
    return;
  }
  const r = Engine.compute(state, now);
  // reminders
  const rem = Engine.dueReminders(state, local.lastCheck || now - 60000, now);
  local.lastCheck = now; saveLocalSoon();
  rem.forEach((x) => {
    const it = x.item;
    const when = !it.hasDue ? 'no deadline' : it.status === 'late' ? (it.dueToday ? 'late since ' + hm(it.due) : 'overdue since ' + it.deadlineDay) : it.future ? 'due ' + it.deadlineDay + ' ' + hm(it.due) : 'due ' + hm(it.due);
    notify(`${it.task.emoji || '⏰'} ${it.task.title}`, (it.task.desc ? Engine.plainNote(it.task.desc).trim() + '\n' : '') + `Time for this · ${when}`);
    if (x.popup && !r.lock) showPopup(it.id);
  });
  // event reminders (Nudge = notification, Nag = pop-up too)
  Engine.eventReminders(Object.assign({}, state, { gev }), local.lastCheckEv || now - 60000, now).forEach((h) => {
    const e = (state.events || {})[h.id] || gev[h.id] || {};
    notify(`📅 ${h.title}`, (e.desc ? Engine.plainNote(String(e.desc).replace(/<[^>]+>/g, ' ')).trim().slice(0, 200) + '\n' : '') + Engine.remWhen(h));
    if (h.popup && !r.lock) showPopup(h.key, 'evremind');
  });
  local.lastCheckEv = now;
  // deadline lock: Scaffold's window with the task and "I did it"; the lock's mode (Full Lock by default) handles the rest
  if (r.lock) showLockWin(); else hideLockWin();
  if (guard) guard.tick();
  keepAlive(!r.paused && (!!r.lock || !!Engine.activeMode(Object.assign({}, state, { gev }), now)));
  // reminder notes
  if (r.notes.length) showNoteWin(r.notes); else closeNoteWin();
  updateTray(r);
}
// Always-on (watchdog + OS job) only while a deadline lock or a restriction mode runs.
let kaOn = false, kaChild = null;
function keepAlive(on) {
  if (!KEEPALIVE_ON || on === kaOn) return;
  kaOn = on;
  if (on) {
    try { fs.writeFileSync(KA.guard, new Date().toISOString()); } catch (e) {}
    safe('keepalive', () => { kaChild = KeepAlive.startWatchdog(DATA); });
    if (app.isPackaged) safe('keepalive-os', () => KeepAlive.installOsJob(DATA));
  } else {
    try { fs.unlinkSync(KA.guard); } catch (e) {}
    if (kaChild) { try { process.kill(kaChild.pid); } catch (e) {} kaChild = null; }
    if (app.isPackaged) safe('keepalive-os', () => KeepAlive.removeOsJob());
  }
}
function hm(t) { const d = new Date(t); return Engine.pad(d.getHours()) + ':' + Engine.pad(d.getMinutes()); }

function notify(title, body) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, silent: false });
  n.on('click', showMain);
  n.show();
}

// ---------- windows ----------
function webPrefs() { return { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }; }
function loadUI(win, mode, task) { win.loadFile(UI, { query: { mode: mode || 'main', task: task || '' } }); }

function showMain() {
  if (mainWin && !mainWin.isDestroyed()) { mainWin.show(); mainWin.focus(); return; }
  mainWin = new BrowserWindow({ width: 980, height: 760, minWidth: 380, minHeight: 520, backgroundColor: '#0f1117', title: 'Scaffold', autoHideMenuBar: true, webPreferences: webPrefs() });
  loadUI(mainWin, 'main');
  mainWin.once('ready-to-show', () => { mainWin.maximize(); mainWin.show(); mainWin.focus(); try { app.focus({ steal: true }); } catch (e) {} });
  mainWin.on('closed', () => { mainWin = null; });
}

function showPopup(taskId, mode) {
  mode = mode || 'remind';
  if (popupWin && !popupWin.isDestroyed()) { loadUI(popupWin, mode, taskId); popupWin.show(); popupWin.focus(); return; }
  const d = screen.getPrimaryDisplay().workArea;
  popupWin = new BrowserWindow({ width: 440, height: 460, x: Math.round(d.x + (d.width - 440) / 2), y: Math.round(d.y + (d.height - 460) / 2), frame: false, resizable: false, alwaysOnTop: true, skipTaskbar: true, backgroundColor: '#0f1117', show: false, webPreferences: webPrefs() });
  popupWin.setAlwaysOnTop(true, 'floating');
  popupWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  loadUI(popupWin, mode, taskId);
  popupWin.once('ready-to-show', () => { popupWin.show(); popupWin.focus(); });
  popupWin.on('closed', () => { popupWin = null; });
}

function showNoteWin(notes) {
  const key = notes.map((n) => n.id + n.since).join();
  if (noteWin && !noteWin.isDestroyed()) {
    noteWin.moveTop();
    if (noteWin.noteKey !== key) { noteWin.noteKey = key; noteWin.webContents.send('native'); }
    return;
  }
  notify('📌 ' + Engine.plainNote(notes[0].note.text).split('\n')[0].slice(0, 60), 'Note · tap “Got it” when you have read it');
  const d = screen.getPrimaryDisplay().workArea;
  noteWin = new BrowserWindow({ width: 560, height: 440, x: Math.round(d.x + (d.width - 560) / 2), y: Math.round(d.y + (d.height - 440) / 2), frame: false, resizable: false, minimizable: false, alwaysOnTop: true, skipTaskbar: false, backgroundColor: '#0f1117', show: false, webPreferences: webPrefs() });
  noteWin.noteKey = key;
  noteWin.setAlwaysOnTop(true, 'screen-saver');
  noteWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  noteWin.on('close', (e) => { if (!noteWin.allowClose && Engine.pendingNotes(state, Date.now()).length) e.preventDefault(); });
  loadUI(noteWin, 'note');
  noteWin.once('ready-to-show', () => { noteWin.show(); noteWin.focus(); });
  noteWin.on('closed', () => { noteWin = null; });
}
function closeNoteWin() { if (noteWin && !noteWin.isDestroyed()) { noteWin.allowClose = true; noteWin.destroy(); } noteWin = null; }

// ---------- Obsidian vault ----------
let vaultFiles = null, vaultWalking = false, vaultReading = false;
async function scanVault() {
  if (!Engine.devMode(state)) return;   // Obsidian is a dev-only feature (0.7)
  const vp = Vault.findVault(local.vaultPath || '');
  local.vault = { path: vp };
  if (!vp) { local.vault.status = local.vaultPath ? 'not an Obsidian vault (no .obsidian folder)' : 'vault not found: set the folder below'; notifyUI(); return; }
  try {
    const now = Date.now();
    if (!vaultFiles || vaultFiles.root !== vp || now - vaultFiles.at > 30 * 60000) {
      if (vaultWalking) return;
      vaultWalking = true;
      if (!vaultFiles) { local.vault.status = 'looking for projects… (about a minute on Google Drive)'; notifyUI(); }
      try { vaultFiles = { root: vp, at: now, list: await Vault.listProjectFilesAsync(vp) }; } finally { vaultWalking = false; }
    }
    if (vaultReading) return;
    vaultReading = true;
    let res;
    try { res = await Vault.scan(vp, local.deviceId, now, vaultFiles.list); } finally { vaultReading = false; }
    const { records, sig } = res;
    const projects = Object.keys(records).filter((k) => records[k].name).length;
    local.vault.status = `${projects} active project${projects === 1 ? '' : 's'} · checked ${new Date().toTimeString().slice(0, 5)}`;
    if (sig !== local.vaultSig) {
      const patch = { vault: Object.assign({}, records, Vault.removed(state.vault, records, local.deviceId, now)) };
      local.vaultSig = sig; saveLocal();
      applyPatch(patch, true);
    }
  } catch (e) { local.vault.status = 'error: ' + e.message; }
  notifyUI();
}
// A finished task that came from the vault ticks its Development item there.
function tickVault(patch) {
  const vp = Vault.findVault(local.vaultPath || '');
  if (!vp || !patch.comps) return;
  Object.keys(patch.comps).forEach((k) => {
    const c = state.comps[k], id = k.split('@')[0], t = (state.todos || {})[id];
    if (!c || c.undone || !t || !t.vault || !t.vault.path || local.ticked[k]) return;
    local.ticked[k] = 1; saveLocal();
    try { if (Vault.tick(vp, t.vault.path, t.vault.item)) { notify('🗂️ Ticked in Obsidian', t.vault.item); setTimeout(scanVault, 3000); } } catch (e) { console.error('tick', e); }
  });
}

// ---------- Google Calendar ----------
let calBusy = false, calT = null;
function calSoon() { if (!relayCfg()) return; clearTimeout(calT); calT = setTimeout(runCal, 15000); }
let lastPull = 0;
async function runCal() {
  if (calBusy) return;
  const cfg = relayCfg(), g = Engine.google(state);
  if (!cfg) { if (gev && gev._meta) { gev = {}; writeJSON(GEV_F, gev); notifyUI(); } return; }   // disconnected: Google's events go too
  // One device sends Scaffold's edits to Google: with the sign-in, the one Engine.gPusher picks; with the script, its computer.
  const pusher = g ? Engine.gPusher(state, Date.now()) === local.deviceId : !!local.calUrl;
  calBusy = true;
  try {
    if (pusher) {
      const r = await Calendar.syncOnce({ url: g ? 'google' : local.calUrl, secret: local.calSecret, state, gev, local, Engine, by: local.deviceId, apply: (p) => applyPatch(p, true) });
      gev = r.gev; local.cal = { status: r.status }; local.scriptV = r.v;
    } else if (Date.now() - lastPull > 2.5 * 60000) {   // others only read Google (a cheap "anything new?" check, every 3 minutes)
      lastPull = Date.now();
      const res = await Calendar.pull(cfg.url, cfg.secret, gev);
      gev = Calendar.toGev(res, state.todos || {}, gev); local.cal = { status: 'read ' + new Date().toTimeString().slice(0, 5) + ' · ' + Calendar.evCount(gev) + ' Google events' };
    }
    writeJSON(GEV_F, gev);
    if (g) fillGoogleEmail();
  } catch (e) {
    local.cal = { status: 'error: ' + e.message };
    if (!pusher) { lastPull = 0; clearTimeout(calT); calT = setTimeout(runCal, 30000 + Math.random() * 30000); }   // e.g. the script was busy: try again soon
  }
  calBusy = false; saveLocal(); notifyUI();
}

// ---------- deadline lock and restriction modes ----------
function centerBox(w, h, top) { const d = screen.getPrimaryDisplay().workArea; return { width: w, height: h, x: Math.round(d.x + (d.width - w) / 2), y: Math.round(d.y + (top != null ? top : (d.height - h) / 2)) }; }
function showLockWin() {
  if (lockWin && !lockWin.isDestroyed()) { if (!lockWin.isVisible()) lockWin.show(); lockWin.moveTop(); return; }
  if (popupWin && !popupWin.isDestroyed()) popupWin.close();
  lockWin = new BrowserWindow(Object.assign(centerBox(520, 600), { frame: false, resizable: false, minimizable: false, closable: false, alwaysOnTop: true, skipTaskbar: false, backgroundColor: '#0f1117', show: false, webPreferences: webPrefs() }));
  lockWin.setAlwaysOnTop(true, 'floating');
  lockWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  lockWin.on('close', (e) => { if (!lockWin.allowClose) e.preventDefault(); });
  loadUI(lockWin, 'block');
  lockWin.once('ready-to-show', () => { lockWin.show(); lockWin.focus(); });
  lockWin.on('closed', () => { lockWin = null; });
}
function hideLockWin() { if (lockWin && !lockWin.isDestroyed()) { lockWin.allowClose = true; lockWin.destroy(); } lockWin = null; }
function hideOverlay() { hideLockWin(); }
const guardUI = {
  // "X is blocked by Y Mode": a small pop-up at the top for a few seconds.
  blocked(name, mode, forced) {
    if (blockedWin && !blockedWin.isDestroyed()) blockedWin.destroy();
    const html = '<body style="margin:0;background:#1c2030;color:#eef0f7;font:15px -apple-system,Segoe UI,sans-serif;display:flex;align-items:center;gap:12px;padding:0 18px;height:100vh;box-sizing:border-box;border-left:4px solid #ff7a90">' +
      '<span style="font-size:26px">🛡️</span><span><b>' + esc(name) + '</b> ' + (forced ? 'was closed: time is up for' : 'is blocked by') + ' <b>' + esc(mode) + ' Mode</b></span></body>';
    blockedWin = new BrowserWindow(Object.assign(centerBox(420, 70, 24), { frame: false, resizable: false, focusable: false, alwaysOnTop: true, skipTaskbar: true, backgroundColor: '#1c2030', show: false }));
    blockedWin.setAlwaysOnTop(true, 'screen-saver');
    blockedWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    blockedWin.once('ready-to-show', () => blockedWin && !blockedWin.isDestroyed() && blockedWin.showInactive());
    const w = blockedWin; setTimeout(() => { if (!w.isDestroyed()) w.destroy(); }, 4500);
  },
  // The "Close this Program" pop-up: one row per program.
  ask(list) {
    const h = Math.min(620, 150 + list.length * 96 + (list.length > 1 ? 64 : 0));
    if (closeWin && !closeWin.isDestroyed()) { closeWin.setSize(460, h); closeWin.webContents.send('native'); if (!closeWin.isVisible()) closeWin.show(); return; }
    closeWin = new BrowserWindow(Object.assign(centerBox(460, h), { frame: false, resizable: false, minimizable: false, closable: false, alwaysOnTop: true, skipTaskbar: false, backgroundColor: '#0f1117', show: false, webPreferences: webPrefs() }));
    closeWin.setAlwaysOnTop(true, 'floating');
    closeWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    closeWin.on('close', (e) => { if (!closeWin.allowClose) e.preventDefault(); });
    loadUI(closeWin, 'closeprog');
    closeWin.once('ready-to-show', () => { closeWin.show(); closeWin.focus(); });
    closeWin.on('closed', () => { closeWin = null; });
  },
  hideAsk() { if (closeWin && !closeWin.isDestroyed()) { closeWin.allowClose = true; closeWin.destroy(); } closeWin = null; },
  // A blocked website: a cover over the page (the tabs and the address bar stay free, so other tabs and search still work).
  cover(rect, mode, host) {
    if (!rect) { if (coverWin && !coverWin.isDestroyed()) coverWin.destroy(); coverWin = null; return; }
    const TOP = 86, b = { x: Math.round(rect.x), y: Math.round(rect.y + TOP), width: Math.max(200, Math.round(rect.width)), height: Math.max(120, Math.round(rect.height - TOP)) };
    const key = mode + '|' + host;
    if (coverWin && !coverWin.isDestroyed()) { coverWin.setBounds(b); if (coverWin.key !== key) { coverWin.key = key; coverWin.loadURL(coverHtml(mode, host)); } coverWin.moveTop(); return; }
    coverWin = new BrowserWindow(Object.assign(b, { frame: false, resizable: false, movable: false, focusable: false, alwaysOnTop: true, skipTaskbar: true, hasShadow: false, transparent: true, show: false }));
    coverWin.key = key;
    coverWin.setAlwaysOnTop(true, 'floating');
    coverWin.loadURL(coverHtml(mode, host));
    coverWin.once('ready-to-show', () => coverWin && !coverWin.isDestroyed() && coverWin.showInactive());
  }
};
function esc(t) { return String(t || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function coverHtml(mode, host) {
  return 'data:text/html;charset=utf-8,' + encodeURIComponent('<body style="margin:0;height:100vh;background:rgba(15,17,23,.94);color:#eef0f7;font:16px -apple-system,Segoe UI,sans-serif;display:grid;place-items:center;text-align:center">' +
    '<div><div style="font-size:44px">🧊</div><h2 style="margin:8px 0">' + esc(host) + ' is frozen</h2><div style="color:#9aa1b8">' + esc(mode) + ' Mode is on. The page stays here for later.<br>Switch tab, open a new one or search.</div></div></body>');
}
// This computer's installed programs, so any device can edit its lists (split in parts small enough for sync).
async function publishCatalog() {
  try {
    const apps = await Modes.catalog(), now = Date.now(), patch = { devs: {} }, base = local.deviceId, per = 40;
    const sig = JSON.stringify(apps) + local.deviceName;
    if (sig === local.catSig && now - (local.catAt || 0) < 7 * 86400e3) return;
    const parts = Math.max(1, Math.ceil(apps.length / per));
    for (let i = 0; i < parts; i++) {
      const r = { id: i ? base + '#' + i : base, part: i, apps: apps.slice(i * per, (i + 1) * per), ts: now, by: local.deviceId };
      if (!i) Object.assign(r, { name: local.deviceName, platform: process.platform === 'darwin' ? 'mac' : 'win', parts, hw: local.hw || undefined });
      patch.devs[r.id] = r;
    }
    Object.keys(state.devs || {}).forEach((k) => { const n = +(k.split('#')[1] || 0); if (k.split('#')[0] === base && n >= parts && !state.devs[k].del) patch.devs[k] = { id: k, del: true, ts: now, by: local.deviceId }; });
    local.catSig = sig; local.catAt = now; saveLocal();
    applyPatch(patch, true);
  } catch (e) { console.error('catalog', e); }
}

// "Still here": every 6 h, so other devices can show this one as inactive once it's gone (uninstalled, or off for days).
function heartbeat() {
  if (!local.syncCode || !local.deviceId) return;
  const id = local.deviceId + '#seen', r = { id, ts: Date.now(), by: local.deviceId };
  if (local.hw) r.hw = local.hw;
  applyPatch({ devs: { [id]: r } }, true);
}

function openWhatsApp() {
  if (waWin && !waWin.isDestroyed()) { waWin.show(); waWin.focus(); waWin.moveTop(); return; }
  waWin = new BrowserWindow({ width: 900, height: 720, title: 'WhatsApp', backgroundColor: '#111b21', webPreferences: { partition: 'persist:whatsapp', contextIsolation: true } });
  if (lockWin) waWin.setAlwaysOnTop(true, 'screen-saver');
  waWin.webContents.setUserAgent(CHROME_UA);
  waWin.loadURL('https://web.whatsapp.com/');
  waWin.on('closed', () => { waWin = null; });
}

// ---------- tray ----------
function updateTray(r) {
  if (!tray) return;
  r = r || Engine.compute(state, Date.now());
  const next = r.items.filter((i) => !i.done)[0];
  const title = r.paused ? 'OFF' : r.lock ? '🔒' : `${r.done}/${r.total}`;
  if (process.platform === 'darwin') tray.setTitle(' ' + title);
  tray.setToolTip(`Scaffold · ${r.paused ? 'stopped' : r.done + '/' + r.total + ' done today'}${next ? ' · next: ' + next.task.title : ''}`);
  const menu = Menu.buildFromTemplate([
    { label: r.paused ? 'Scaffold is OFF on all devices' : `${r.done} of ${r.total} done today`, enabled: false },
    ...(r.notes.length ? [{ label: `📌 ${r.notes.length} note${r.notes.length > 1 ? 's' : ''} waiting`, click: () => showNoteWin(r.notes) }] : []),
    ...(next && !r.paused ? [{ label: `Next: ${next.task.emoji || ''} ${next.task.title} (${hm(next.due)})`, enabled: false }] : []),
    { type: 'separator' },
    { label: 'Open Scaffold', click: showMain },
    { label: 'Open WhatsApp', click: openWhatsApp },
    { type: 'separator' },
    r.paused
      ? { label: '▶ Resume on all devices', click: () => applyPatch(Engine.opPause(false, local.deviceId, Date.now()), true) }
      : { label: '⛔ Emergency stop (all devices)', click: emergencyStop },
    { type: 'separator' },
    { label: 'Quit Scaffold on this computer', click: quitApp }
  ]);
  tray.setContextMenu(menu);
}

function emergencyStop() { applyPatch(Engine.opPause(true, local.deviceId, Date.now()), true); notify('⛔ Scaffold stopped', 'Every device is back to normal until you resume.'); }

function quitApp() {
  const choice = dialog.showMessageBoxSync({ type: 'question', buttons: ['Quit', 'Cancel'], defaultId: 1, message: 'Quit Scaffold on this computer?', detail: 'This computer stops reminding and locking. Other devices keep going. To free every device, use Emergency stop instead.' });
  if (choice !== 0) return;
  try { fs.writeFileSync(KA.quit, new Date().toISOString()); } catch (e) {}   // stays off until opened by hand
  if (!process.env.SCAFFOLD_DEV) try { app.setLoginItemSettings({ openAtLogin: false }); } catch (e) {}
  app.allowQuit = true; hideOverlay(); app.quit();
}

function trayIcon() {
  const f = process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png';
  const img = nativeImage.createFromPath(path.join(__dirname, 'assets', f));
  if (process.platform === 'darwin') img.setTemplateImage(true);
  return img;
}

// ---------- IPC for the UI ----------
ipcMain.on('get-state', (e) => { e.returnValue = JSON.stringify(Object.assign({}, state, { gev })); });
ipcMain.on('get-local', (e) => { e.returnValue = JSON.stringify(Object.assign({}, local, { platform: 'desktop', version: app.getVersion(), update: Object.assign({}, local.update, { running: !!updating && Date.now() - updating < UPD_LIMIT }) })); });
ipcMain.on('get-launch', (e) => {
  const u = new URL(e.sender.getURL()); e.returnValue = JSON.stringify({ mode: u.searchParams.get('mode') || 'main', task: u.searchParams.get('task') || '' });
});
ipcMain.on('apply', (e, p) => { try { applyPatch(JSON.parse(p), true); } catch (err) { console.error(err); } });
ipcMain.on('start-timer', (e, id, min) => { local.timer = { taskId: id, endsAt: Date.now() + min * 60000, minutes: min }; saveLocal(); notifyUI(); });
ipcMain.on('stop-timer', () => { local.timer = null; saveLocal(); evaluate(); notifyUI(); });
ipcMain.on('set-local', (e, k, v) => {
  if (!['syncCode', 'deviceName', 'blocklist', 'autostart', 'vaultPath', 'calUrl', 'deviceId'].includes(k)) return;
  local[k] = JSON.parse(v); saveLocal();
  if (k === 'vaultPath') { local.vaultSig = ''; vaultFiles = null; scanVault(); }
  if (k === 'calUrl') { local.cal = { status: local.calUrl ? 'connecting…' : '' }; local.calMap = {}; runCal(); shareRelay(); }
  if (k === 'syncCode') { local.since = ''; startSync(); }
  if (k === 'deviceId') { local.catSig = ''; startSync(); setTimeout(publishCatalog, 5000); setTimeout(heartbeat, 6000); }
  if (k === 'autostart') setAutostart(local.autostart);
  notifyUI();
});
// "Sign in with Google": signin / cancel / signout. The result is shared with every device (cfg.google).
Calendar.setGoogle(GBridge.create({
  http: Gauth.http,
  token: async () => {
    const g = Engine.google(state); if (!g) throw new Error('not signed in to Google');
    try { const t = await Gauth.accessToken(g.rt); if (local.gsign && local.gsign.dead) { local.gsign = {}; notifyUI(); } return t; }
    catch (e) { if (e.dead) { local.gsign = { dead: true }; notifyUI(); throw new Error('Google sign-in expired: sign in again in Settings'); } throw e; }
  },
  expire: () => { const g = Engine.google(state); if (g) Gauth.expire(g.rt); }
}));
let googleH = null, emailTry = 0;
// The signed-in address, shown in Settings. Filled in by the device that signed in (again later if Google was slow).
async function fillGoogleEmail() {
  const g = Engine.google(state);
  if (!g || g.email || g.by !== local.deviceId || Date.now() - emailTry < 60000) return;
  emailTry = Date.now();
  try { const email = await googleEmail(); const cur = Engine.google(state); if (email && cur && cur.rt === g.rt) applyPatch(Engine.opPut('cfg', Object.assign({}, cur, { email }), local.deviceId, Date.now()), true); }
  catch (err) { console.error('google email', err.message); }
}
function googleEmail() { if (!googleH) googleH = GBridge.create({ http: Gauth.http, token: () => Gauth.accessToken(Engine.google(state).rt) }); return googleH.email(); }
ipcMain.on('google', async (e, what) => {
  if (what === 'cancel') return Gauth.cancel();
  if (what === 'signout') {
    const g = Engine.google(state);
    if (g) { applyPatch(Engine.opDel('cfg', g, local.deviceId, Date.now()), true); Gauth.revoke(g.rt); }
    local.gsign = {}; local.cal = { status: '' }; runCal(); notifyUI(); return;
  }
  if (what !== 'signin' || (local.gsign && local.gsign.busy)) return;
  local.gsign = { busy: true }; notifyUI();
  try {
    const r = await Gauth.signIn((u) => shell.openExternal(u));
    Gauth.seed(r.rt, r.at, r.exp);
    const rec = { id: 'google', rt: r.rt, email: '', at: Date.now() };
    applyPatch(Engine.opPut('cfg', rec, local.deviceId, Date.now()), true);
    fillGoogleEmail();
    local.gsign = {}; local.cal = { status: 'connecting…' }; lastPull = 0;
    if (mainWin && !mainWin.isDestroyed()) { mainWin.show(); mainWin.focus(); }
    runCal();
  } catch (err) { local.gsign = { err: err.message === 'cancelled' ? '' : err.message }; }
  notifyUI();
});
ipcMain.on('open-whatsapp', openWhatsApp);
ipcMain.on('close-window', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (!w || w === lockWin || w === closeWin) return;
  if (w === noteWin) { if (!Engine.pendingNotes(state, Date.now()).length) closeNoteWin(); return; }
  w.close();
});
function testRemind() {
  notify('🧪 Test reminder', 'Notifications work on this computer.');
  const r = Engine.compute(state, Date.now()), it = r.items.filter((i) => !i.done)[0];
  if (it) showPopup(it.id);
}
ipcMain.on('guard', (e, what, id) => { if (guard) guard.action(what, id); });
ipcMain.on('test', (e, k) => { if (k === 'remind') testRemind(); if (k === 'update') runUpdate(); });


// ---------- auto-update ----------
let pendingUpdate = null, updating = false;
function updateSafe() {
  const r = Engine.compute(state, Date.now());
  return !r.lock && !local.timer && !lockWin && !(closeWin && !closeWin.isDestroyed()) && !Object.keys(local.frozen || {}).length && !(noteWin && !noteWin.isDestroyed());
}
function applyPendingUpdate() {
  if (!pendingUpdate || !updateSafe()) return;
  const u = pendingUpdate; pendingUpdate = null;
  notify('⬆️ Updating Scaffold', 'Version ' + u.version + ' installs now. Back in a few seconds.');
  try { fs.writeFileSync(KA.updating, u.version); } catch (e) {}   // keep-alive: don't reopen while files are swapped
  Updater.install(u.file);
  setTimeout(() => { app.allowQuit = true; hideOverlay(); app.quit(); }, 1500);
}
let updRun = 0;
const UPD_LIMIT = 20 * 60000;   // hard cap on a whole check with download (stalls are already cut after 30 s)
async function runUpdate() {
  if (updating && Date.now() - updating < UPD_LIMIT) { notifyUI(); return; }   // already running: the button shows its progress
  if (!UPDATE_CFG.repo || (process.env.SCAFFOLD_DEV && !process.env.SCAFFOLD_UPDATE_TEST)) return;
  if (pendingUpdate) { local.update = { status: 'version ' + pendingUpdate.version + ' downloaded, installs when nothing is locked', checked: Date.now() }; notifyUI(); return applyPendingUpdate(); }
  const id = ++updRun; updating = Date.now();
  const set = (status) => { if (id === updRun) { local.update = { status, checked: Date.now() }; notifyUI(); } };
  set('checking…');
  let shown = -1;
  const timeout = new Promise((r) => setTimeout(() => r({ status: 'error: no answer from GitHub (network too slow or blocked)', timedOut: true }), UPD_LIMIT));
  const res = await Promise.race([timeout, Updater.check(UPDATE_CFG.repo, app.getVersion(), (v, f) => {
    const pct = Math.floor(f * 100);
    if (pct >= shown + 5 || pct === 100) { shown = pct; set('downloading version ' + v + ': ' + pct + '%'); }
  }, (v) => set('downloading version ' + v + ': 0%'), Engine.devMode(state))]);
  if (id !== updRun) return;
  updating = 0;
  set(res.status === 'ready' ? 'version ' + res.version + ' downloaded, installs when nothing is locked' : res.status);
  if (res.timedOut) updRun++;   // a late answer from the stuck check must not overwrite this
  saveLocal();
  if (res.status === 'ready') { pendingUpdate = res; applyPendingUpdate(); }
}
ipcMain.on('check-update', () => runUpdate());

function setAutostart(on) {
  if (process.env.SCAFFOLD_DEV) return;
  try { app.setLoginItemSettings({ openAtLogin: !!on, openAsHidden: true, args: ['--background'] }); } catch (e) {}
}

// ---------- app lifecycle ----------
app.on('second-instance', (e, argv) => { if (!(argv || []).includes('--background')) showMain(); });
app.on('render-process-gone', (e, wc) => { setTimeout(() => { try { if (!wc.isDestroyed()) wc.reload(); } catch (x) {} }, 1000); });   // a crashed window reloads itself
process.on('uncaughtException', (e) => { console.error('uncaught', e); });   // never die on a stray error
app.on('window-all-closed', (e) => { /* stay in the tray */ });
app.on('before-quit', () => { app.allowQuit = true; hideLockWin(); guardUI.hideAsk(); if (guard) guard.release(); });

app.whenReady().then(() => {
  // Each part starts on its own: one that fails must never stop locks or updates (0.4.0 lost both that way).
  const safe = (name, fn) => { try { fn(); } catch (e) { console.error('startup: ' + name + ' failed', e); } };
  // Updates first, so even a broken version can always replace itself.
  setTimeout(runUpdate, 60000);
  setInterval(runUpdate, 15 * 60000);
  setInterval(applyPendingUpdate, 60000);
  safe('dock', () => { if (process.platform === 'darwin' && app.dock) app.dock.hide(); });
  safe('menu', () => Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Scaffold', submenu: [{ label: 'Open Scaffold', click: showMain }, { label: 'Emergency stop', click: emergencyStop }] },
    { role: 'editMenu' }
  ])));
  loadAll();
  safe('tray', () => { tray = new Tray(trayIcon()); tray.on('click', () => { if (process.platform !== 'darwin') showMain(); }); });
  safe('shortcut', () => globalShortcut.register('CommandOrControl+Alt+Shift+K', emergencyStop));
  safe('autostart', () => setAutostart(local.autostart));
  if (KEEPALIVE_ON) {
    try { fs.unlinkSync(KA.guard); } catch (e) {}
    if (app.isPackaged) safe('keepalive-os', () => KeepAlive.removeOsJob());   // comes back only while a lock or mode runs (see keepAlive)
    powerMonitor.on('shutdown', () => { try { fs.writeFileSync(KA.updating, 'shutdown'); } catch (e) {} });   // logging out / shutting down: don't reopen
  }
  safe('window', () => { if (local.firstRun) { local.firstRun = false; saveLocal(); showMain(); } else if (process.argv.includes('--show')) showMain(); });
  safe('sync', startSync);
  safe('modes', () => {
    guard = Modes.Guard({ Engine, getState: () => Object.assign({}, state, { gev }), local, saveLocal, get deviceId() { return local.deviceId; }, ui: guardUI });
    const toDip = (r) => process.platform === 'win32' ? screen.screenToDipRect(null, r) : r;
    setInterval(() => safe('guard', () => guard.tick()), 2000);
    setInterval(() => safe('sites', () => guard.sites(toDip)), 1000);
    setTimeout(publishCatalog, 20000); setInterval(publishCatalog, 6 * 3600e3);
    setTimeout(heartbeat, 30000); setInterval(heartbeat, 6 * 3600e3);
  });
  setInterval(() => safe('evaluate', evaluate), 5000);
  safe('evaluate', () => { evaluate(); updateTray(); });
  setInterval(() => safe('snapshot', () => maybeSnapshot(false)), 15 * 60000);
  setTimeout(scanVault, 3000);
  setInterval(scanVault, 5 * 60000);
  setTimeout(runCal, 8000);
  setInterval(runCal, 3 * 60000);
  powerMonitor.on('resume', () => { safe('evaluate', evaluate); if (sync) { sync.stop(); safe('sync', startSync); } });
});
