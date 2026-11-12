/* Scaffold desktop (Mac + Windows): tray app that reminds, pops up, locks the screen and syncs with every other device. */
const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, screen, globalShortcut, nativeImage, dialog, shell, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Engine = require('./ui/engine.js');
const { Sync } = require('./sync.js');
const Blocker = require('./blocker.js');
const Vault = require('./vault.js');
const Calendar = require('./calendar.js');
const Updater = require('./updater.js');
const UPDATE_CFG = (() => { try { return require('./ui/update.json'); } catch (e) { return {}; } })();

if (process.env.SCAFFOLD_DEV) app.setPath('userData', app.getPath('userData') + '-dev');
if (!app.requestSingleInstanceLock()) { app.quit(); }

const UI = path.join(__dirname, 'ui', 'index.html');
const DATA = app.getPath('userData');
const STATE_F = path.join(DATA, 'state.json');
const LOCAL_F = path.join(DATA, 'local.json');
const STOP_F = path.join(DATA, 'STOP');           // creating this file triggers an emergency stop (escape hatch)
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

let state, local, tray, mainWin, popupWin, noteWin, waWin, overlays = [], sync = null, lastFocusKill = 0;

function readJSON(f, d) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } }
function writeJSON(f, v) { try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(f + '.tmp', JSON.stringify(v)); fs.renameSync(f + '.tmp', f); } catch (e) { console.error(e); } }
function saveState() { writeJSON(STATE_F, state); }
function saveLocal() { writeJSON(LOCAL_F, local); }
function E_MAPS_FIX() { Engine.MAPS.forEach((m) => { state[m] = state[m] || {}; }); }
function rec(id) { return (state.tasks || {})[id] || (state.todos || {})[id] || {}; }

function loadAll() {
  state = readJSON(STATE_F, Engine.emptyState());
  local = Object.assign({
    deviceId: (process.platform === 'darwin' ? 'mac-' : 'pc-') + crypto.randomBytes(4).toString('hex'),
    deviceName: process.platform === 'darwin' ? 'MacBook' : 'PC',
    syncCode: '', since: '', timer: null, blocklist: Blocker.DEFAULT_BLOCKLIST, autostart: true,
    lastCheck: Date.now(), lastSnapSeen: 0, firstRun: true,
    vaultPath: '', vaultSig: '', ticked: {}, calUrl: '', calSecret: crypto.randomBytes(18).toString('hex'), calMap: {}
  }, readJSON(LOCAL_F, {}));
  E_MAPS_FIX();
  saveLocal();
}

// ---------- state changes ----------
function applyPatch(patch, publish) {
  const tests = Object.keys(patch.log || {}).filter((k) => patch.log[k].type === 'test-remind' && !(state.log || {})[k] && patch.log[k].ts > Date.now() - 120000);
  const changed = Engine.merge(state, patch);
  if (tests.length) testRemind();
  const rel = Object.keys(patch.log || {}).some((k) => patch.log[k].type === 'release' && !(state.log || {})[k] && patch.log[k].ts > Date.now() - 3600e3 && Updater.newer(patch.log[k].v || '0', app.getVersion()));
  if (rel) setTimeout(runUpdate, 5000 + Math.random() * 20000);   // a new version was just released
  if (changed) saveState();
  if (publish && sync) sync.publish(Engine.chunks(patch), false);
  if (changed || publish) { evaluate(); notifyUI(); }
  if (changed) { tickVault(patch); if (patch.events || patch.todos) calSoon(); }
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
    relay: relayCfg,
    onScriptOld: (old) => { if (!!local.scriptOld !== old && local.calUrl) { local.scriptOld = old; saveLocalSoon(); notifyUI(); } },
    onBackupStart: () => maybeSnapshot(true)
  });
  sync.start();
  setTimeout(() => { shareRelay(); maybeSnapshot(true); }, 4000);
}
// Google backup mailbox (the calendar script): this computer's own link, else the one another device shared.
function relayCfg() {
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
    const when = it.nudge ? (it.status === 'late' ? 'overdue since ' + it.deadlineDay : 'due ' + it.deadlineDay + ' ' + hm(it.due)) : it.status === 'upcoming' ? 'starts ' + hm(it.start) : it.status === 'open' ? 'due ' + hm(it.due) : 'late since ' + hm(it.due);
    notify(`${it.task.emoji || '⏰'} ${it.task.title}`, `Time for this · ${when}`);
    if (x.popup && !(r.lock && it.task.desktop !== 'none')) showPopup(it.id);
  });
  // lock
  const lock = r.lock;
  const mode = lock ? (lock.task.desktop || 'lock') : 'none';
  if (mode === 'lock') showOverlay(); else hideOverlay();
  if (mode === 'focus' && now - lastFocusKill > 5000) {
    lastFocusKill = now;
    Blocker.closeDistractions(local.blocklist || [], (closed) => { if (closed.length) notify('🔒 Focus: ' + lock.task.title, 'Closed: ' + [...new Set(closed)].join(', ')); });
  }
  // reminder notes
  if (r.notes.length) showNoteWin(r.notes); else closeNoteWin();
  updateTray(r);
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
  mainWin.once('ready-to-show', () => { mainWin.show(); mainWin.focus(); try { app.focus({ steal: true }); } catch (e) {} });
  mainWin.on('closed', () => { mainWin = null; });
}

