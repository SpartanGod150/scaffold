/* Restriction modes on computers.
   - A blocked program never gets to open: it is closed the moment it starts, with a small "blocked by X Mode" pop-up.
   - Programs already open when a mode starts get the "Close this Program" pop-up: Close Now, Give me 2 minutes (up to 3 times,
     then Scaffold closes it) or Freeze program instead (paused until the mode ends, nothing lost).
   - Websites in Opera / Opera GX: a blocked page is frozen under a cover (tabs, new tabs and search keep working).
   Only programs with windows count; the system's own (Finder, Explorer…) and Scaffold are never touched. */
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const MAC = process.platform === 'darwin';
const ALWAYS = MAC
  ? ['com.apple.finder', 'com.apple.systempreferences', 'com.apple.Preferences', 'com.apple.loginwindow', 'com.apple.dock', 'com.apple.SecurityAgent',
     'com.apple.controlcenter', 'com.apple.notificationcenterui', 'com.apple.Spotlight', 'com.apple.systemuiserver', 'com.scaffold.desktop', 'com.github.Electron']
  : ['explorer.exe', 'scaffold.exe', 'applicationframehost.exe', 'shellexperiencehost.exe', 'searchhost.exe', 'searchapp.exe', 'startmenuexperiencehost.exe',
     'textinputhost.exe', 'systemsettings.exe', 'lockapp.exe', 'electron.exe', 'dwm.exe', 'winlogon.exe', 'csrss.exe', 'taskmgr.exe',
     // Windows' own background parts (hidden windows): freezing one hangs clicks on the whole computer.
     'svchost.exe', 'conhost.exe', 'dllhost.exe', 'runtimebroker.exe', 'taskhostw.exe', 'sihost.exe', 'ctfmon.exe', 'fontdrvhost.exe', 'smss.exe',
     'services.exe', 'lsass.exe', 'wininit.exe', 'spoolsv.exe', 'audiodg.exe', 'wmiprvse.exe', 'unsecapp.exe', 'sapisvr.exe', 'searchindexer.exe',
     'securityhealthsystray.exe', 'securityhealthservice.exe', 'smartscreen.exe', 'filecoauth.exe', 'useroobebroker.exe', 'widgets.exe',
     'widgetservice.exe', 'phoneexperiencehost.exe', 'crossdeviceresume.exe', 'gamebarpresencewriter.exe', 'nvcontainer.exe',
     'nvdisplay.container.exe', 'msedgewebview2.exe', 'wfs.exe', 'tabtip.exe', 'mip.exe', 'consent.exe', 'werfault.exe', 'backgroundtaskhost.exe'];
// Unblockable until the user sets the list: the browser (websites are filtered inside it), WhatsApp and Scaffold.
const PRESET = MAC
  ? { apps: ['com.operasoftware.Opera', 'com.operasoftware.OperaGX', 'net.whatsapp.WhatsApp', 'desktop.WhatsApp', 'com.scaffold.desktop'], sites: ['web.whatsapp.com'] }
  : { apps: ['opera.exe', 'whatsapp.exe', 'scaffold.exe'], sites: ['web.whatsapp.com'] };
const OPERA_MAC = ['com.operasoftware.Opera', 'com.operasoftware.OperaGX'];
const WAIT_MS = 2 * 60000, MAX_WAITS = 3;

function run(cmd, args, opts) {
  return new Promise((res) => execFile(cmd, args, Object.assign({ windowsHide: true, maxBuffer: 16 << 20, timeout: 20000 }, opts || {}), (err, out) => res(err ? '' : String(out))));
}

// ---------- open programs (with windows) ----------
async function listOpen() {
  if (MAC) {
    const out = await run('lsappinfo', ['list']), apps = [];
    let cur = null;
    out.split('\n').forEach((l) => {
      const h = /^\s*\d+\) "(.*)" ASN:/.exec(l);
      if (h) { cur = { name: h[1] }; return; }
      if (!cur) return;
      const b = /bundleID="([^"]*)"/.exec(l); if (b) cur.id = b[1];
      const p = /pid = (\d+).*type="([^"]*)"/.exec(l);
      if (p) { cur.pid = +p[1]; if (p[2] === 'Foreground') apps.push({ id: cur.id || cur.name, name: cur.name, pid: cur.pid }); cur = null; }
    });
    return apps;
  }
  // Only programs with a window you can see (tasklist also counted hidden ones, so svchost, conhost… looked like open programs).
  const ps = "Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } | ForEach-Object { [Console]::Out.WriteLine($_.ProcessName + '|' + $_.Id + '|' + $_.MainWindowTitle) }";
  const out = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps]), apps = [];
  out.split(/\r?\n/).forEach((l) => {
    const m = /^(.+?)\|(\d+)\|(.*)$/.exec(l.trim()); if (!m) return;
    apps.push({ id: m[1].toLowerCase() + '.exe', name: m[1], pid: +m[2], title: m[3] });
  });
  return apps.filter((a) => !ALWAYS.includes(a.id));
}
function alive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }

