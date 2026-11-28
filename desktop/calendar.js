/* Google Calendar transport for computers. The sync rounds themselves are in shared/calsync.js.
   url 'google' = Google directly through "Sign in with Google" (shared/gbridge.js); anything else = the user's Apps Script web app. */
const https = require('https');
const { URL } = require('url');


function call(url, body, redirects) {
  return new Promise((resolve, reject) => {
    const u = new URL(url), data = body ? JSON.stringify(body) : null;
    const mod = u.protocol === 'http:' ? require('http') : https;
    const req = mod.request({ port: u.port || undefined, hostname: u.hostname, host: u.host, path: u.pathname + u.search, method: data ? 'POST' : 'GET',
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && (redirects || 0) < 5) {
        res.resume();
        // Apps Script answers a POST with a redirect to the result, fetched with GET.
        return resolve(call(new URL(res.headers.location, url).toString(), res.statusCode === 307 || res.statusCode === 308 ? body : null, (redirects || 0) + 1));
      }
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
        try { const j = JSON.parse(buf); if (j.error) reject(new Error(j.error)); else resolve(j); }
        catch (e) {   // Google's script crashed: its error page says why
          const txt = buf.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
          const m = /((?:Type|Reference|Range)?Error|Exception|GoogleJsonResponseException)[:\s][^]{0,220}/.exec(txt);
          reject(new Error(m ? 'Google script: ' + m[0].trim() : 'Not a bridge reply (is the URL the /exec one?)'));
        }
      });
    });
    req.setTimeout(90000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(data || undefined);
  });
}

let CalSync; try { CalSync = require('../shared/calsync.js'); } catch (e) { CalSync = require('./ui/calsync.js'); }   // packaged app: copied into ui/
let google = null;   // the Google handler (gbridge) while signed in
function setGoogle(h) { google = h; }
function route(url, body) {
  if (url !== 'google') return call(url, body);
  return google ? google.handle(body) : Promise.reject(new Error('not signed in to Google'));
}

module.exports = Object.assign({ call: route, rawCall: call, setGoogle }, CalSync.make(route));
