/* "Sign in with Google" on computers: Google's page opens in the browser, then sends the browser back to a tiny server
   on this computer (loopback + PKCE, Google's way for desktop apps). The result is a refresh key, shared with the user's
   other devices through the encrypted sync, so one sign-in covers them all. Access keys (1 h) are made from it per device. */
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { URL } = require('url');

const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth', TOKEN = 'https://oauth2.googleapis.com/token', REVOKE = 'https://oauth2.googleapis.com/revoke';
const SCOPE = 'https://www.googleapis.com/auth/calendar';

// The app's Google client (kept out of the public code: copied in at build time from .secrets/).
function client() {
  for (const p of ['./ui/google-client.json', '../.secrets/google-oauth.json']) {
    try { const j = require(p); const c = j.installed || j; if (c.client_id && c.client_secret) return c; } catch (e) {}
  }
  return null;
}

function httpReq(method, url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url), h = Object.assign({ 'User-Agent': 'Scaffold' }, headers || {});
    if (body != null) h['Content-Length'] = Buffer.byteLength(body);
    const r = https.request({ method, hostname: u.hostname, path: u.pathname + u.search, headers: h }, (res) => {
      let buf = ''; res.setEncoding('utf8'); res.on('data', (c) => (buf += c));
      res.on('end', () => resolve({ status: res.statusCode, text: buf }));
    });
    r.setTimeout(60000, () => r.destroy(new Error('timeout')));
    r.on('error', reject);
    r.end(body == null ? undefined : body);
  });
}
const form = (o) => Object.keys(o).map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(o[k])).join('&');
async function postForm(url, o) {
  const r = await httpReq('POST', url, { 'Content-Type': 'application/x-www-form-urlencoded' }, form(o));
  let j = {}; try { j = JSON.parse(r.text); } catch (e) {}
  if (r.status !== 200) { const e = new Error('Google sign-in: ' + (j.error_description || j.error || 'HTTP ' + r.status)); e.dead = j.error === 'invalid_grant'; throw e; }
  return j;
}
const b64url = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const PAGE = (msg) => '<!doctype html><meta charset="utf-8"><title>Scaffold</title><body style="margin:0;height:100vh;display:grid;place-items:center;font:18px -apple-system,Segoe UI,sans-serif;background:#0f1117;color:#eef0f7;text-align:center"><div><div style="font-size:44px">▦</div><p>' + msg + '</p></div>';

/* Opens Google's sign-in page (openUrl) and waits for the answer. Resolves { rt, at, exp }. Gives up after 10 minutes. */
let pending = null;
function signIn(openUrl) {
  const c = client();
  if (!c) return Promise.reject(new Error('this build has no Google sign-in'));
  if (pending) { pending.cancel(); pending = null; }
  const verifier = b64url(crypto.randomBytes(48)), challenge = b64url(crypto.createHash('sha256').update(verifier).digest()), state = b64url(crypto.randomBytes(12));
  return new Promise((resolve, reject) => {
    let doneT;
    const srv = http.createServer(async (req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      if (u.pathname !== '/') { res.writeHead(404); return res.end(); }
      const code = u.searchParams.get('code'), err = u.searchParams.get('error');
      if (u.searchParams.get('state') !== state) { res.writeHead(400); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (!code) { res.end(PAGE('Sign-in cancelled. You can close this tab.')); finish(new Error(err === 'access_denied' ? 'cancelled' : 'Google said: ' + err)); return; }
      try {
        const j = await postForm(TOKEN, { code, client_id: c.client_id, client_secret: c.client_secret, redirect_uri: redirect, grant_type: 'authorization_code', code_verifier: verifier });
        if (!j.refresh_token) throw new Error('Google sent no lasting key');
        if (!String(j.scope || '').split(' ').includes(SCOPE)) throw new Error('calendar access wasn’t allowed (tick the calendar box on Google’s page)');
        res.end(PAGE('✅ Signed in. You can close this tab and go back to Scaffold.'));
        finish(null, { rt: j.refresh_token, at: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 });
      } catch (e) { res.end(PAGE('⚠️ ' + e.message.replace(/</g, '&lt;'))); finish(e); }
    });
    let redirect = '';
    function finish(e, v) {
      clearTimeout(doneT); pending = null;
      setTimeout(() => srv.close(), 500);
      e ? reject(e) : resolve(v);
    }
    pending = { cancel: () => finish(new Error('cancelled')) };
    srv.on('error', (e) => finish(e));
    srv.listen(0, '127.0.0.1', () => {
      redirect = 'http://127.0.0.1:' + srv.address().port;
      doneT = setTimeout(() => finish(new Error('sign-in timed out')), 10 * 60000);
      openUrl(AUTH + '?' + form({ client_id: c.client_id, redirect_uri: redirect, response_type: 'code', scope: SCOPE, code_challenge: challenge,
        code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent', state }));
    });
  });
}

/* Access keys from the shared refresh key, cached until 1 minute before they run out. e.dead = the sign-in was withdrawn. */
const cache = {};
async function accessToken(rt) {
  const c = client(), hit = cache[rt];
  if (hit && Date.now() < hit.exp - 60000) return hit.at;
  if (!c) throw new Error('this build has no Google sign-in');
  const j = await postForm(TOKEN, { client_id: c.client_id, client_secret: c.client_secret, refresh_token: rt, grant_type: 'refresh_token' });
  cache[rt] = { at: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return j.access_token;
}
function expire(rt) { delete cache[rt]; }
function seed(rt, at, exp) { if (rt && at) cache[rt] = { at, exp }; }
async function revoke(rt) { try { await httpReq('POST', REVOKE, { 'Content-Type': 'application/x-www-form-urlencoded' }, form({ token: rt })); } catch (e) {} delete cache[rt]; }

function cancel() { if (pending) pending.cancel(); }

module.exports = { client, signIn, cancel, accessToken, expire, seed, revoke, http: httpReq, SCOPE };
