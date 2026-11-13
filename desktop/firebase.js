/* Firebase Realtime Database channel: the one sync path every device shares.
   Messages (already encrypted by sync.js) go to /s/<topic>/m/<pushId> = { d, t }; every device keeps a streaming
   connection (server-sent events) open and gets new messages pushed within about a second. Works wherever Google works.
   Messages older than 24 h are deleted by whichever device notices them. */
const https = require('https');
const { URL } = require('url');

const KEEP = 24 * 3600e3;

function req(method, url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url), data = body === undefined ? null : JSON.stringify(body);
    const r = https.request({ method, hostname: u.hostname, path: u.pathname + u.search, headers: Object.assign({ 'User-Agent': 'Scaffold' }, data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) }, (res) => {
      let buf = ''; res.setEncoding('utf8'); res.on('data', (c) => (buf += c));
      res.on('end', () => { if (res.statusCode !== 200) return reject(new Error('Firebase HTTP ' + res.statusCode + ' ' + buf.slice(0, 120))); try { resolve(JSON.parse(buf)); } catch (e) { resolve(null); } });
    });
    r.setTimeout(30000, () => r.destroy(new Error('timeout')));
    r.on('error', reject);
    r.end(data || undefined);
  });
}

class FirebaseChannel {
  // opts: { base, topic, since (ms), onMessage(b64), onStatus(text), onSince(ms) }
  constructor(opts) { this.o = opts; this.alive = true; this.backoff = 2000; this.seen = new Set(); this.outbox = []; this.ok = false; }
  path(q) { return this.o.base.replace(/\/+$/, '') + '/s/' + this.o.topic + '/m.json' + (q || ''); }
  start() { this._listen(); this.cleanT = setInterval(() => this._clean(), 3600e3); setTimeout(() => this._clean(), 60000); }
  stop() { this.alive = false; if (this.req) this.req.destroy(); clearTimeout(this.reconT); clearInterval(this.cleanT); clearTimeout(this.flushT); }

  _listen() {
    if (!this.alive) return;
    const since = Math.max(this.o.since || 0, Date.now() - 12 * 3600e3) - 60000;   // a minute of overlap; duplicates are skipped
    const u = new URL(this.path('?orderBy=' + encodeURIComponent('"t"') + '&startAt=' + since));
    this.req = https.get({ hostname: u.hostname, path: u.pathname + u.search, headers: { Accept: 'text/event-stream', 'User-Agent': 'Scaffold' } }, (res) => {
      if (res.statusCode === 307 && res.headers.location) { res.resume(); this.o.base = new URL(res.headers.location).origin; return this._retry('redirect', 0); }
      if (res.statusCode !== 200) { res.resume(); return this._retry('Firebase ' + res.statusCode); }
      this.ok = true; this.backoff = 2000; this.o.onStatus('connected');
      this._flush();
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => {
        buf += c; let i;
        while ((i = buf.indexOf('\n\n')) >= 0) { const block = buf.slice(0, i); buf = buf.slice(i + 2); this._event(block); }
      });
      res.on('end', () => this._retry('reconnecting'));
      res.on('error', (e) => this._retry(e.message));
    });
    this.req.setTimeout(90000, () => this.req.destroy(new Error('timeout')));   // Firebase sends keep-alives every ~30 s
    this.req.on('error', (e) => this._retry(e.message));
  }
  _retry(why, wait) {
    if (!this.alive) return;
    this.ok = false; this.o.onStatus('offline (' + why + ')');
    clearTimeout(this.reconT);
    this.reconT = setTimeout(() => this._listen(), wait === undefined ? this.backoff : wait);
    this.backoff = Math.min(30000, this.backoff * 2);
  }
  _event(block) {
    let ev = '', data = '';
    block.split('\n').forEach((l) => { if (l.startsWith('event:')) ev = l.slice(6).trim(); else if (l.startsWith('data:')) data += l.slice(5).trim(); });
    if (ev === 'cancel' || ev === 'auth_revoked') return this._retry('Firebase refused: check the database rules', 30000);
    if (ev !== 'put' && ev !== 'patch') return;
    let j; try { j = JSON.parse(data); } catch (e) { return; }
    if (!j || j.data === null || j.data === undefined) return;
    const items = j.path === '/' ? j.data : { [j.path.replace(/^\//, '').split('/')[0]]: j.data };
    Object.keys(items).sort().forEach((k) => {
      const m = items[k];
      if (!m || typeof m.d !== 'string' || this.seen.has(k)) return;
      this.seen.add(k); if (this.seen.size > 5000) this.seen = new Set([...this.seen].slice(-2000));
      if (m.t && m.t > (this.o.since || 0)) { this.o.since = m.t; this.o.onSince(m.t); }
      this.o.onMessage(m.d);
    });
  }

  publish(msgs) { msgs.forEach((m) => this.outbox.push(m)); this._flush(); }
  async _flush() {
    if (this.sending || !this.outbox.length || !this.alive) return;
    this.sending = true;
    try {
      while (this.outbox.length) {
        const r = await req('POST', this.path(), { d: this.outbox[0], t: { '.sv': 'timestamp' } });
        if (r && r.name) this.seen.add(r.name);   // our own message: don't hand it back
        this.outbox.shift();
      }
    } catch (e) { clearTimeout(this.flushT); this.flushT = setTimeout(() => this._flush(), 5000); }
    this.sending = false;
  }
  async _clean() {
    try {
      const old = await req('GET', this.path('?orderBy=' + encodeURIComponent('"t"') + '&endAt=' + (Date.now() - KEEP) + '&limitToFirst=300'));
      const keys = Object.keys(old || {});
      if (keys.length) await req('PATCH', this.path(), Object.fromEntries(keys.map((k) => [k, null])));
    } catch (e) {}
  }
}

/* Rules to paste into the Firebase console (Realtime Database → Rules). Everything is encrypted; the topic is a hash
   of the sync code, so only devices that know the code can find or read it. */
const RULES = {
  rules: {
    '.read': false, '.write': false,
    s: { $topic: { m: { '.read': true, '.indexOn': ['t'], $id: { '.write': true, '.validate': "!newData.exists() || (newData.hasChildren(['d', 't']) && newData.child('d').isString() && newData.child('d').val().length < 500000)" } } } }
  }
};

module.exports = { FirebaseChannel, RULES, req };
