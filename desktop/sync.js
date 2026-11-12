/* Sync over the public ntfy.sh relay. Every message is compressed and end-to-end encrypted (AES-256-GCM)
   with a key derived from the sync code, so the relay only ever sees random-looking text.
   android/.../Sync.java speaks the same format. */
const https = require('https');
const crypto = require('crypto');
const zlib = require('zlib');

const HOST = 'ntfy.sh';
const MAX_MSG = 3800;

function norm(code) { return String(code || '').trim().toLowerCase(); }
function sha(s) { return crypto.createHash('sha256').update(s, 'utf8').digest(); }
function topicFor(code) { return 'scf_' + sha('scaffold-topic:' + norm(code)).toString('hex').slice(0, 24); }
function keyFor(code) { return sha('scaffold-key:' + norm(code)); }

function encrypt(key, obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(zlib.deflateRawSync(Buffer.from(JSON.stringify(obj), 'utf8'))), c.final()]);
  return Buffer.concat([iv, ct, c.getAuthTag()]).toString('base64');
}
function decrypt(key, b64) {
  const buf = Buffer.from(b64, 'base64');
  const iv = buf.subarray(0, 12), tag = buf.subarray(buf.length - 16), ct = buf.subarray(12, buf.length - 16);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return JSON.parse(zlib.inflateRawSync(Buffer.concat([d.update(ct), d.final()])).toString('utf8'));
}

class Sync {
  // opts: { code, deviceId, since, onPatch(patch, isSnap), onStatus(text), onSince(id) }
  constructor(opts) {
    this.o = opts; this.topic = topicFor(opts.code); this.key = keyFor(opts.code);
    this.alive = true; this.backoff = 2000; this.req = null; this.outbox = [];
  }
  start() { this._connect(); }
  stop() { this.alive = false; if (this.req) this.req.destroy(); clearTimeout(this.retryT); clearTimeout(this.reconT); }

  _connect() {
    if (!this.alive) return;
    const since = this.o.since || '12h';
    this.req = https.get({ host: HOST, path: `/${this.topic}/json?since=${encodeURIComponent(since)}`, headers: { 'User-Agent': 'Scaffold/0.1' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return this._retry('relay error ' + res.statusCode); }
      this.backoff = 2000; this.o.onStatus('connected');
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buf += chunk;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); this._line(line); }
      });
      res.on('end', () => this._retry('reconnecting'));
      res.on('error', (e) => this._retry(e.message));
    });
    this.req.setTimeout(100000, () => this.req.destroy(new Error('timeout')));
    this.req.on('error', (e) => this._retry(e.message));
  }
  _retry(why) {
    if (!this.alive) return;
    this.o.onStatus('offline (' + why + ')');
    clearTimeout(this.reconT);
    this.reconT = setTimeout(() => this._connect(), this.backoff);
    this.backoff = Math.min(60000, this.backoff * 2);
  }
  _line(line) {
    if (!line.trim()) return;
    let m; try { m = JSON.parse(line); } catch (e) { return; }
    if (m.event !== 'message' || !m.message) return;
    this.o.since = m.id; this.o.onSince(m.id);
    let env; try { env = decrypt(this.key, m.message); } catch (e) { return; }
    if (!env || env.d === this.o.deviceId) return;
    this.o.onPatch(env.p || {}, !!env.s);
  }

  publish(patches, isSnap) {
    patches.forEach((p) => this.outbox.push(encrypt(this.key, { d: this.o.deviceId, p, s: isSnap ? 1 : 0 })));
    this._flush();
  }
  _flush() {
    if (this.sending || !this.outbox.length || !this.alive) return;
    const body = this.outbox[0];
    if (body.length > MAX_MSG) { this.outbox.shift(); return this._flush(); }
    this.sending = true;
    const req = https.request({ host: HOST, path: '/' + this.topic, method: 'POST', headers: { 'Content-Type': 'text/plain', 'User-Agent': 'Scaffold/0.1', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
      res.resume(); this.sending = false;
      if (res.statusCode === 200) { this.outbox.shift(); this._flush(); }
      else { this.retryT = setTimeout(() => this._flush(), 30000); }
    });
    req.on('error', () => { this.sending = false; this.retryT = setTimeout(() => this._flush(), 30000); });
    req.end(body);
  }
}

module.exports = { Sync, topicFor, keyFor, encrypt, decrypt };