// ---------- installed programs (published so any device can edit this computer's lists) ----------
async function catalog() {
  const out = {};
  if (MAC) {
    const dirs = ['/Applications', '/Applications/Utilities', '/System/Applications', '/System/Applications/Utilities', path.join(os.homedir(), 'Applications')];
    for (const d of dirs) {
      let list = []; try { list = fs.readdirSync(d).filter((f) => f.endsWith('.app')); } catch (e) {}
      for (const f of list) {
        const id = (await run('plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', path.join(d, f, 'Contents', 'Info.plist')])).trim();
        if (id && !ALWAYS.includes(id)) out[id] = f.replace(/\.app$/, '');
      }
    }
  } else {
    const ps = "$s=New-Object -ComObject WScript.Shell; $d=@([Environment]::GetFolderPath('CommonStartMenu'),[Environment]::GetFolderPath('StartMenu')); " +
      "Get-ChildItem -Path $d -Recurse -Filter *.lnk -ErrorAction SilentlyContinue | ForEach-Object { try { $t=$s.CreateShortcut($_.FullName).TargetPath; if ($t -like '*.exe') { [Console]::Out.WriteLine($_.BaseName + '|' + [IO.Path]::GetFileName($t)) } } catch {} }";
    (await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 60000 })).split(/\r?\n/).forEach((l) => {
      const i = l.lastIndexOf('|'); if (i < 0) return;
      const id = l.slice(i + 1).trim().toLowerCase(), label = l.slice(0, i).trim();
      if (id && !ALWAYS.includes(id) && !/uninstall|unins\d*\.exe/i.test(label + id) && !out[id]) out[id] = label;
    });
  }
  (await listOpen()).forEach((a) => { if (!ALWAYS.includes(a.id) && !out[a.id]) out[a.id] = a.name; });
  return Object.keys(out).map((id) => ({ id, label: out[id] })).sort((a, b) => a.label.localeCompare(b.label));
}

// ---------- closing and freezing ----------
function closeGently(pid) {
  if (MAC) { try { process.kill(pid, 'SIGTERM'); } catch (e) {} }
  else execFile('taskkill', ['/PID', String(pid)], { windowsHide: true }, () => {});
}
function closeHard(pid) {
  if (MAC) { try { process.kill(pid, 'SIGCONT'); process.kill(pid, 'SIGKILL'); } catch (e) {} }
  else execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {});
}
const WIN_SUSPEND = "$s=@'\nusing System;using System.Runtime.InteropServices;public class P{[DllImport(\"ntdll.dll\")]public static extern int NtSuspendProcess(IntPtr h);[DllImport(\"ntdll.dll\")]public static extern int NtResumeProcess(IntPtr h);}\n'@;Add-Type $s;";
function freeze(pid, on) {
  if (MAC) { try { process.kill(pid, on ? 'SIGSTOP' : 'SIGCONT'); } catch (e) {} return; }
  execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', WIN_SUSPEND + "try{$p=[Diagnostics.Process]::GetProcessById(" + (+pid) + ");[P]::" + (on ? 'NtSuspendProcess' : 'NtResumeProcess') + "($p.Handle)|Out-Null}catch{}"], { windowsHide: true }, () => {});
}