function showPopup(taskId) {
  if (popupWin && !popupWin.isDestroyed()) { loadUI(popupWin, 'remind', taskId); popupWin.show(); popupWin.focus(); return; }
  const d = screen.getPrimaryDisplay().workArea;
  popupWin = new BrowserWindow({ width: 440, height: 460, x: Math.round(d.x + (d.width - 440) / 2), y: Math.round(d.y + (d.height - 460) / 2), frame: false, resizable: false, alwaysOnTop: true, skipTaskbar: true, backgroundColor: '#0f1117', show: false, webPreferences: webPrefs() });
  popupWin.setAlwaysOnTop(true, 'floating');
  popupWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  loadUI(popupWin, 'remind', taskId);
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
  notify('📌 ' + notes[0].note.text.split('\n')[0].slice(0, 60), 'Note · tap “Got it” when you have read it');
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
function calSoon() { if (!local.calUrl) return; clearTimeout(calT); calT = setTimeout(runCal, 15000); }
async function runCal() {
  if (!local.calUrl || calBusy) return;
  calBusy = true;
  try {
    const status = await Calendar.syncOnce({ url: local.calUrl, secret: local.calSecret, state, local, Engine, by: local.deviceId, apply: (p) => applyPatch(p, true) });
    local.cal = { status };
  } catch (e) { local.cal = { status: 'error: ' + e.message }; }
  calBusy = false; saveLocal(); notifyUI();
}

function showOverlay() {
  if (overlays.length) { overlays.forEach((w) => { if (!w.isDestroyed()) w.moveTop(); }); if (waWin && !waWin.isDestroyed() && waWin.isVisible()) waWin.moveTop(); return; }
  if (popupWin && !popupWin.isDestroyed()) popupWin.close();
  screen.getAllDisplays().forEach((disp, i) => {
    const w = new BrowserWindow({ x: disp.bounds.x, y: disp.bounds.y, width: disp.bounds.width, height: disp.bounds.height, frame: false, resizable: false, movable: false, minimizable: false, closable: false, fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, backgroundColor: '#0f1117', show: false, webPreferences: webPrefs() });
    w.setAlwaysOnTop(true, 'pop-up-menu');
    w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    w.on('close', (e) => { if (!w.allowClose) e.preventDefault(); });
    if (i === 0) loadUI(w, 'block'); else w.loadURL('data:text/html,' + encodeURIComponent('<body style="background:#0f1117;color:#9aa1b8;font:20px sans-serif;display:grid;place-items:center;height:100vh;margin:0">🔒 Locked: see the main screen</body>'));
    w.once('ready-to-show', () => { w.show(); if (i === 0) w.focus(); });
    overlays.push(w);
  });
}
function hideOverlay() {
  if (!overlays.length) return;
  overlays.forEach((w) => { if (!w.isDestroyed()) { w.allowClose = true; w.destroy(); } });
  overlays = [];
  if (waWin && !waWin.isDestroyed()) waWin.setAlwaysOnTop(false);
}

function openWhatsApp() {
  if (waWin && !waWin.isDestroyed()) { waWin.show(); waWin.focus(); waWin.moveTop(); return; }
  waWin = new BrowserWindow({ width: 900, height: 720, title: 'WhatsApp', backgroundColor: '#111b21', webPreferences: { partition: 'persist:whatsapp', contextIsolation: true } });
  if (overlays.length) waWin.setAlwaysOnTop(true, 'screen-saver');
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
  app.allowQuit = true; hideOverlay(); app.quit();
}

function trayIcon() {
  const f = process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png';
  const img = nativeImage.createFromPath(path.join(__dirname, 'assets', f));
  if (process.platform === 'darwin') img.setTemplateImage(true);
  return img;
}

// ---------- IPC for the UI ----------
ipcMain.on('get-state', (e) => { e.returnValue = JSON.stringify(state); });
ipcMain.on('get-local', (e) => { e.returnValue = JSON.stringify(Object.assign({}, local, { platform: 'desktop', version: app.getVersion() })); });
ipcMain.on('get-launch', (e) => {
  const u = new URL(e.sender.getURL()); e.returnValue = JSON.stringify({ mode: u.searchParams.get('mode') || 'main', task: u.searchParams.get('task') || '' });
});
ipcMain.on('apply', (e, p) => { try { applyPatch(JSON.parse(p), true); } catch (err) { console.error(err); } });
ipcMain.on('start-timer', (e, id, min) => { local.timer = { taskId: id, endsAt: Date.now() + min * 60000, minutes: min }; saveLocal(); notifyUI(); });
ipcMain.on('stop-timer', () => { local.timer = null; saveLocal(); evaluate(); notifyUI(); });
ipcMain.on('set-local', (e, k, v) => {
  if (!['syncCode', 'deviceName', 'blocklist', 'autostart', 'vaultPath', 'calUrl'].includes(k)) return;
  local[k] = JSON.parse(v); saveLocal();
  if (k === 'vaultPath') { local.vaultSig = ''; vaultFiles = null; scanVault(); }
  if (k === 'calUrl') { local.cal = { status: local.calUrl ? 'connecting…' : '' }; local.calMap = {}; runCal(); shareRelay(); }
  if (k === 'syncCode') { local.since = ''; startSync(); }
  if (k === 'autostart') setAutostart(local.autostart);
  notifyUI();
});
ipcMain.on('open-whatsapp', openWhatsApp);
ipcMain.on('close-window', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (!w || overlays.includes(w)) return;
  if (w === noteWin) { if (!Engine.pendingNotes(state, Date.now()).length) closeNoteWin(); return; }
  w.close();
});
function testRemind() {
  notify('🧪 Test reminder', 'Notifications work on this computer.');
  const r = Engine.compute(state, Date.now()), it = r.items.filter((i) => !i.done)[0];
  if (it) showPopup(it.id);
}
ipcMain.on('test', (e, k) => { if (k === 'remind') testRemind(); if (k === 'update') runUpdate(); });


