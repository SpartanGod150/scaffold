/* Obsidian link: lists the vault's active projects (with their open Development items) and ticks an item
   when its Scaffold task is finished. Only project files are read: a note named exactly like its folder. */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const SKIP = new Set(['.trash', '.obsidian', '.git', 'node_modules', '10.archive', '_system']);
const MAX_ITEMS = 60, PER_PART = 15;

function candidates() {
  const home = os.homedir(), out = [];
  try {
    const cs = path.join(home, 'Library', 'CloudStorage');
    fs.readdirSync(cs).filter((d) => d.startsWith('GoogleDrive')).forEach((d) => {
      ['My Drive', 'Meu Drive'].forEach((m) => out.push(path.join(cs, d, m, 'Second Brain')));
    });
  } catch (e) {}
  ['G:', 'H:', 'D:', 'E:'].forEach((dr) => ['My Drive', 'Meu Drive'].forEach((m) => out.push(dr + '\\' + m + '\\Second Brain')));
  out.push(path.join(home, 'Second Brain'), path.join(home, 'Documents', 'Second Brain'), path.join(home, 'Sync', 'Second Brain'));
  return out;
}

function findVault(preferred) {
  const list = preferred ? [preferred] : candidates();
  for (const p of list) { try { if (fs.existsSync(path.join(p, '.obsidian'))) return p; } catch (e) {} }
  return '';
}

function frontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? m[1] : '';
}

function parseProject(text) {
  const fm = frontmatter(text);
  if (!/tags:\s*\[[^\]]*\bProject\b/.test(fm) && !/tags:\s*\n(\s*-\s*\w+\s*\n)*\s*-\s*Project\b/.test(fm)) return null;
  const status = (fm.match(/^status:\s*"?(\w+)/m) || [])[1];
  if (status !== 'active') return null;
  const name = ((fm.match(/^project_name:\s*"?([^"\n]+)"?/m) || [])[1] || '').trim();
  const desc = ((fm.match(/^description:\s*"?([^"\n]+)"?/m) || [])[1] || '').trim();
  const items = [];
  const lines = text.split(/\r?\n/);
  let inDev = false;
  for (const line of lines) {
    if (/^##\s/.test(line)) { inDev = /^##\s+Development\s*$/.test(line.trim()); continue; }
    if (!inDev) continue;
    const m = line.match(/^\s*- \[ \] (.+)$/);
    if (m) items.push(m[1].trim());
  }
  return { name, desc, items };
}

function walk(dir, depth, out) {
  if (depth > 6) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.') || SKIP.has(e.name)) continue;
    const sub = path.join(dir, e.name), file = path.join(sub, e.name + '.md');
    if (fs.existsSync(file)) out.push(file);
    walk(sub, depth + 1, out);
  }
}

function keyFor(rel) { return 'v' + crypto.createHash('sha1').update(rel.replace(/\\/g, '/')).digest('hex').slice(0, 10); }

// Returns { records, sig } where records is the vault map to publish.
function listProjectFiles(vaultPath) { const files = []; walk(vaultPath, 0, files); return files; }

// Same as listProjectFiles, without blocking the app (folder listings on Google Drive are slow).
async function listProjectFilesAsync(vaultPath) {
  const out = [], fsp = fs.promises;
  async function go(dir, depth) {
    if (depth > 6) return;
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || SKIP.has(e.name)) continue;
      const sub = path.join(dir, e.name), file = path.join(sub, e.name + '.md');
      try { await fsp.access(file); out.push(file); } catch (x) {}
      await go(sub, depth + 1);
    }
  }
  await go(vaultPath, 0);
  return out;
}

// Reads run in the background: on Google Drive a read can wait for a download.
async function scan(vaultPath, by, now, files) {
  files = files || await listProjectFilesAsync(vaultPath);
  const records = {};
  for (const f of files) {
    let text;
    try { text = await fs.promises.readFile(f, 'utf8'); } catch (e) { continue; }
    const p = parseProject(text);
    if (!p) continue;
    const rel = path.relative(vaultPath, f).replace(/\\/g, '/');
    const key = keyFor(rel), items = p.items.slice(0, MAX_ITEMS);
    const parts = Math.max(1, Math.ceil(items.length / PER_PART));
    for (let i = 0; i < parts; i++) {
      const r = { part: i, items: items.slice(i * PER_PART, (i + 1) * PER_PART) };
      if (i === 0) Object.assign(r, { name: p.name || path.basename(f, '.md'), path: rel, desc: p.desc.slice(0, 160), total: p.items.length });
      records[i === 0 ? key : key + '#' + i] = r;
    }
  }
  const sig = crypto.createHash('sha1').update(JSON.stringify(records)).digest('hex');
  Object.keys(records).forEach((k) => { records[k].ts = now; records[k].by = by; });
  return { records, sig };
}

// Records that were published before but are gone now (project finished, renamed...) get deleted.
function removed(oldState, records, by, now) {
  const out = {};
  Object.keys(oldState || {}).forEach((k) => { if (!records[k] && !oldState[k].del) out[k] = { del: true, ts: now, by }; });
  return out;
}

// Ticks "- [ ] item" into "- [x] item" in the project file. Returns true if the file changed.
function tick(vaultPath, rel, item) {
  const f = path.join(vaultPath, rel);
  let text;
  try { text = fs.readFileSync(f, 'utf8'); } catch (e) { return false; }
  const lines = text.split('\n');
  const i = lines.findIndex((l) => l.replace(/\r$/, '').replace(/^(\s*)- \[ \] /, '$1- [ ] ').trim() === ('- [ ] ' + item).trim());
  if (i < 0) return false;
  lines[i] = lines[i].replace('- [ ] ', '- [x] ');
  fs.writeFileSync(f, lines.join('\n'));
  return true;
}

module.exports = { findVault, scan, removed, tick, parseProject, listProjectFiles, listProjectFilesAsync };
