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
  // opts: { code, deviceId, since, onPatch(patch, isSnap), onStatus(text), onSince(id),
  //         relay() -> { url, secret } | null  (Google backup mailbox), onBackupStart() (send everything once) }
  constructor(opts) {
    this.o = opts; this.topic = topicFor(opts.code); this.key = keyFor(opts.code);
    this.alive = true; this.backoff = 2000; this.req = null; this.outbox = [];
    this.ntfyOk = false; this.downSince = Date.now(); this.g = { since: 0, lastPoll: 0, othersUntil: 0, outbox: [], busy: false, active: false };
  }
  start() {
    this._connect(); this.gT = setInterval(() => this._gTick(), 10000); setTimeout(() => this._gTick(), 3000);
    const fb = () => { try { this._fbStart(); } catch (e) { console.error('firebase', e); } };
    fb(); this.fbT = setInterval(fb, 30000);
  }
  stop() { this.alive = false; if (this.req) this.req.destroy(); clearTimeout(this.retryT); clearTimeout(this.reconT); clearInterval(this.gT); clearInterval(this.fbT); if (this.fb) this.fb.stop(); }

  // ---- Firebase: the main channel once its address is known (opts.firebase() -> base URL). ntfy and the Google
  //      mailbox stay as backups for devices that don't have it yet, and for when Firebase is unreachable. ----
  _fbStart() {
    const base = this.o.firebase && this.o.firebase();
    if (this.fb && this.fb.base0 === base) return;
    if (this.fb) { this.fb.stop(); this.fb = null; }
    if (!base || !this.alive) return;
    const { FirebaseChannel } = require('./firebase.js');
    this.fb = new FirebaseChannel({ base, topic: this.topic, since: this.o.fbSince || 0,
      onMessage: (b64) => this._msg(b64), onStatus: () => this.status(''), onSince: (t) => { this.o.fbSince = t; if (this.o.onFbSince) this.o.onFbSince(t); } });
    this.fb.base0 = base;
    this.fb.start();
  }
  fbOk() { return !!(this.fb && this.fb.ok); }

  // ---- Google backup mailbox: used while this device can't reach ntfy, or while another device can't ----
  // Blocked = can't listen to ntfy, or ntfy refuses our messages (its free daily limit, HTTP 429).
  blocked() { return (!this.ntfyOk && Date.now() - this.downSince > 45000) || Date.now() < (this.sendBlockedUntil || 0); }
  backupActive() { return (this.blocked() && !this.fbOk()) || Date.now() < this.g.othersUntil; }
  status(s) {
    if (this.fbOk()) return this.o.onStatus('connected (Firebase)');
    this.o.onStatus(this.blocked() && this.g.ok ? 'connected through Google (main relay blocked here)' : s || (this.ntfyOk ? 'connected' : 'connecting…'));
  }
  async _gTick() {
    const cfg = this.o.relay && this.o.relay();
    if (!this.alive || !cfg || !cfg.url || this.g.busy) return;
    const now = Date.now(), active = this.backupActive();
    if (now - this.g.lastPoll < (active ? 9000 : 30000)) return this._gFlush(cfg);
    this.g.busy = true; this.g.lastPoll = now;
    try {
      const r = await gcall(cfg.url, { secret: cfg.secret, op: 'relay-poll', since: this.g.since, from: this.o.deviceId, listen: this.blocked() && !this.fbOk() });
      if (r.seq < this.g.since) this.g.since = 0;   // the mailbox restarted its count (expired cache)
      this.g.ok = true; this.g.since = r.seq || this.g.since;
      if (this.o.onScriptOld) this.o.onScriptOld(false);
      (r.msgs || []).forEach((m) => this._msg(m));
      if (r.listeners > 0) this.g.othersUntil = Date.now() + 120000;
      if (this.blocked()) this.status('');
    } catch (e) { this.g.ok = false; if (/unknown op/.test(e.message) && this.o.onScriptOld) this.o.onScriptOld(true); }
    this.g.busy = false;
    const nowActive = this.backupActive();
    if (nowActive && !this.g.active && this.o.onBackupStart) this.o.onBackupStart();
    this.g.active = nowActive;
    this._gFlush(cfg);
  }
  async _gFlush(cfg) {
    if (this.g.busy || !this.g.outbox.length) return;
    this.g.busy = true;
    const batch = this.g.outbox.slice(0, 60);
    try { await gcall(cfg.url, { secret: cfg.secret, op: 'relay-post', msgs: batch }); this.g.outbox.splice(0, batch.length); } catch (e) {}
    this.g.busy = false;
  }

  _connect() {
    if (!this.alive) return;
    const since = this.o.since || '12h';
    this.req = https.get({ host: HOST, path: `/${this.topic}/json?since=${encodeURIComponent(since)}`, headers: { 'User-Agent': 'Scaffold/0.1' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return this._retry('relay error ' + res.statusCode); }
      this.backoff = 2000; this.ntfyOk = true; this.status('connected');
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
    if (this.ntfyOk) this.downSince = Date.now();
    this.ntfyOk = false;
    this.status('offline (' + why + ')');
    clearTimeout(this.reconT);
    this.reconT = setTimeout(() => this._connect(), this.backoff);
    this.backoff = Math.min(60000, this.backoff * 2);
  }
  _line(line) {
    if (!line.trim()) return;
    let m; try { m = JSON.parse(line); } catch (e) { return; }
    if (m.event !== 'message' || !m.message) return;
    this.o.since = m.id; this.o.onSince(m.id);
    this._msg(m.message);
  }
  _msg(b64) {
    let env; try { env = decrypt(this.key, b64); } catch (e) { return; }
    if (!env || env.d === this.o.deviceId) return;
    this.o.onPatch(env.p || {}, !!env.s);
  }

  publish(patches, isSnap) {
    const msgs = patches.map((p) => encrypt(this.key, { d: this.o.deviceId, p, s: isSnap ? 1 : 0 }));
    if (this.fb) this.fb.publish(msgs);
    // ntfy too, so devices that don't know the Firebase address yet still get everything (including that address).
    msgs.forEach((m) => this.outbox.push(m));
    // Live changes (locks, completions…) always go to the Google mailbox too, so they arrive even if ntfy drops them.
    // Full snapshots only while someone depends on Google.
    if (!isSnap || this.backupActive()) { msgs.forEach((m) => this.g.outbox.push(m)); const cfg = this.o.relay && this.o.relay(); if (cfg) this._gFlush(cfg); }
    this._flush();
  }
  _flush() {
    if (this.sending || !this.outbox.length || !this.alive) return;
    const body = this.outbox[0];
    if (body.length > MAX_MSG) { this.outbox.shift(); return this._flush(); }
    this.sending = true;
    const req = https.request({ host: HOST, path: '/' + this.topic, method: 'POST', headers: { 'Content-Type': 'text/plain', 'User-Agent': 'Scaffold/0.1', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
      res.resume(); this.sending = false;
      if (res.statusCode === 429) {   // over ntfy's daily limit: the Google mailbox carries our messages meanwhile
        const wait = Math.min(24 * 3600, +res.headers['retry-after'] || 3600) * 1000;
        const was = this.backupActive(); this.sendBlockedUntil = Date.now() + wait;
        if (!was) { this.g.outbox.push(...this.outbox); this.g.lastPoll = 0; }
        this.outbox = []; this.retryT = setTimeout(() => this._flush(), wait); return;
      }
      if (res.statusCode === 200) { this.outbox.shift(); this._flush(); }
      else { this.retryT = setTimeout(() => this._flush(), 30000); }
    });
    req.on('error', () => { this.sending = false; this.retryT = setTimeout(() => this._flush(), 30000); });
    req.end(body);
  }
}

function gcall(url, body) { return require('./calendar.js').call(url, body); }

module.exports = { Sync, topicFor, keyFor, encrypt, decrypt };