// ---------- auto-update ----------
let pendingUpdate = null, updating = false;
function updateSafe() {
  const r = Engine.compute(state, Date.now());
  return !r.lock && !local.timer && !overlays.length && !(noteWin && !noteWin.isDestroyed());
}
function applyPendingUpdate() {
  if (!pendingUpdate || !updateSafe()) return;
  const u = pendingUpdate; pendingUpdate = null;
  notify('⬆️ Updating Scaffold', 'Version ' + u.version + ' installs now. Back in a few seconds.');
  Updater.install(u.file);
  setTimeout(() => { app.allowQuit = true; hideOverlay(); app.quit(); }, 1500);
}
async function runUpdate() {
  if (updating) { notifyUI(); return; }   // already running: the status line shows its progress
  if (!UPDATE_CFG.repo || (process.env.SCAFFOLD_DEV && !process.env.SCAFFOLD_UPDATE_TEST)) return;
  if (pendingUpdate) { local.update = { status: 'version ' + pendingUpdate.version + ' downloaded, installs when nothing is locked', checked: Date.now() }; notifyUI(); return applyPendingUpdate(); }
  updating = true;
  local.update = { status: 'checking…', checked: Date.now() }; notifyUI();
  let shown = -1;
  const res = await Updater.check(UPDATE_CFG.repo, app.getVersion(), (v, f) => {
    const pct = Math.floor(f * 100);
    if (pct >= shown + 5 || pct === 100) { shown = pct; local.update = { status: 'downloading version ' + v + ': ' + pct + '%', checked: Date.now() }; notifyUI(); }
  });
  updating = false;
  local.update = { status: res.status === 'ready' ? 'version ' + res.version + ' downloaded, installs when nothing is locked' : res.status, checked: Date.now() };
  saveLocal(); notifyUI();
  if (res.status === 'ready') { pendingUpdate = res; applyPendingUpdate(); }
}
ipcMain.on('check-update', () => runUpdate());

function setAutostart(on) {
  if (process.env.SCAFFOLD_DEV) return;
  try { app.setLoginItemSettings({ openAtLogin: !!on, openAsHidden: true }); } catch (e) {}
}

// ---------- app lifecycle ----------
app.on('second-instance', showMain);
app.on('window-all-closed', (e) => { /* stay in the tray */ });
app.on('before-quit', () => { app.allowQuit = true; overlays.forEach((w) => { if (!w.isDestroyed()) { w.allowClose = true; w.destroy(); } }); });

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) app.dock.hide();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Scaffold', submenu: [{ label: 'Open Scaffold', click: showMain }, { label: 'Emergency stop', click: emergencyStop }] },
    { role: 'editMenu' }
  ]));
  loadAll();
  tray = new Tray(trayIcon());
  tray.on('click', () => { if (process.platform !== 'darwin') showMain(); });
  globalShortcut.register('CommandOrControl+Alt+Shift+K', emergencyStop);
  setAutostart(local.autostart);
  if (local.firstRun) { local.firstRun = false; saveLocal(); showMain(); }
  else if (process.argv.includes('--show')) showMain();
  startSync();
  evaluate(); updateTray();
  setInterval(evaluate, 5000);
  setInterval(() => maybeSnapshot(false), 15 * 60000);
  setTimeout(scanVault, 3000);
  setInterval(scanVault, 5 * 60000);
  setTimeout(runCal, 8000);
  setInterval(runCal, 3 * 60000);
  setTimeout(runUpdate, 60000);
  setInterval(runUpdate, 15 * 60000);
  setInterval(applyPendingUpdate, 60000);
  powerMonitor.on('resume', () => { evaluate(); if (sync) { sync.stop(); startSync(); } });
});
