/* Google Calendar, spoken directly (Calendar API v3 + "Sign in with Google"), with the same requests and replies as the
   old Apps Script bridge (ui/gcal-script.js): pull, upsert, delete, cal-create/rename/color/delete/sub/unsub.
   So calendar sync (shared/calsync.js) works the same whichever way Google is linked.
   Runs on computers (Node) and in the phone's WebView. create(o):
     o.http(method, url, headers, body) -> Promise<{ status, text }>
     o.token() -> Promise<access token>   (each platform gets it from the shared sign-in) */
(function (root) {
  'use strict';
  var API = 'https://www.googleapis.com/calendar/v3';
  var V = 3;   // same features as bridge v3

  function iso(ms) { return new Date(ms).toISOString(); }
  function hash(s) {   // stands in for the script's md5: only "did the calendar list change?"
    var a = 5381, b = 52711;
    for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); a = (a * 33) ^ c; b = (b * 31 + c) | 0; }
    return (a >>> 0).toString(36) + (b >>> 0).toString(36) + s.length.toString(36);
  }
  function gidOf(g) { return String(g || '').replace(/@google\.com$/, ''); }
  function calOf(req) { return req.cal || 'primary'; }
  function enc(s) { return encodeURIComponent(s); }
  function qs(q) {
    var p = [];
    Object.keys(q || {}).forEach(function (k) { if (q[k] !== undefined && q[k] !== null && q[k] !== '') p.push(enc(k) + '=' + enc(q[k])); });
    return p.length ? '?' + p.join('&') : '';
  }
  function utcDay(d) { return d.toISOString().slice(0, 10); }
  function ruleLine(rec) { return (rec || []).filter(function (l) { return /^RRULE:/.test(l); })[0] || ''; }
  function others(rec) { return (rec || []).filter(function (l) { return !/^RRULE:/.test(l); }); }
  // The series stops right before the occurrence that started at ostart.
  function untilBefore(rule, ostart, allDay) {
    var until;
    if (allDay) { var d = new Date(String(ostart) + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); until = utcDay(d).replace(/-/g, ''); }
    else until = new Date(+ostart - 1000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    return rule.replace(/;(COUNT|UNTIL)=[^;]*/g, '') + ';UNTIL=' + until;
  }

  function create(o) {
    async function api(method, path, query, body, retried) {
      var t = await o.token();
      var r = await o.http(method, API + path + qs(query), { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body === undefined ? null : JSON.stringify(body));
      if (r.status === 401 && !retried && o.expire) { o.expire(); return api(method, path, query, body, true); }
      if (r.status === 204 || (r.status === 200 && !r.text)) return null;
      var j = null; try { j = JSON.parse(r.text); } catch (e) {}
      if (r.status >= 300) {
        var names = { 400: 'Bad Request', 403: 'Forbidden', 404: 'Not Found', 409: 'Conflict', 410: 'Gone (deleted)', 429: 'Too Many Requests' };
        var msg = (j && j.error && j.error.message) || '';
        throw new Error('Google ' + r.status + ' ' + (names[r.status] || '') + (msg && msg !== names[r.status] ? ': ' + msg : ''));
      }
      return j;
    }
    async function pages(path, query) {
      var items = [], tok = null;
      do {
        var r = await api('GET', path, Object.assign({}, query, { pageToken: tok }));
        (r.items || []).forEach(function (x) { items.push(x); });
        tok = r.nextPageToken;
      } while (tok);
      return items;
    }

    async function cals() {
      var items = await pages('/users/me/calendarList', { maxResults: 250 });
      return items.map(function (c) {
        return { id: c.id, name: c.summaryOverride || c.summary, color: c.backgroundColor, primary: !!c.primary, ro: !(c.accessRole === 'owner' || c.accessRole === 'writer'), owner: c.accessRole === 'owner' };
      });
    }

    function conv(ev, c) {
      var allDay = !!ev.start.date, pr = (ev.extendedProperties && ev.extendedProperties.private) || {}, os = ev.originalStartTime;
      return { gid: ev.id, cal: c.id, title: ev.summary || '(no title)', desc: ev.description || '', allDay: allDay,
        sd: allDay ? ev.start.date : '', ed: allDay ? ev.end.date : '',
        start: Date.parse(allDay ? ev.start.date + 'T00:00:00' : ev.start.dateTime), end: Date.parse(allDay ? ev.end.date + 'T00:00:00' : ev.end.dateTime),
        rec: !!ev.recurringEventId, series: ev.recurringEventId || '', ostart: os ? (os.date || Date.parse(os.dateTime)) : '',
        color: ev.colorId || '', upd: Date.parse(ev.updated), sid: pr.scaffoldId || '' };
    }

    // All calendars, from..to. With since + sig: answers { same: true } when nothing changed (cheap check).
    async function pull(req) {
      var cs = await cals(), sig = hash(JSON.stringify(cs));
      if (req.since && req.sig === sig) {
        var changed = false;
        for (var i = 0; i < cs.length && !changed; i++) {
          var r = await api('GET', '/calendars/' + enc(cs[i].id) + '/events', { updatedMin: iso(req.since - 120000), showDeleted: true, maxResults: 1, fields: 'items(id)' });
          changed = !!(r.items && r.items.length);
        }
        if (!changed) return { v: V, same: true, now: Date.now() };
      }
      var pal = {}, ec = ((await api('GET', '/colors')) || {}).event || {};
      Object.keys(ec).forEach(function (k) { pal[k] = ec[k].background; });
      var events = [], rules = {};
      for (var k = 0; k < cs.length; k++) {
        var c = cs[k], path = '/calendars/' + enc(c.id) + '/events';
        var evs = await pages(path, { timeMin: iso(req.from), timeMax: iso(req.to), singleEvents: true, maxResults: 2500,
          fields: 'nextPageToken,items(id,status,summary,description,start,end,colorId,recurringEventId,originalStartTime,updated,extendedProperties)' });
        evs.forEach(function (ev) { if (ev.status !== 'cancelled') events.push(conv(ev, c)); });
        var series = await pages(path, { timeMin: iso(req.from), timeMax: iso(req.to), singleEvents: false, maxResults: 2500, fields: 'nextPageToken,items(id,recurrence)' });
        series.forEach(function (ev) { if (ev.recurrence) rules[ev.id] = ev.recurrence.join('\n'); });
      }
      return { v: V, events: events, cals: cs, colors: pal, rules: rules, sig: sig, now: Date.now() };
    }

    function body(req) {
      var b = { summary: req.title, colorId: req.color || null };
      if (req.desc != null) b.description = req.desc;
      if (req.allDay) { b.start = { date: req.sd, dateTime: null, timeZone: null }; b.end = { date: req.ed, dateTime: null, timeZone: null }; }
      else { b.start = { dateTime: iso(req.start), date: null, timeZone: req.tz || null }; b.end = { dateTime: iso(req.end), date: null, timeZone: req.tz || null }; }
      return b;
    }
    function evPath(cal, id) { return '/calendars/' + enc(cal) + '/events' + (id ? '/' + enc(id) : ''); }
    async function findBySid(cal, sid) {
      var r = await api('GET', evPath(cal), { privateExtendedProperty: 'scaffoldId=' + sid, maxResults: 5, singleEvents: false });
      return r.items && r.items.length ? r.items[0] : null;
    }
    function done(r) { return { gid: r.id, upd: Date.parse(r.updated) }; }

    // req: cal, oldCal, gid, sid, title, desc, color, allDay, sd, ed, start, end, tz, rrule ('' = none), keepRule, scope ('one'|'following'|'all'), series, ostart
    async function upsert(req) {
      var cal = calOf(req), b = body(req), gid = gidOf(req.gid);
      if (req.series && req.scope && req.scope !== 'one') {
        var series = gidOf(req.series), oldCal = req.oldCal || cal, m = await api('GET', evPath(oldCal, series));
        var osMs = req.allDay ? Date.parse(req.ostart + 'T00:00:00') : +req.ostart;
        var mStart = m.start.date ? Date.parse(m.start.date + 'T00:00:00') : Date.parse(m.start.dateTime);
        var first = Math.abs(osMs - mStart) < 60000;
        if (req.scope === 'all' || first) {
          if (!req.allDay) {   // same shift for the whole series
            var s = mStart + (req.start - osMs);
            b.start.dateTime = iso(s); b.end.dateTime = iso(s + (req.end - req.start));
          } else if (m.start.date) {
            var shift = Math.round((Date.parse(req.sd + 'T00:00:00') - osMs) / 86400000), d0 = new Date(m.start.date + 'T12:00:00Z');
            d0.setUTCDate(d0.getUTCDate() + shift);
            var len = Math.round((Date.parse(req.ed + 'T00:00:00') - Date.parse(req.sd + 'T00:00:00')) / 86400000), d1 = new Date(d0.getTime());
            d1.setUTCDate(d1.getUTCDate() + len);
            b.start.date = utcDay(d0); b.end.date = utcDay(d1);
          }
          b.recurrence = req.keepRule || !req.rrule ? m.recurrence : others(m.recurrence).concat([req.rrule]);
          if (oldCal !== cal) await api('POST', evPath(oldCal, series) + '/move', { destination: cal });
          return done(await api('PATCH', evPath(cal, series), null, b));
        }
        // "This and following": end the old series before this occurrence, start a new one here.
        var rule = req.keepRule || !req.rrule ? ruleLine(m.recurrence) : req.rrule;
        var cm = /;COUNT=(\d+)/.exec(ruleLine(m.recurrence));
        if (cm && (req.keepRule || !req.rrule)) {
          var before = ((await api('GET', evPath(oldCal, series) + '/instances', { timeMax: iso(osMs), maxResults: 2500 })).items || []).length;
          rule = rule.replace(/;COUNT=\d+/, ';COUNT=' + Math.max(1, +cm[1] - before));
        }
        await api('PATCH', evPath(oldCal, series), null, { recurrence: others(m.recurrence).concat([untilBefore(ruleLine(m.recurrence), req.ostart, !!m.start.date)]) });
        b.recurrence = [rule];
        if (req.sid) b.extendedProperties = { private: { scaffoldId: req.sid } };
        return done(await api('POST', evPath(cal), null, b));
      }
      if (!gid && req.sid) { var f = await findBySid(cal, req.sid); if (f) gid = f.id; }
      if (!gid) {
        b.extendedProperties = { private: { scaffoldId: req.sid || '' } };
        if (req.rrule) b.recurrence = [req.rrule];
        return done(await api('POST', evPath(cal), null, b));
      }
      if (req.oldCal && req.oldCal !== cal && !req.series) await api('POST', evPath(req.oldCal, gid) + '/move', { destination: cal });
      if (req.rrule && !req.series) b.recurrence = [req.rrule];
      return done(await api('PATCH', evPath(cal, gid), null, b));
    }

    // req: cal, gid, scope, series, ostart, allDay
    async function del(req) {
      var cal = calOf(req);
      try {
        if (req.series && req.scope === 'all') await api('DELETE', evPath(cal, gidOf(req.series)));
        else if (req.series && req.scope === 'following') {
          var m = await api('GET', evPath(cal, gidOf(req.series))), mStart = m.start.date ? m.start.date : Date.parse(m.start.dateTime);
          if (String(mStart) === String(req.ostart) || Math.abs(+mStart - +req.ostart) < 60000) await api('DELETE', evPath(cal, gidOf(req.series)));
          else await api('PATCH', evPath(cal, gidOf(req.series)), null, { recurrence: others(m.recurrence).concat([untilBefore(ruleLine(m.recurrence), req.ostart, !!m.start.date)]) });
        } else await api('DELETE', evPath(cal, gidOf(req.gid)));
      } catch (x) { if (!/410|404|deleted|Not Found/i.test(String(x))) throw x; }
      return { ok: true };
    }

    // Editing calendars, like in Google Calendar: rename, color, new, delete (own), subscribe / unsubscribe (others).
    async function calColor(id, hex) {
      var cc = ((await api('GET', '/colors')) || {}).calendar || {}, cid = null;
      Object.keys(cc).forEach(function (k) { if (cc[k].background.toLowerCase() === String(hex).toLowerCase()) cid = k; });
      if (cid) await api('PATCH', '/users/me/calendarList/' + enc(id), null, { colorId: cid });
      else await api('PATCH', '/users/me/calendarList/' + enc(id), { colorRgbFormat: true }, { backgroundColor: hex, foregroundColor: '#000000' });
    }
    async function calOp(req) {
      if (req.op === 'cal-create') { var c = await api('POST', '/calendars', null, req.tz ? { summary: req.name, timeZone: req.tz } : { summary: req.name }); if (req.color) await calColor(c.id, req.color); return { id: c.id }; }
      if (req.op === 'cal-rename') { await api('PATCH', '/calendars/' + enc(req.cal), null, { summary: req.name }); return { ok: true }; }
      if (req.op === 'cal-color') { await calColor(req.cal, req.color); return { ok: true }; }
      if (req.op === 'cal-delete') { await api('DELETE', '/calendars/' + enc(req.cal)); return { ok: true }; }
      if (req.op === 'cal-sub') { var s = await api('POST', '/users/me/calendarList', null, { id: req.id }); return { id: s.id }; }
      if (req.op === 'cal-unsub') { await api('DELETE', '/users/me/calendarList/' + enc(req.cal)); return { ok: true }; }
      throw new Error('unknown op');
    }

    // One request, same shape as the script's (the secret is ignored: the sign-in is the key).
    var chain = Promise.resolve();
    function handle(req) {
      var run = function () {
        if (req.op === 'pull') return pull(req);
        if (req.op === 'upsert') return upsert(req);
        if (req.op === 'delete') return del(req);
        if (String(req.op).indexOf('cal-') === 0) return calOp(req);
        if (String(req.op).indexOf('relay-') === 0) return Promise.reject(new Error('no backup mailbox with Google sign-in'));
        return Promise.reject(new Error('unknown op'));
      };
      var p = chain.then(run, run);   // one at a time, like the script's lock
      chain = p.catch(function () {});
      return p;
    }
    // The signed-in account's address (its main calendar's id).
    async function email() { var c = await api('GET', '/users/me/calendarList/primary'); return (c && c.id) || ''; }
    return { handle: handle, email: email };
  }

  var GBridge = { create: create, hash: hash, untilBefore: untilBefore, SCOPE: 'https://www.googleapis.com/auth/calendar' };
  if (typeof module !== 'undefined' && module.exports) module.exports = GBridge; else root.GBridge = GBridge;
})(typeof window !== 'undefined' ? window : this);
