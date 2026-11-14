/* Always on: Scaffold comes back by itself unless the user chose "Quit Scaffold".
   Three layers:
   1. A tiny watchdog process (this file, run as plain Node by the app's own binary) watches the app and reopens it
      within ~2 s after a crash, Force Quit or Task Manager "End task".
   2. An OS job (Mac LaunchAgent / Windows scheduled task) checks once a minute, in case both processes died.
   3. Login item: starts at login.
   Flags in the data folder: quit.flag (user quit: stay off until opened by hand), updating.flag (an update is
   swapping files: don't reopen for 3 min, the updater reopens it), main.pid (the running app). */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execFileSync } = require('child_process');

const UPDATE_GRACE = 180e3;

function flags(dir) {
  return { quit: path.join(dir, 'quit.flag'), updating: path.join(dir, 'updating.flag'), pid: path.join(dir, 'main.pid') };
}

// ---------- watchdog process (runs with ELECTRON_RUN_AS_NODE=1) ----------
function watchdogMain() {
  const cfg = JSON.parse(process.argv[2]);
  const F = flags(cfg.dir);
  process.on('SIGTERM', () => process.exit(0));   // logout / shutdown
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
  const t = setInterval(() => {
    if (alive(cfg.pid)) return;
    clearInterval(t);
    if (fs.existsSync(F.quit)) return process.exit(0);                       // the user quit
    try { if (Date.now() - fs.statSync(F.updating).mtimeMs < UPDATE_GRACE) return process.exit(0); } catch (e) {}   // updating: the updater reopens it
    setTimeout(() => {
      if (fs.existsSync(F.quit)) return process.exit(0);
      const env = Object.assign({}, process.env); delete env.ELECTRON_RUN_AS_NODE;
      spawn(cfg.exe, cfg.args, { cwd: cfg.cwd, env, detached: true, stdio: 'ignore' }).unref();
      setTimeout(() => process.exit(0), 500);
    }, 1500);
  }, 1000);
}

// ---------- called from the app ----------
/** Starts the watchdog for this app process. */
function startWatchdog(dir) {
  const F = flags(dir);
  fs.writeFileSync(F.pid, String(process.pid));
  const script = path.join(dir, 'keepalive-watchdog.js');
  fs.writeFileSync(script, fs.readFileSync(__filename));   // outside the app package, so plain Node can always read it
  const args = process.argv.slice(1).filter((a) => a !== '--show' && a !== '--background').concat('--background');
  const cfg = { pid: process.pid, dir, exe: process.execPath, args, cwd: process.cwd() };
  const env = Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' });
  const child = spawn(process.execPath, [script, JSON.stringify(cfg)], { env, detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  return child;
}

/** Mac LaunchAgent / Windows scheduled task: once a minute, reopen Scaffold if it isn't running (and wasn't quit). */
function installOsJob(dir) {
  const F = flags(dir);
  if (process.platform === 'darwin') {
    const bundle = path.resolve(process.execPath, '../../..');   // …/Scaffold.app
    if (!bundle.endsWith('.app')) return 'not an app bundle';
    const label = 'com.scaffold.keepalive';
    const sh = path.join(dir, 'keepalive.sh');
    const plist = path.join(os.homedir(), 'Library/LaunchAgents', label + '.plist');
    const q = (s) => "'" + s.replace(/'/g, "'\\''") + "'";
    fs.writeFileSync(sh, [
      '#!/bin/sh',
      '# Scaffold keep-alive: reopens Scaffold once a minute if it is not running and was not quit.',
      'D=' + q(dir), 'APP=' + q(bundle), 'PL=' + q(plist),
      '[ -d "$APP" ] || { rm -f "$PL"; launchctl bootout gui/$(id -u)/' + label + ' 2>/dev/null; exit 0; }   # app deleted: remove myself',
      '[ -f "$D/quit.flag" ] && exit 0',
      'if [ -f "$D/updating.flag" ] && [ $(( $(date +%s) - $(stat -f %m "$D/updating.flag") )) -lt 180 ]; then exit 0; fi',
      'P=$(cat "$D/main.pid" 2>/dev/null)',
      '[ -n "$P" ] && ps -p "$P" -o comm= 2>/dev/null | grep -q "Scaffold$" && exit 0',
      'open -g -a "$APP" --args --background',
      ''].join('\n'), { mode: 0o755 });
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array><string>/bin/sh</string><string>${sh.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</string></array>
  <key>StartInterval</key><integer>60</integer>
  <key>RunAtLoad</key><false/>
</dict></plist>
`;
    let old = ''; try { old = fs.readFileSync(plist, 'utf8'); } catch (e) {}
    if (old === xml) return 'ok';
    fs.mkdirSync(path.dirname(plist), { recursive: true });
    fs.writeFileSync(plist, xml);
    const uid = process.getuid();
    try { execFileSync('launchctl', ['bootout', `gui/${uid}/${label}`], { stdio: 'ignore' }); } catch (e) {}
    execFileSync('launchctl', ['bootstrap', `gui/${uid}`, plist], { stdio: 'ignore' });
    return 'installed';
  }
  if (process.platform === 'win32') {
    const exe = process.execPath, name = path.win32.basename(exe);
    const vbs = path.join(dir, 'keepalive.vbs');
    const v = (s) => s.replace(/"/g, '""');
    const body = [
      "' Scaffold keep-alive: reopens Scaffold once a minute if it is not running and was not quit.",
      'Set fso = CreateObject("Scripting.FileSystemObject")',
      `D = "${v(dir)}"`, `EXE = "${v(exe)}"`,
      'If Not fso.FileExists(EXE) Then WScript.Quit',
      'If fso.FileExists(D & "\\quit.flag") Then WScript.Quit',
      'If fso.FileExists(D & "\\updating.flag") Then',
      '  If DateDiff("s", fso.GetFile(D & "\\updating.flag").DateLastModified, Now) < 180 Then WScript.Quit',
      'End If',
      'P = ""',
      'If fso.FileExists(D & "\\main.pid") Then P = Trim(fso.OpenTextFile(D & "\\main.pid").ReadAll)',
      'If P <> "" And IsNumeric(P) Then',
      '  Set w = GetObject("winmgmts:\\\\.\\root\\cimv2")',
      `  If w.ExecQuery("select ProcessId from Win32_Process where ProcessId=" & P & " and Name='${name}'").Count > 0 Then WScript.Quit`,
      'End If',
      'CreateObject("WScript.Shell").Run """" & EXE & """ --background", 0, False',
      ''].join('\r\n');
    let old = ''; try { old = fs.readFileSync(vbs, 'utf8'); } catch (e) {}
    fs.writeFileSync(vbs, body);
    if (old === body) { try { execFileSync('schtasks', ['/Query', '/TN', 'ScaffoldKeepAlive'], { stdio: 'ignore' }); return 'ok'; } catch (e) {} }
    execFileSync('schtasks', ['/Create', '/F', '/SC', 'MINUTE', '/MO', '1', '/TN', 'ScaffoldKeepAlive', '/TR', `wscript.exe //B //Nologo "${vbs}"`], { stdio: 'ignore', windowsHide: true });
    return 'installed';
  }
  return 'unsupported';
}

module.exports = { flags, startWatchdog, installOsJob, UPDATE_GRACE };

if (require.main === module) watchdogMain();
