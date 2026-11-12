/* Closes distracting apps during "focus" locks. Never touches WhatsApp or Scaffold itself. */
const { execFile } = require('child_process');

const DEFAULT_BLOCKLIST = ['steam', 'discord', 'epicgameslauncher', 'battle.net', 'riotclient', 'leagueclient', 'robloxplayer'];
const NEVER = ['whatsapp', 'scaffold', 'electron'];

function list(cb) {
  if (process.platform === 'win32') {
    execFile('tasklist', ['/fo', 'csv', '/nh'], { windowsHide: true, maxBuffer: 8 << 20 }, (err, out) => {
      if (err) return cb([]);
      cb(out.split(/\r?\n/).map((l) => {
        const c = l.match(/"([^"]*)"/g); if (!c || c.length < 2) return null;
        return { pid: +c[1].replace(/"/g, ''), name: c[0].replace(/"/g, '').toLowerCase() };
      }).filter(Boolean));
    });
  } else {
    execFile('ps', ['-axo', 'pid=,comm='], { maxBuffer: 8 << 20 }, (err, out) => {
      if (err) return cb([]);
      cb(out.split('\n').map((l) => {
        const m = l.trim().match(/^(\d+)\s+(.*)$/); if (!m) return null;
        return { pid: +m[1], name: m[2].toLowerCase() };
      }).filter(Boolean));
    });
  }
}

function matches(name, blocklist) {
  if (NEVER.some((n) => name.includes(n))) return false;
  const base = name.split(/[\\/]/).pop().replace(/\.exe$/, '');
  return blocklist.some((b) => b && (base.includes(b) || name.includes('/' + b + '.app/') || name.includes(b + '.app')));
}

// Calls back with the names it closed.
function closeDistractions(blocklist, cb) {
  list((procs) => {
    const hit = procs.filter((p) => p.pid !== process.pid && p.pid > 1 && matches(p.name, blocklist));
    hit.forEach((p) => {
      if (process.platform === 'win32') execFile('taskkill', ['/PID', String(p.pid), '/F'], { windowsHide: true }, () => {});
      else { try { process.kill(p.pid, 'SIGTERM'); } catch (e) {} }
    });
    cb && cb(hit.map((p) => p.name.split(/[\\/]/).pop()));
  });
}

module.exports = { closeDistractions, DEFAULT_BLOCKLIST, matches };
