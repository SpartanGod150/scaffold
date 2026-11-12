// Auto-update for the desktop app: checks the GitHub repo's latest release, downloads this
// platform's package, checks its SHA-256 against SHA256SUMS.txt, and swaps it in after the app quits.
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');

const ASSET = process.platform === 'darwin' ? 'Scaffold-mac-arm64.zip' : 'Scaffold-win-x64.zip';

function get(url, redirects = 5, onProgress) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'scaffold-updater', Accept: 'application/octet-stream, application/json' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume(); return resolve(get(new URL(res.headers.location, url).toString(), redirects - 1, onProgress));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode + ' for ' + url)); }
      const chunks = [], total = +res.headers['content-length'] || 0; let got = 0;
      res.on('data', (c) => { chunks.push(c); got += c.length; if (onProgress && total) onProgress(got / total); }); res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.setTimeout(120000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

function newer(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0); }
  return false;
}

/** Returns { status, version?, file? }. status: 'up to date' | 'ready' | 'error: …' */
async function check(repo, current, onProgress) {
  try {
    const rel = JSON.parse((await get(`https://api.github.com/repos/${repo}/releases/latest`)).toString('utf8'));
    const latest = String(rel.tag_name || '').replace(/^v/, '');
    if (!latest || !newer(latest, current)) return { status: 'up to date' };
    const asset = (rel.assets || []).find((a) => a.name === ASSET);
    const sums = (rel.assets || []).find((a) => a.name === 'SHA256SUMS.txt');
    if (!asset || !sums) return { status: 'error: release ' + latest + ' has no ' + ASSET };
    const want = ((await get(sums.browser_download_url)).toString('utf8').split('\n').find((l) => l.trim().endsWith(ASSET)) || '').split(/\s+/)[0];
    const data = await get(asset.browser_download_url, 5, onProgress && ((f) => onProgress(latest, f)));
    const got = crypto.createHash('sha256').update(data).digest('hex');
    if (!want || want.toLowerCase() !== got) return { status: 'error: checksum mismatch for ' + latest };
    const file = path.join(os.tmpdir(), `scaffold-update-${latest}-${ASSET}`);
    fs.writeFileSync(file, data);
    return { status: 'ready', version: latest, file };
  } catch (e) { return { status: 'error: ' + e.message }; }
}

/** Starts a detached helper that waits for this process to exit, installs the package and relaunches. */
function install(file) {
  const pid = process.pid;
  if (process.platform === 'win32') {
    const dir = path.dirname(process.execPath), exe = process.execPath;
    const tmp = path.join(os.tmpdir(), 'scaffold-update-x');
    const ps = path.join(os.tmpdir(), 'scaffold-update.ps1');
    fs.writeFileSync(ps, [
      `$ErrorActionPreference = 'Stop'`,
      `try { Wait-Process -Id ${pid} -Timeout 60 -ErrorAction SilentlyContinue } catch {}`,
      `Start-Sleep 1`,
      `if (Test-Path '${tmp}') { Remove-Item '${tmp}' -Recurse -Force }`,
      `Expand-Archive -Path '${file}' -DestinationPath '${tmp}' -Force`,
      `robocopy '${tmp}' '${dir}' /MIR /R:5 /W:1 /NFL /NDL /NJH /NJS | Out-Null`,
      `Remove-Item '${tmp}' -Recurse -Force; Remove-Item '${file}' -Force`,
      `Start-Process '${exe}'`,
      `schtasks /Delete /TN ScaffoldUpdate /F | Out-Null`
    ].join('\r\n'), 'utf8');
    // Run the helper through Task Scheduler: a child process would be killed together with the app.
    const cmd = `powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${ps}"`;
    try {
      execFileSync('schtasks', ['/Create', '/TN', 'ScaffoldUpdate', '/TR', cmd, '/SC', 'ONCE', '/ST', '23:59', '/F'], { windowsHide: true, stdio: 'ignore' });
      execFileSync('schtasks', ['/Run', '/TN', 'ScaffoldUpdate'], { windowsHide: true, stdio: 'ignore' });
    } catch (e) {
      spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', ps], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    }
  } else {
    const bundle = path.resolve(process.execPath, '..', '..', '..');   // …/Scaffold.app
    const tmp = path.join(os.tmpdir(), 'scaffold-update-x');
    const sh = path.join(os.tmpdir(), 'scaffold-update.sh');
    const q = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
    fs.writeFileSync(sh, [
      '#!/bin/sh',
      `while kill -0 ${pid} 2>/dev/null; do sleep 0.5; done`,
      `rm -rf ${q(tmp)} && mkdir -p ${q(tmp)} && ditto -x -k ${q(file)} ${q(tmp)} || exit 1`,
      `[ -d ${q(tmp + '/Scaffold.app')} ] || exit 1`,
      `rm -rf ${q(bundle + '.old')}; mv ${q(bundle)} ${q(bundle + '.old')} && mv ${q(tmp + '/Scaffold.app')} ${q(bundle)} || mv ${q(bundle + '.old')} ${q(bundle)}`,
      `xattr -dr com.apple.quarantine ${q(bundle)} 2>/dev/null`,
      `rm -rf ${q(bundle + '.old')} ${q(tmp)} ${q(file)}`,
      `open ${q(bundle)}`
    ].join('\n'), { mode: 0o755 });
    spawn('/bin/sh', [sh], { detached: true, stdio: 'ignore' }).unref();
  }
}

module.exports = { check, install, newer, ASSET };