// ---------- the browser: which page is in front ----------
async function frontBrowser() {
  if (MAC) {
    const asn = (await run('lsappinfo', ['front'])).trim();
    const m = asn ? /="([^"]+)"/.exec(await run('lsappinfo', ['info', '-only', 'bundleid', asn])) : null;
    const id = m ? m[1] : '';
    if (!OPERA_MAC.includes(id)) return null;
    const out = await run('osascript', ['-e', 'tell application id "' + id + '" to if (count of windows) > 0 then return (URL of active tab of front window) & "\n" & ((bounds of front window) as text)'], { timeout: 4000 });
    const [url, b] = out.trim().split('\n');
    const n = (b || '').split(/,\s*/).map(Number);
    if (n.length < 4 || n.some(isNaN)) return { url: url || '', rect: null };
    return { url: url || '', rect: { x: n[0], y: n[1], width: n[2] - n[0], height: n[3] - n[1] } };
  }
  return winBrowser.latest && Date.now() - winBrowser.at < 4000 ? winBrowser.latest : null;
}
// Windows: one long-running PowerShell reads Opera GX's address bar (UI Automation) once a second.
const winBrowser = { proc: null, latest: null, at: 0 };
const WIN_WATCH = "Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes;" +
  "Add-Type @'\nusing System;using System.Runtime.InteropServices;public class W{[DllImport(\"user32.dll\")]public static extern IntPtr GetForegroundWindow();[DllImport(\"user32.dll\")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);[DllImport(\"user32.dll\")]public static extern bool GetWindowRect(IntPtr h,out RECT r);public struct RECT{public int L,T,R,B;}}\n'@;" +
  "$ec=New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ControlTypeProperty,[Windows.Automation.ControlType]::Edit);" +
  "while($true){$o=@{proc=''};try{$h=[W]::GetForegroundWindow();$q=[uint32]0;[W]::GetWindowThreadProcessId($h,[ref]$q)|Out-Null;$p=Get-Process -Id $q -ErrorAction SilentlyContinue;" +
  "if($p -and $p.ProcessName -match '^opera'){$r=New-Object W+RECT;[W]::GetWindowRect($h,[ref]$r)|Out-Null;$u='';$el=[Windows.Automation.AutomationElement]::FromHandle($h);$ed=$el.FindFirst([Windows.Automation.TreeScope]::Descendants,$ec);" +
  "if($ed){try{$u=$ed.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern).Current.Value}catch{}};$o=@{proc=$p.ProcessName;url=$u;x=$r.L;y=$r.T;w=$r.R-$r.L;h=$r.B-$r.T}}}catch{};" +
  "[Console]::Out.WriteLine(($o|ConvertTo-Json -Compress));[Console]::Out.Flush();Start-Sleep -Milliseconds 1000}";
function startWinWatch(toDip) {
  if (MAC || winBrowser.proc) return;
  const p = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', WIN_WATCH], { windowsHide: true });
  winBrowser.proc = p;
  let buf = '';
  p.stdout.on('data', (d) => {
    buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      try { const o = JSON.parse(line); winBrowser.at = Date.now(); winBrowser.latest = o.proc ? { url: o.url || '', rect: toDip({ x: o.x, y: o.y, width: o.w, height: o.h }) } : null; } catch (e) {}
    }
  });
  p.on('exit', () => { winBrowser.proc = null; });
}
function stopWinWatch() { if (winBrowser.proc) { try { winBrowser.proc.kill(); } catch (e) {} winBrowser.proc = null; winBrowser.latest = null; } }

