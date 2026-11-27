// Auto-update for the desktop app: checks the GitHub repo's latest release, downloads this
// platform's package, checks its SHA-256 against SHA256SUMS.txt, and swaps it in after the app quits.
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');

// Macs with Apple chips (M1 and newer) and Intel Macs get their own package; Windows on ARM runs the x64 one.
const ASSET = process.platform === 'darwin' ? (process.arch === 'arm64' ? 'Scaffold-mac-arm64.zip' : 'Scaffold-mac-x64.zip') : 'Scaffold-win-x64.zip';

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
    req.setTimeout(30000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

// Big files go straight to disk and resume where they stopped: a slow or shaky link (GitHub ~0.5 MB/s here, with pauses)
// used to start the 120 MB package over from 0% after any 30 s pause, so it never finished.
function fetchTo(url, file, onProgress, redirects = 5) {
  return new Promise((resolve, reject) => {
    const have = fs.existsSync(file) ? fs.statSync(file).size : 0;
    const headers = { 'User-Agent': 'scaffold-updater', Accept: 'application/octet-stream' };
    if (have) headers.Range = 'bytes=' + have + '-';
    const req = https.get(url, { headers }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume(); return resolve(fetchTo(new URL(res.headers.location, url).toString(), file, onProgress, redirects - 1));
      }
      if (res.statusCode === 416) { res.resume(); return resolve(); }   // already complete
      if (res.statusCode !== 200 && res.statusCode !== 206) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const start = res.statusCode === 206 ? have : 0, total = start + (+res.headers['content-length'] || 0);
      const out = fs.createWriteStream(file, { flags: start ? 'a' : 'w' });
      let got = start;
      res.on('data', (c) => { got += c.length; if (onProgress && total) onProgress(got / total); });
      res.pipe(out);
      out.on('finish', () => (total && got < total ? reject(new Error('cut short')) : resolve()));
      res.on('error', (e) => { out.end(); reject(e); });
      res.on('aborted', () => { out.end(); reject(new Error('cut short')); });
    });
    req.setTimeout(30000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}
async function download(url, file, onProgress) {
  for (let i = 0; ; i++) {
    try { await fetchTo(url, file, onProgress); return; }
    catch (e) { if (i >= 30) throw e; await new Promise((r) => setTimeout(r, 3000)); }   // pick up where it stopped
  }
}
function sha256File(file) {
  return new Promise((resolve, reject) => { const h = crypto.createHash('sha256'); fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject); });
}

function newer(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0); }
  return false;
}

/** Latest version tag: github.com's own redirect (no API rate limit), with the API as a fallback. */
function latestTag(repo) {
  return new Promise((resolve) => {
    const req = https.get(`https://github.com/${repo}/releases/latest`, { headers: { 'User-Agent': 'scaffold-updater' } }, (res) => {
      res.resume();
      const loc = res.headers.location || '';
      resolve(loc.includes('/tag/') ? loc.slice(loc.lastIndexOf('/tag/') + 5).replace(/^v/, '') : null);
    });
    req.setTimeout(20000, () => req.destroy(new Error('timeout')));
    req.on('error', () => resolve(null));
  }).then(async (tag) => tag || String(JSON.parse((await get(`https://api.github.com/repos/${repo}/releases/latest`)).toString('utf8')).tag_name || '').replace(/^v/, ''));
}

/** The version testers get: the repo's stable.txt (the dev promotes a release there). */
async function stableTag(repo) {
  // 'none' = no tester release yet (stable.txt doesn't exist); null = couldn't check (stay put).
  try { const v = (await get(`https://raw.githubusercontent.com/${repo}/main/stable.txt`)).toString('utf8').trim().replace(/^v/, ''); return /^\d+\.\d+\.\d+$/.test(v) ? v : null; }
  catch (e) { return /HTTP 404/.test(e.message) ? 'none' : null; }
}

/** Returns { status, version?, file? }. status: 'up to date' | 'ready' | 'error: …'. onFound(version) fires as soon as a newer one is seen.
 *  dev = this is one of the dev's devices (every release); otherwise only the promoted stable version. */
async function check(repo, current, onProgress, onFound, dev) {
  try {
    let latest = dev ? 'none' : await stableTag(repo);
    if (latest === 'none') latest = await latestTag(repo);   // the dev's devices, or no tester release yet: every release
    if (!latest || !newer(latest, current)) return { status: 'up to date' };
    if (onFound) onFound(latest);
    const dl = `https://github.com/${repo}/releases/download/v${latest}/`;
    const want = ((await get(dl + 'SHA256SUMS.txt')).toString('utf8').split('\n').find((l) => l.trim().endsWith(ASSET)) || '').split(/\s+/)[0];
    if (!want) return { status: 'error: release ' + latest + ' has no ' + ASSET };
    const file = path.join(os.tmpdir(), `scaffold-update-${latest}-${ASSET}`), part = file + '.part';   // .part survives a failed check: the next one continues it
    if (!fs.existsSync(file)) { await download(dl + ASSET, part, onProgress && ((f) => onProgress(latest, f))); fs.renameSync(part, file); }
    if (want.toLowerCase() !== await sha256File(file)) { try { fs.unlinkSync(file); } catch (e) {} return { status: 'error: checksum mismatch for ' + latest }; }
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

module.exports = { check, install, newer, ASSET, _download: download };