/* The guard. o: { Engine, getState() (with gev), local, saveLocal(), deviceId, ui: { blocked(name, mode), ask(list, mode), hideAsk(), cover(rect | null, mode) } } */
function Guard(o) {
  const g = { key: '', pend: {}, busy: false, coverBusy: false, hold: 0 };   // hold: "Give me 2 minutes" for all programs, until then
  const sys = Object.assign({ listOpen, closeGently, closeHard, freeze, now: Date.now }, o.sys || {});   // o.sys: fakes for tests
  // Programs frozen by an earlier run (Scaffold restarted): let them go; the mode asks again.
  Object.keys(o.local.frozen || {}).forEach((pid) => sys.freeze(+pid, false));
  o.local.frozen = {};

  function act() { const s = o.getState(); return o.Engine.activeMode(s, sys.now()); }
  function blocked(a, id) { return !ALWAYS.includes(id) && o.Engine.appBlocked(o.getState(), a, o.deviceId, id, PRESET); }
  function askList() { return Object.keys(g.pend).filter((id) => g.pend[id].state === 'ask').map((id) => ({ id, name: g.pend[id].name, waits: g.pend[id].waits })); }
  function release() {
    Object.keys(o.local.frozen || {}).forEach((pid) => sys.freeze(+pid, false));
    o.local.frozen = {}; o.saveLocal();
    g.pend = {}; g.key = ''; g.hold = 0;
    o.ui.hideAsk(); o.ui.cover(null);
    o.local.guard = null;
  }

  g.tick = async function () {
    if (g.busy) return; g.busy = true;
    try {
      const a = act();
      if (!a) { if (g.key || Object.keys(o.local.frozen || {}).length) release(); return; }
      const key = a.mode.id + '|' + a.src + '|' + a.start, fresh = key !== g.key, now = sys.now(), mode = a.mode.name || 'this';
      const open = (await sys.listOpen()).filter((p) => p.pid !== process.pid);
      if (fresh) {   // a new mode: what it allows now comes back; what it blocks and is open gets asked
        Object.keys(o.local.frozen || {}).forEach((pid) => { const f = o.local.frozen[pid]; if (!blocked(a, f.id)) { sys.freeze(+pid, false); delete o.local.frozen[pid]; } });
        Object.keys(g.pend).forEach((id) => { if (!blocked(a, id)) delete g.pend[id]; });
        open.forEach((p) => { if (blocked(a, p.id) && !g.pend[p.id] && !o.local.frozen[p.pid]) g.pend[p.id] = { name: p.name, pids: [], waits: 0, state: 'ask', next: 0 }; });
        g.key = key; g.hold = 0; o.saveLocal();
      }
      const byId = {}, gone = {};
      open.forEach((p) => { (byId[p.id] = byId[p.id] || []).push(p); });
      Object.keys(g.pend).forEach((id) => {
        const e = g.pend[id];
        if (!byId[id]) { delete g.pend[id]; return; }   // closed by the user
        e.pids = byId[id].map((p) => p.pid);
        if (e.state === 'wait' && now >= e.next) {
          if (e.waits >= MAX_WAITS) { e.pids.forEach((pid) => { sys.closeHard(pid); gone[pid] = 1; }); delete g.pend[id]; o.ui.blocked(e.name, mode, true); return; }
          else e.state = 'ask';
        }
        if (e.state === 'closing' && now >= e.next) { e.pids.forEach((pid) => { sys.closeHard(pid); gone[pid] = 1; }); delete g.pend[id]; }
      });
      open.forEach((p) => {   // opened during the mode: it doesn't get to open
        if (gone[p.pid] || g.pend[p.id] || o.local.frozen[p.pid] || !blocked(a, p.id)) return;
        if (now < g.hold) { g.pend[p.id] = { name: p.name, pids: [p.pid], waits: 0, state: 'wait', next: g.hold }; return; }   // the whole block waits
        sys.closeHard(p.pid); o.ui.blocked(p.name, mode, false);
      });
      const ask = askList();
      o.local.guard = { mode, list: ask };
      if (ask.length) o.ui.ask(ask, mode); else o.ui.hideAsk();
    } catch (e) { console.error('guard', e); }
    finally { g.busy = false; }
  };

  // The pop-up's buttons.
  g.action = function (what, id) {
    const a = act(); if (!a) return;
    if (what === 'freezeAll' || what === 'waitAll') {   // every program in the pop-up at once
      const ids = Object.keys(g.pend).filter((k) => g.pend[k].state === 'ask');
      if (what === 'waitAll' && ids.some((k) => g.pend[k].waits >= MAX_WAITS)) return;
      if (what === 'waitAll') g.hold = sys.now() + WAIT_MS;
      ids.forEach((k) => g.action(what === 'waitAll' ? 'wait' : 'freeze', k));
      return;
    }
    const e = g.pend[id]; if (!e) return;
    if (what === 'close') { e.pids.forEach(sys.closeGently); e.state = 'closing'; e.next = sys.now() + 15000; }
    else if (what === 'wait') { if (e.waits >= MAX_WAITS) return; e.waits++; e.state = 'wait'; e.next = sys.now() + WAIT_MS; }
    else if (what === 'freeze') { e.pids.forEach((pid) => { sys.freeze(pid, true); o.local.frozen[pid] = { id, name: e.name }; }); delete g.pend[id]; o.saveLocal(); }
    const ask = askList();
    o.local.guard = { mode: a.mode.name, list: ask };
    if (ask.length) o.ui.ask(ask, a.mode.name); else o.ui.hideAsk();
  };

  // Websites: every second while a mode runs, check the page in front.
  g.sites = async function (toDip) {
    if (g.coverBusy) return; g.coverBusy = true;
    try {
      const a = act();
      if (!a) { stopWinWatch(); o.ui.cover(null); return; }
      startWinWatch(toDip);
      const b = await frontBrowser();
      if (b && b.rect && o.Engine.siteBlocked(o.getState(), a, o.deviceId, b.url, PRESET)) o.ui.cover(b.rect, a.mode.name || 'this', o.Engine.parseUrl(b.url).host);
      else o.ui.cover(null);
    } catch (e) { console.error('sites', e); }
    finally { g.coverBusy = false; }
  };
  g.release = release;
  return g;
}

module.exports = { Guard, catalog, listOpen, PRESET, ALWAYS };
