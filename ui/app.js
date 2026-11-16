/* Scaffold UI: one codebase for Android (WebView), desktop (Electron) and the browser preview. */
(function () {
  'use strict';
  var B = window.AndroidBridge || window.ScaffoldBridge || window.DevBridge;
  var E = window.Engine;
  var PLATFORM = B.platform();
  var $app = document.getElementById('app');
  var $modal = document.getElementById('modal-root');

  var S = { state: null, local: null, r: null, view: 'today', mode: 'main', modeTask: '', modalOpen: false, project: '', calMonth: null, calDay: null, noteSeen: {} };
  try { var launch = JSON.parse(B.getLaunch()); S.mode = launch.mode || 'main'; S.modeTask = launch.task || ''; } catch (e) {}
  try { var saved = localStorage.getItem('scaffold-view'); if (saved) S.view = saved; } catch (e) {}
  if (['today', 'calendar', 'tasks', 'habits', 'notes', 'settings'].indexOf(S.view) < 0) S.view = 'today';

  var EMOJIS = ['📖', '📚', '🪥', '🛏️', '🏃', '🧘', '💧', '🚿', '🧹', '🍳', '✍️', '💻', '🎨', '🎸', '🧠', '🌙', '☀️', '🥗', '📝', '📞', '🧺', '🐶', '🎮', '💊', '🛒', '🔧', '💰', '✉️', '🎯', '🚀', '🏠', '🎲'];
  var COLORS = ['#7c9cff', '#5ed3a8', '#ffb86b', '#ff7a90', '#c58cff', '#5cc8ff', '#ffd75e', '#9be36b'];
  var DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  var WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var DAYNAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var PUSH = {
    off: { icon: '🔕', name: 'Off', desc: 'No reminders.' },
    nudge: { icon: '🔔', name: 'Nudge', desc: 'Notifications.' },
    nag: { icon: '📣', name: 'Nag', desc: 'Pop-ups that take over the screen.' }
  };
  function pushIcons(t, kind) { var p = PUSH[E.pushOf(t, kind)] || PUSH.nudge; return p.icon + (E.lockOf(t) && E.hasDue(t, kind) ? '🔒' : ''); }
  function pushLabel(t, kind) { var p = PUSH[E.pushOf(t, kind)] || PUSH.nudge; return p.icon + ' ' + p.name + (E.lockOf(t) && E.hasDue(t, kind) ? ' · 🔒 lock at deadline' : ''); }
  var TEMPLATES = [
    { emoji: '🪥', title: 'Brush teeth', dueOn: true, due: '08:00', rfrom: '07:00', rto: '08:00', push: 'nag', lock: true, kind: 'check', remind: 15, color: '#5cc8ff' },
    { emoji: '🛏️', title: 'Make the bed', dueOn: true, due: '09:00', rfrom: '07:00', rto: '09:00', push: 'nag', lock: false, kind: 'check', remind: 30, color: '#c58cff' },
    { emoji: '📖', title: 'Read', dueOn: true, due: '21:30', rfrom: '20:00', rto: '21:30', push: 'nag', lock: true, kind: 'timer', minutes: 20, remind: 30, color: '#ffb86b' },
    { emoji: '📚', title: 'Study', dueOn: true, due: '18:00', rfrom: '14:00', rto: '18:00', push: 'nag', lock: true, kind: 'timer', minutes: 45, remind: 45, color: '#7c9cff' },
    { emoji: '💻', title: 'Work on a project', dueOn: true, due: '20:00', rfrom: '15:00', rto: '20:00', push: 'nag', lock: false, kind: 'timer', minutes: 30, remind: 60, color: '#5ed3a8' },
    { emoji: '🧹', title: 'Tidy up', dueOn: true, due: '21:00', rfrom: '18:00', rto: '21:00', push: 'nag', lock: false, kind: 'timer', minutes: 10, remind: 45, color: '#ffd75e' }
  ];
  var WORDS = ('amber anchor apple arrow aspen atlas badge bamboo basil beacon berry birch blaze bloom breeze brook cabin cactus candle canyon cedar cherry cliff clover cobalt comet coral cosmic cotton crane crystal dawn delta dune eagle echo ember fable falcon fern fjord flame forest fox frost galaxy garnet ginger glacier grove harbor hazel honey indigo iris island ivory jade jasmine jungle kayak kite lagoon lantern lemon lily lotus lunar maple marble meadow mint mist moss nebula nectar north oak ocean olive onyx orbit otter panda pearl pebble pepper pine planet plum polar prism quartz raven reef river robin ruby saffron sage salt sierra silver sky snow solar spruce star stone storm sunny thunder tiger topaz tulip tundra valley velvet violet willow winter wolf zephyr').split(' ');

  // ---------- helpers ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function hm(t) { return E.hhmm(t); }
  function dur(ms) {
    ms = Math.max(0, ms); var m = Math.round(ms / 60000);
    if (m < 60) return m + ' min';
    var h = Math.floor(m / 60); m = m % 60;
    if (h >= 48) return Math.round(h / 24) + ' days';
    return h + 'h' + (m ? ' ' + E.pad(m) : '');
  }
  function clock(ms) { ms = Math.max(0, ms); var s = Math.ceil(ms / 1000); return Math.floor(s / 60) + ':' + E.pad(s % 60); }
  function now() { return Date.now(); }
  function by() { return S.local.deviceId; }
  function apply(patch) { if (patch) B.apply(JSON.stringify(patch)); }
  function item(id) { return S.r.items.filter(function (i) { return i.id === id; })[0]; }
  function taskColor(t) { return (t && t.color) || '#7c9cff'; }
  function live(map) { var m = S.state[map] || {}; return Object.keys(m).map(function (k) { return m[k]; }).filter(function (x) { return !x.del; }); }
  function rec(id) { return (S.state.tasks || {})[id] || (S.state.todos || {})[id]; }
  function niceDay(key) {
    var t = E.fromKey(key), today = E.dateKey(now());
    if (key === today) return 'today';
    if (key === E.dateKey(E.addDays(now(), 1))) return 'tomorrow';
    if (key === E.dateKey(E.addDays(now(), -1))) return 'yesterday';
    var d = new Date(t), diff = Math.round((t - E.fromKey(today)) / E.DAY);
    if (diff > 0 && diff < 7) return DAYNAMES[d.getDay()];
    return DAYNAMES[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()].slice(0, 3);
  }
  function calMove(dir) {
    var v = calView(), t = E.fromKey(calAnchor()), d = new Date(t);
    if (v === 'range') { var rg = calRange(); S.calRange = { from: E.dateKey(E.addDays(E.fromKey(rg.from), (rg.n > 7 ? Math.ceil(rg.n / 7) * 7 : rg.n) * dir)), n: rg.n }; saveRange(); return render(); }
    if (v === 'month') t = new Date(d.getFullYear(), d.getMonth() + dir, 1, 12).getTime();
    else t = E.addDays(t, v === 'week' ? 7 * dir : dir);
    S.calDay = E.dateKey(t); render();
  }
  function projectOf(t) { return t && t.project ? (S.state.projects || {})[t.project] : null; }

  function load() {
    S.state = JSON.parse(B.getState());
    S.local = JSON.parse(B.getLocal());
    E.MAPS.forEach(function (m) { S.state[m] = S.state[m] || {}; });
    S.r = E.compute(S.state, now());
    S.lb = null;
    S.act = E.activeMode(S.state, now(), S.r);
  }

  // ---------- actions ----------
  var A = {
    done: function (id, kind) {
      var r = rec(id);
      apply(E.opComplete(id, kind || 'full', by(), now(), S.state));
      if (S.local.timer && S.local.timer.taskId === id) B.stopTimer();
      if (r && r.test) apply(E.opDelete(r, by(), now() + 1));
      toast(kind === 'tiny' ? '🌱 Tiny win counted' : '✅ Done!');
      if (S.mode === 'remind') B.closeWindow();
    },
    undo: function (id) { apply(E.opUndo(id, by(), now(), S.state)); },
    snooze: function (id) {
      var p = E.opSnooze(S.state, id, by(), now());
      if (!p) return toast('No snoozes left today');
      apply(p); toast('⏸ Snoozed for ' + E.SNOOZE_MIN + ' min');
      if (S.mode === 'remind') B.closeWindow();
    },
    timer: function (id) {
      var r = rec(id); if (!r) return;
      B.startTimer(id, r.minutes || 20);
      if (S.mode === 'remind') S.mode = 'main';
    },
    stopTimer: function () { confirmBox('Stop the timer?', 'The task will not count as done.', 'Stop timer', function () { B.stopTimer(); }); },
    stopAll: function () {
      confirmBox('⛔ Stop Scaffold everywhere?', 'Every device goes back to normal: no locks, no pop-ups, no reminders, no notes. It stays off until you press Resume.', 'Stop everything', function () {
        apply(E.opPause(true, by(), now()));
      }, true);
    },
    resume: function () { apply(E.opPause(false, by(), now())); toast('▶️ Scaffold is back on'); },
    whatsapp: function () { B.openWhatsApp(); },
    dialer: function () { B.openDialer(); },
    openApp: function (pkg) { B.openApp(pkg); },
    close: function () { B.closeWindow(); },
    nav: function (v) { S.view = v; S.project = ''; try { localStorage.setItem('scaffold-view', v); } catch (e) {} render(); window.scrollTo(0, 0); },
    editHabit: function (id) { openHabitEditor(id && S.state.tasks[id] ? JSON.parse(JSON.stringify(S.state.tasks[id])) : null); },
    template: function (i) { openHabitEditor(Object.assign({}, TEMPLATES[i])); },
    toggleHabit: function (id) { var h = S.state.tasks[id]; if (!h) return; var c = JSON.parse(JSON.stringify(h)); c.active = h.active === false; apply(E.opPut('tasks', c, by(), now())); toast(c.active ? '▶️ Habit on' : '⏸ Habit paused'); },
    editTodo: function (id, k) { openTodoEditor(id && S.state.todos[id] ? JSON.parse(JSON.stringify(S.state.todos[id])) : (k ? JSON.parse(k) : null)); },
    editProject: function (id) { openProjectEditor(id && S.state.projects[id] ? JSON.parse(JSON.stringify(S.state.projects[id])) : null); },
    openProject: function (id) { S.project = id; render(); window.scrollTo(0, 0); },
    backProjects: function () { S.project = ''; render(); },
    bringIn: function (key) {
      var vp = E.vaultProjects(S.state).filter(function (p) { return p.key === key; })[0]; if (!vp) return;
      var id = 'p_' + key;
      apply(E.opPut('projects', { id: id, name: vp.name, emoji: '🗂️', color: COLORS[Math.abs(hash(key)) % COLORS.length], vault: key, vaultPath: vp.path }, by(), now()));
      S.project = id; render(); toast('🗂️ ' + vp.name + ' is in Scaffold');
    },
    vaultTask: function (idx) {
      var p = S.state.projects[S.project], vp = p && vaultOf(p); if (!vp) return;
      var text = vp.items[+idx];
      openTodoEditor({ title: cleanItem(text), project: p.id, vault: { key: p.vault, path: vp.path, item: text }, emoji: '🎯', color: p.color });
    },
    editNote: function (id) { openNoteEditor(id && S.state.notes[id] ? JSON.parse(JSON.stringify(S.state.notes[id])) : null); },
    toggleNote: function (id) { var n = S.state.notes[id]; if (!n) return; var c = JSON.parse(JSON.stringify(n)); c.active = n.active === false; if (c.active) c.anchor = now(); apply(E.opPut('notes', c, by(), now())); },
    noteEdit: function (id) { S.noteEdit = id; render(); },
    noteEditCancel: function () { S.noteEdit = null; S.noteRte = null; render(); },
    noteEditSave: function (id) {
      var n = S.state.notes[id], rte = S.noteRte; if (!n || !rte) return;
      var text = rte.value();
      if (!E.plainNote(text).trim()) return toast('The note is empty');
      var c = JSON.parse(JSON.stringify(n)); c.anchor = c.anchor || c.ts; c.text = text;
      S.noteEdit = null; S.noteRte = null;
      apply(E.opPut('notes', c, by(), now())); render(); toast('Saved');
    },
    tickNote: function (id, line) { var n = S.state.notes[id]; if (!n) return; var c = JSON.parse(JSON.stringify(n)); c.anchor = c.anchor || c.ts; c.text = noteTick(c.text, +line); apply(E.opPut('notes', c, by(), now())); },
    dismissNote: function (id) { apply(E.opAck(id, by(), now())); delete S.noteSeen[id]; if (S.mode === 'note' && !E.pendingNotes(S.state, now()).filter(function (n) { return n.id !== id; }).length) B.closeWindow(); },
    calPrev: function () { calMove(-1); },
    calNext: function () { calMove(1); },
    calToday: function () { S.calDay = null; S.calScroll = null; if (calView() === 'range') { S.calRange = { from: E.dateKey(now()), n: calRange().n }; saveRange(); } render(); },
    calPick: function (key) { S.calDay = key; S.calView = 'day'; lsSet('scaffold-calview', 'day'); render(); },
    calView: function (v) { if (v === 'range' && !calRange()) return; if (v !== 'range' && calView() === 'range') S.calDay = calRange().from; S.calView = v; lsSet('scaffold-calview', v); render(); },
    calCals: function () { openCalendars(); },
    calJump: function (key) {
      if (S.mmDragged && Date.now() - S.mmDragged < 400) return;
      if (calView() === 'range') { S.calRange = { from: key, n: calRange().n }; saveRange(); }
      S.calDay = key; S.miniMonth = null; render();
    },
    miniPrev: function () { var m = S.miniMonth; S.miniMonth = new Date(m.getFullYear(), m.getMonth() - 1, 1); render(); },
    miniNext: function () { var m = S.miniMonth; S.miniMonth = new Date(m.getFullYear(), m.getMonth() + 1, 1); render(); },
    calShow: function (el) { apply(E.opPut('marks', { id: 'cal:' + el.getAttribute('data-id'), hidden: !el.checked }, by(), now())); },
    calMode: function (m) { S.calList = m === 'list'; lsSet('scaffold-callist', S.calList ? '1' : '0'); render(); },
    editEvent: function (id) {
      var all = E.eventsFor(S.state), e = id && all[id] ? JSON.parse(JSON.stringify(all[id])) : null;
      if (e && e.virt) e = JSON.parse(JSON.stringify(S.state.events[e.virt]));   // not on Google yet: edit the whole series
      if (e) { delete e.synced; delete e.gupd; }
      openEventEditor(e);
    },
    period: function (kid) {
      var i = kid.indexOf(':'), k = kid.slice(0, i), id = kid.slice(i + 1);
      var bl = myBlocks(k, id).filter(function (b) { return b.end > now(); });
      if (!bl.length) return newPeriod(k, id);
      S.calHi = { k: k, id: id }; S.view = 'calendar'; S.project = '';
      S.calDay = E.dateKey(bl[0].start); S.calScroll = Math.max(0, (new Date(bl[0].start).getHours() - 1) * HOUR_PX);
      if (calView() !== 'week' && calView() !== 'day') { S.calView = 'week'; lsSet('scaffold-calview', 'week'); }
      closeModal(); window.scrollTo(0, 0);
    },
    addPeriod: function () { if (S.calHi) newPeriod(S.calHi.k, S.calHi.id); },
    hiOff: function () { S.calHi = null; render(); },
    sessEnd: function (key) { sessPut(key, { done: now() }); toast('⏹ Session ended'); if (S.modalOpen) closeModal(); },
    sessConclude: function (key, id) { concludeTask(id); sessPut(key, { done: now() }); toast('✅ Task concluded'); if (S.modalOpen) closeModal(); },
    sessHabit: function (key, id) { apply(E.opComplete(id, 'full', by(), now(), S.state)); sessPut(key, { done: now() }); toast('✅ Done for today'); if (S.modalOpen) closeModal(); },
    sessTick: function (key, id) { concludeTask(id); toast('✅ Task concluded'); if (S.modalOpen) closeModal(); },
    sessAdd: function (key, pid) {
      var have = ((S.state.sess || {})[key] || {}).tasks || [];
      pickTasks('Add tasks to this session', openTasksOf(pid).filter(function (t) { return have.indexOf(t.id) < 0; }), function (ids) { sessPut(key, { tasks: have.concat(ids) }); if (S.modalOpen) closeModal(); });
    },
    editMode: function (id) { openModeEditor(id && S.state.modes[id] ? JSON.parse(JSON.stringify(S.state.modes[id])) : null); },
    editUnblock: function (id) { openUnblockEditor(id); },
    modeOn: function (id) { if (S.act && S.act.src !== 'manual') return toast('A mode from an event or a deadline lock is on'); turnOnBox(id); },
    modeOff: function () { if (!S.act || S.act.src !== 'manual') return; apply(E.opPut('cfg', { id: 'modeOn', mode: '', at: now(), until: 0 }, by(), now())); toast('Mode off'); },
    modeChip: function () {
      var a = S.act; if (!a) return;
      if (a.src !== 'manual') return toast(a.src === 'lock' ? 'Do the task to end the lock' : 'Only ⛔ Emergency stop ends an event’s mode early');
      confirmBox('Turn off ' + a.mode.name + ' Mode?', 'You turned it on by hand, so you can turn it off.', 'Turn off', function () { A.modeOff(); });
    },
    guardAct: function (what, id) { B.guard(what, id); },
    perm: function (n) { B.openPermission(n); },
    test: function (k) {
      if (k === 'lock') {
        var d = new Date(); d.setSeconds(0, 0);
        apply(E.opTask({ title: 'Test lock: tap “I did it”', emoji: '🧪', dueOn: true, due: hm(d), rfrom: hm(d), rto: hm(d), days: [d.getDay()], push: 'nag', lock: true, kind: 'check', remind: 30, color: '#ff7a90', test: true }, by(), now()));
        toast('🧪 Test lock sent to all devices');
      } else if (k === 'remind') {
        var p = { log: {} }; p.log[E.uid()] = { type: 'test-remind', ts: now(), by: by() };
        apply(p); toast('🧪 Test reminder sent to all devices');
      } else { if (k === 'update') { S.updClick = now(); S.updShow = 0; S.updStale = 0; paintUpd(); } B.test(k); }
    },
    copyCode: function () { copy(S.local.syncCode); },
    newCode: function () {
      var a = new Uint32Array(5); crypto.getRandomValues(a);
      var code = [0, 1, 2, 3].map(function (i) { return WORDS[a[i] % WORDS.length]; }).join('-') + '-' + (1000 + a[4] % 9000);
      B.setLocal('syncCode', JSON.stringify(code));
    },
    joinCode: function () {
      var v = (document.getElementById('join-code').value || '').trim().toLowerCase().replace(/\s+/g, '-');
      if (!/^[a-z]+(-[a-z]+){3}-\d{4}$/.test(v)) return toast('Codes look like: maple-otter-quartz-river-1234');
      B.setLocal('syncCode', JSON.stringify(v)); toast('🔗 Joined');
    },
    leaveSync: function () { confirmBox('Disconnect sync?', 'This device keeps its data but stops syncing.', 'Disconnect', function () { B.setLocal('syncCode', '""'); }); },
    saveName: function () { B.setLocal('deviceName', JSON.stringify(document.getElementById('dev-name').value.trim() || 'Device')); toast('Saved'); },
    saveBlocklist: function () {
      var list = document.getElementById('blocklist').value.split(/[,\n]/).map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
      B.setLocal('blocklist', JSON.stringify(list)); toast('Saved');
    },
    autostart: function (el) { B.setLocal('autostart', JSON.stringify(el.checked)); },
    saveVault: function () { B.setLocal('vaultPath', JSON.stringify(document.getElementById('vault-path').value.trim())); toast('Looking for your projects…'); },
    copyScript: function () { copy(window.GCAL_SCRIPT.replace('__SECRET__', S.local.calSecret || '')); },
    saveFb: function () {
      var v = document.getElementById('fb-url').value.trim().replace(/\/+$/, '');
      if (v && !/^https:\/\/[\w.-]+\.(firebaseio\.com|firebasedatabase\.app)$/.test(v)) return toast('Paste the database URL, like https://name-default-rtdb.firebaseio.com');
      apply(E.opPut('cfg', { id: 'fb', url: v }, by(), now())); toast(v ? '⚡ Instant sync on: every device gets it in a moment' : 'Instant sync off');
    },
    saveCal: function () {
      var v = document.getElementById('cal-url').value.trim();
      if (v && !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(v)) return toast('Paste the Web app URL ending in /exec');
      B.setLocal('calUrl', JSON.stringify(v)); toast(v ? '📅 Connecting…' : 'Disconnected');
    }
  };
  function hash(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }
  function copy(text) { try { navigator.clipboard.writeText(text); toast('Copied'); } catch (e) { toast('Could not copy'); } }
  function cleanItem(t) { return String(t).replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, function (_, a, b) { return b || a; }).replace(/#\w+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80); }
  function vaultOf(p) { return p && p.vault ? E.vaultProjects(S.state).filter(function (v) { return v.key === p.vault; })[0] : null; }

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-a]'); if (!el || el.disabled) return;
    // A lock or reminder that just popped up ignores clicks for a moment: a click meant for something else must not dismiss it.
    if (S.guardUntil > Date.now() && el.closest('.block, .remind') && /^(done|snooze|timer)$/.test(el.getAttribute('data-a'))) { e.preventDefault(); return; }
    var fn = A[el.getAttribute('data-a')];
    if (fn) { e.preventDefault(); e.stopPropagation(); fn(el.getAttribute('data-id'), el.getAttribute('data-k'), el); }
  });
  document.addEventListener('change', function (e) {
    var el = e.target.closest('[data-change]'); if (el && A[el.getAttribute('data-change')]) A[el.getAttribute('data-change')](el);
  });

  // ---------- render ----------
  function render() {
    load();
    document.body.className = 'p-' + PLATFORM + ' m-' + S.mode;
    var notes = S.r.notes;
    if (notes.length && (S.mode === 'note' || PLATFORM === 'android')) return paint(noteView(notes[0], notes.length));
    if (S.mode === 'note') return B.closeWindow();
    var timer = S.local.timer;
    if (timer && timer.endsAt > now()) return paint(timerView(timer));
    var lockHere = S.r.lock && !S.r.paused;
    if (lockHere) return paint(blockView(S.r.lock));
    if (S.mode === 'closeprog') return paint(closeProgView());
    if (S.mode === 'block') { S.mode = 'main'; if (PLATFORM === 'desktop') return B.closeWindow(); }
    if (S.mode === 'remind') {
      var it = item(S.modeTask);
      if (it && !it.done && !S.r.paused) return paint(remindView(it));
      return B.closeWindow();
    }
    paint(shell());
  }
  var appsSent = false;
  function paint(html) {
    if (!appsSent && S.mode === 'main' && S.state) { appsSent = true; setTimeout(function () { try { publishAndroidApps(); } catch (e) {} }, 3000); }
    var full = /^<section class="(block|remind)/.exec(html), key = full ? full[1] + (S.r.lock ? S.r.lock.id : S.modeTask) : '';
    if (key && key !== S.guardKey) { S.guardUntil = Date.now() + 1500; S.guardKey = key; } else if (!key) S.guardKey = '';
    $app.innerHTML = html; tick(); wireTimeline(); wireMini();
    var ne = $app.querySelector('.note-edit .rte'); if (ne) { S.noteRte = wireRte(ne, $app.querySelector('.note-edit .rte-bar')); ne.focus(); }
  }

  function shell() {
    var views = { today: todayView, calendar: calendarView, tasks: tasksView, habits: habitsView, notes: notesView, modes: modesView, settings: settingsView };
    var tabs = [['today', '☀️', 'Today'], ['calendar', '📅', 'Calendar'], ['tasks', '✅', 'Tasks'], ['habits', '🔁', 'Habits'], ['notes', '📌', 'Notes'], ['modes', '🛡️', 'Modes']];
    var nav = tabs.map(function (t) { return '<button class="tab' + (S.view === t[0] ? ' on' : '') + '" data-a="nav" data-id="' + t[0] + '"><span>' + t[1] + '</span>' + t[2] + '</button>'; }).join('');
    return '<header class="top">' +
      '<div class="brand"><span class="logo">▦</span> Scaffold</div><div class="top-r">' +
      modeChip() + (S.r.paused ? '<button class="pill go" data-a="resume">▶ Resume</button>' : '<button class="pill stop" data-a="stopAll">⛔ Stop all</button>') +
      '<button class="gear' + (S.view === 'settings' ? ' on' : '') + '" data-a="nav" data-id="settings" title="Settings">⚙️</button></div>' +
      '</header>' +
      (S.r.lock && !S.r.paused ? '<div class="banner lockb">🔒 <b>' + esc(S.r.lock.task.title) + '</b> is overdue: ' + 'every device is in ' + esc(lockModeName(S.r.lock.task)) + ' Mode' + ' until it is done.</div>' : '') +
      (S.r.notes.length && PLATFORM !== 'android' ? '<div class="banner noteb">📌 ' + S.r.notes.length + ' note' + (S.r.notes.length > 1 ? 's' : '') + ' waiting: ' + esc(E.plainNote(S.r.notes[0].note.text).split('\n')[0].slice(0, 60)) + '</div>' : '') +
      (S.r.paused ? '<div class="banner">Scaffold is <b>OFF on every device</b>. Nothing will lock or pop up until you press Resume.</div>' : '') +
      '<main class="view">' + views[S.view]() + '</main>' +
      '<nav class="tabs">' + nav + '</nav>';
  }

  function ring(frac, size, stroke, color, inner) {
    var r = (size - stroke) / 2, c = 2 * Math.PI * r, off = c * (1 - Math.max(0, Math.min(1, frac || 0)));
    return '<div class="ring" style="width:' + size + 'px;height:' + size + 'px">' +
      '<svg viewBox="0 0 ' + size + ' ' + size + '"><circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" stroke-width="' + stroke + '" class="ring-bg"/>' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" stroke-width="' + stroke + '" stroke="' + color + '" stroke-dasharray="' + c + '" stroke-dashoffset="' + off + '" class="ring-fg" transform="rotate(-90 ' + size / 2 + ' ' + size / 2 + ')"/></svg>' +
      '<div class="ring-in">' + inner + '</div></div>';
  }
  function pctColor(p) { return p == null ? '#7c9cff' : p >= 80 ? '#5ed3a8' : p >= 50 ? '#ffb86b' : '#ff7a90'; }

  // ---------- Today ----------
  function todayView() {
    var r = S.r, st = E.stats(S.state, now(), 7);
    if (!live('tasks').length && !live('todos').length) return welcome();
    var pct = st.week == null ? null : Math.round(st.week * 100);
    var isLater = function (i) { return i.type === 'todo' && !i.done && i.status !== 'late' && (i.future || !i.hasDue); };
    var todayItems = r.items.filter(function (i) { return !isLater(i); }), later = r.items.filter(isLater);
    var sessions = blocksNow().map(sessionCard).join('');
    var next = todayItems.filter(function (i) { return !i.done; })[0];
    var hero = '<section class="hero">' +
      ring(pct == null ? 0 : pct / 100, 132, 12, pctColor(pct), '<b>' + (pct == null ? '–' : pct + '%') + '</b><small>habits · 7d</small>') +
      '<div class="hero-txt"><div class="big">' + r.done + ' / ' + r.total + ' <span>done</span></div>' +
      '<div class="goal">Goal: <b>80%</b> of habits, every week</div>' +
      (next ? '<div class="next">Next: ' + esc(next.task.emoji) + ' <b>' + esc(next.task.title) + '</b> · ' + (next.status === 'late' ? '<span class="late-t">late</span>' : next.hasDue ? '<span data-left="' + next.due + '"></span> left' : 'today') + '</div>' : (r.total ? '<div class="next good">Everything done today 🎉</div>' : '')) +
      '</div></section>';
    var pending = function (list) { return list.filter(function (i) { return !i.done; }).concat(list.filter(function (i) { return i.done; })); };
    return hero + '<section class="today-cal">' + calTimeline([E.dateKey(now())], true) + '</section>' +
      '<section class="cards">' + sessions + (todayItems.length ? pending(todayItems).map(card).join('') : sessions ? '' : '<p class="empty">Nothing due today. Enjoy it.</p>') + '</section>' +
      (later.length ? '<h3 class="mt">Due later or no deadline</h3><section class="cards">' + later.map(card).join('') + '</section>' : '');
  }

  function welcome() {
    return '<section class="welcome"><h1>Hi! 👋</h1><p>Scaffold keeps you on track across your phone, tablet and computers.</p>' +
      '<p><b>🔁 Habits</b>: things you do again and again (every day, on set days, every week…).<br><b>✅ Tasks</b>: done once, with or without a deadline, grouped in projects.<br><b>📌 Notes</b>: thoughts that pop up until you read them.<br><b>📅 Calendar</b>: all of it, plus your Google Calendar.</p>' +
      '<h3>Quick start: a habit</h3><div class="tpl-grid">' + TEMPLATES.map(function (t, i) {
        return '<button class="tpl" data-a="template" data-id="' + i + '" style="--c:' + t.color + '"><span>' + t.emoji + '</span>' + esc(t.title) + '<small>' + pushLabel(t, 'habit') + '</small></button>';
      }).join('') + '</div><div class="row-btns"><button class="btn" data-a="editHabit">＋ Habit</button><button class="btn" data-a="editTodo">＋ Task</button><button class="btn" data-a="editNote">＋ Note</button></div></section>';
  }

  function statusChip(it) {
    if (it.done) return '<span class="chip done">' + (it.doneKind === 'tiny' ? '🌱 tiny win' : '✓ done') + '</span>';
    if (it.locked) return '<span class="chip lock">🔒 locked</span>';
    if (it.snoozedUntil) return '<span class="chip">⏸ until ' + hm(it.snoozedUntil) + '</span>';
    if (it.status === 'late') return '<span class="chip late">late · ' + (it.dueToday ? 'since ' + hm(it.due) : 'was due ' + niceDay(it.deadlineDay)) + '</span>';
    if (it.future) return '<span class="chip">due ' + niceDay(it.deadlineDay) + (it.task.due && it.task.due !== '23:59' ? ' ' + hm(it.due) : '') + '</span>';
    if (!it.hasDue) return '<span class="chip">no deadline</span>';
    if (it.status === 'upcoming') return '<span class="chip">reminders from ' + hm(it.start) + '</span>';
    return '<span class="chip open">⏳ <span data-left="' + it.due + '"></span> left</span>';
  }

  function actions(it, compact) {
    if (it.done) return '<button class="btn ghost sm" data-a="undo" data-id="' + it.id + '">Undo</button>';
    var t = it.task, h = '';
    if (t.kind === 'timer') h += '<button class="btn primary" data-a="timer" data-id="' + it.id + '">▶ Start ' + (t.minutes || 20) + ' min</button>';
    else h += '<button class="btn primary" data-a="done" data-id="' + it.id + '">✓ I did it</button>';
    if (!compact && it.status !== 'upcoming' && (it.push !== 'off' || it.locked) && it.snoozesLeft > 0 && !it.snoozedUntil) h += '<button class="btn ghost sm" data-a="snooze" data-id="' + it.id + '">⏸ ' + E.SNOOZE_MIN + ' min (' + it.snoozesLeft + ' left)</button>';
    return h;
  }

  function card(it) {
    var t = it.task, proj = projectOf(t);
    var frac = it.status === 'late' ? 1 : it.dueToday ? Math.max(0, now() - it.start) / Math.max(1, it.due - it.start) : 0;
    var when = it.dueToday ? 'by ' + hm(it.due) + ' · ' : '';
    return '<article class="card s-' + it.status + (it.done ? ' is-done' : '') + '" style="--c:' + taskColor(t) + '">' +
      '<div class="card-top"><div class="emoji">' + esc(t.emoji || '•') + '</div>' +
      '<div class="card-main"><div class="kind">' + (it.type === 'habit' ? '🔁 Habit' : '✅ Task' + (proj ? ' · ' + esc(proj.emoji || '') + ' ' + esc(proj.name) : '')) + '</div><h3>' + esc(t.title) + '</h3><div class="meta">' + when + pushLabel(t, it.type) + (t.kind === 'timer' ? ' · ⏱ ' + (t.minutes || 20) + ' min' : '') + '</div>' +
      statusChip(it) + '</div>' + (it.done ? '' : periodSquare(it.type, it.id, t)) + '</div>' +
      (!it.done && it.dueToday ? '<div class="time-bar"><i style="width:' + Math.round(frac * 100) + '%"></i></div>' : '') +
      '<div class="card-actions">' + actions(it) + '</div></article>';
  }


  // ---------- designated periods (events linked to a task, habit or project) and their sessions ----------
  function allBlocks() { if (!S.lb) S.lb = E.linkedBlocks(S.state, now() - E.DAY, now() + 120 * E.DAY); return S.lb; }
  function blockMatch(b, k, id) {
    if (b.link.k === k && b.link.id === id) return true;
    var td = k === 'todo' && (S.state.todos || {})[id];
    return !!(td && b.link.k === 'project' && b.link.id === td.project && (b.tasks || []).indexOf(id) >= 0);
  }
  function myBlocks(k, id) { return allBlocks().filter(function (b) { return blockMatch(b, k, id); }); }
  function linkRec(L) { var m = { todo: 'todos', habit: 'tasks', project: 'projects' }[L.k]; var r = m && (S.state[m] || {})[L.id]; return r && !r.del ? r : null; }
  function blocksNow() { var n = now(); return allBlocks().filter(function (b) { return b.start <= n && b.end > n && !b.done && linkRec(b.link); }); }
  // The square next to a task or habit: dotted and empty when it has no time blocks, else its next session.
  function periodSquare(k, id, t) {
    var bl = myBlocks(k, id).filter(function (b) { return b.end > now() && !b.done; }), nx = bl[0], kid = k + ':' + id;
    if (!nx) return '<button class="psq" data-a="period" data-id="' + esc(kid) + '" title="Designate a time period"></button>';
    var d = new Date(nx.start), diff = Math.round((E.fromKey(E.dateKey(nx.start)) - E.fromKey(E.dateKey(now()))) / E.DAY);
    var day = nx.start <= now() ? 'Now' : diff === 0 ? 'Today' : diff < 7 ? DAYNAMES[d.getDay()] : d.getDate() + ' ' + MONTHS[d.getMonth()].slice(0, 3);
    var rep = !!(nx.e.rrule || nx.e.series || nx.e.virt);
    return '<button class="psq on" data-a="period" data-id="' + esc(kid) + '" style="--c:' + taskColor(t) + ';--ink:' + inkOn(taskColor(t)) + '" title="' + bl.length + ' time block' + (bl.length > 1 ? 's' : '') + '"><b>' + day + '</b><small>' + (nx.start <= now() ? 'until ' + hm(nx.end) : hm(nx.start)) + '</small>' + (rep ? '<i>↻</i>' : '') + '</button>';
  }
  // Session buttons, on the Today card while the block runs and in the event's pop-up.
  function sessionControls(b) {
    var L = b.link, r = linkRec(L), key = esc(b.key); if (!r) return '';
    var done = function (id) { var c = (S.state.comps || {})[E.itemKey(S.state, id, now())]; return !!(c && !c.undone); };
    var end = b.done ? '<span class="chip done">✓ Session ended</span>' : '<button type="button" class="btn ghost sm" data-a="sessEnd" data-id="' + key + '">⏹ End Session</button>';
    if (L.k === 'todo') return '<div class="sess-acts">' + end + (done(L.id) ? '<span class="chip done">✓ Task concluded</span>' : '<button type="button" class="btn primary sm" data-a="sessConclude" data-id="' + key + '" data-k="' + esc(L.id) + '">✓ Task Concluded</button>') + '</div>';
    if (L.k === 'habit') return '<div class="sess-acts">' + end + (done(L.id) ? '<span class="chip done">✓ Done for today</span>' : '<button type="button" class="btn primary sm" data-a="sessHabit" data-id="' + key + '" data-k="' + esc(L.id) + '">✓ Done for today</button>') + '</div>';
    var ts = (b.tasks || []).filter(function (id) { var t = (S.state.todos || {})[id]; return t && !t.del; }), all = ts.every(done);
    return '<div class="sess-tasks">' + (ts.length ? ts.map(function (id) {
        var t = S.state.todos[id];
        return done(id) ? '<span class="st dn">☑ ' + esc(t.title) + '</span>' : '<button type="button" class="st" data-a="sessTick" data-id="' + key + '" data-k="' + esc(id) + '">☐ ' + esc(t.title) + '</button>';
      }).join('') : '<span class="muted">No tasks picked for this session.</span>') + '</div>' +
      '<div class="sess-acts">' + end + (all ? '<button type="button" class="btn sm" data-a="sessAdd" data-id="' + key + '" data-k="' + esc(L.id) + '">＋ Add tasks</button>' : '') + '</div>';
  }
  function sessionCard(b) {
    var r = linkRec(b.link);
    return '<article class="card sess" style="--c:' + taskColor(r) + '"><div class="card-top"><div class="emoji">' + esc(r.emoji || '🗂️') + '</div><div class="card-main">' +
      '<div class="kind">🟢 Session now · ' + hm(b.start) + '–' + hm(b.end) + '</div><h3>' + esc(r.title || r.name) + '</h3><div class="meta">' + esc(b.e.title) + '</div></div></div>' +
      '<div class="card-actions">' + sessionControls(b) + '</div></article>';
  }
  function hiBar() {
    var hi = S.calHi, r = hi && linkRec(hi); if (!r) return '';
    return '<div class="hi-bar" style="--c:' + taskColor(r) + '"><span>Time blocks of <b>' + esc((r.emoji ? r.emoji + ' ' : '') + (r.title || r.name)) + '</b></span><span class="sp"></span>' +
      '<button class="btn sm" data-a="addPeriod">＋ Add period</button><button class="btn ghost sm" data-a="hiOff">✕</button></div>';
  }
  function newPeriod(k, id) {
    var r = linkRec({ k: k, id: id }); if (!r) return;
    var s0 = Math.ceil((now() + 1) / 3600000) * 3600000;
    openEventEditor({ title: r.title || r.name, link: { k: k, id: id }, allDay: false, start: s0, end: s0 + 3600000 });
  }
  function sessPut(key, ch) { var o = JSON.parse(JSON.stringify((S.state.sess || {})[key] || {})); delete o.ts; delete o.by; o.id = key; for (var f in ch) o[f] = ch[f]; apply(E.opPut('sess', o, by(), now())); }
  // "Task Concluded": the task is done and its later time blocks go (a repeating one is cut where the next block would be).
  function concludeTask(id) {
    apply(E.opComplete(id, 'full', by(), now(), S.state));
    var later = E.blocksFor(S.state, 'todo', id, now(), now() + 400 * E.DAY).filter(function (b) { return !b.via && b.start > now(); }), seen = {};
    later.forEach(function (b) {
      var e = b.e, g = e.virt || (e.rrule && !e.series ? e.id : '') ? 'v:' + (e.virt || e.id) : e.series ? 's:' + e.series : 'i:' + e.id;
      if (seen[g]) return; seen[g] = 1;
      if (g.charAt(0) === 'v') {   // still only in Scaffold: end the repeat the day before
        var base = S.state.events[e.virt || e.id]; if (!base) return;
        if (base.start > now()) return apply(E.opDel('events', base, by(), now()));
        var rr = E.parseRule(base.rrule); if (!rr || !rr.simple) return;
        var c0 = JSON.parse(JSON.stringify(base)); c0.rrule = E.buildRule({ freq: rr.freq, days: rr.days, count: 0, until: E.dateKey(E.addDays(e.start, -1)) }, c0.allDay);
        return apply(E.opPut('events', c0, by(), now()));
      }
      var c = JSON.parse(JSON.stringify(e)); delete c.synced; delete c.gupd;
      if (e.series) c.scope = 'following';
      apply(E.opDel('events', c, by(), now()));
    });
  }
  function pickTasks(title, list, fn) {
    var el = document.createElement('div');
    el.className = 'modal-bg top-layer';
    el.innerHTML = '<div class="modal small"><h2>' + esc(title) + '</h2>' + (list.length ? '<div class="apps">' + list.map(function (t) { return '<label class="check sm"><input type="checkbox" value="' + esc(t.id) + '"> ' + esc((t.emoji || '') + ' ' + t.title) + '</label>'; }).join('') + '</div>' : '<p class="muted">No other open tasks in this project.</p>') +
      '<div class="modal-actions"><span class="sp"></span><button class="btn ghost" data-no>Cancel</button><button class="btn primary" data-yes>Add</button></div></div>';
    document.body.appendChild(el);
    el.addEventListener('click', function (e) {
      if (e.target.closest('[data-yes]')) { var ids = [].map.call(el.querySelectorAll('input:checked'), function (x) { return x.value; }); el.remove(); if (ids.length) fn(ids); }
      else if (e.target.closest('[data-no]') || e.target === el) el.remove();
    });
  }
  function openTasksOf(pid) { return live('todos').filter(function (t) { var c = (S.state.comps || {})[E.itemKey(S.state, t.id, now())]; return t.project === pid && (t.repeat || 'none') === 'none' && !(c && !c.undone); }); }

  // ---------- full-screen modes ----------
  function blockView(it) {
    var t = it.task, isLate = now() >= it.due;
    return '<section class="block" style="--c:' + taskColor(t) + '">' +
      '<div class="block-emoji">' + esc(t.emoji || '🔒') + '</div>' +
      '<div class="block-kicker">🔒 Your devices are locked until you do this</div>' +
      '<h1>' + esc(t.title) + '</h1>' + descBox(t) +
      '<div class="block-sub">' + (isLate ? 'Deadline was ' + hm(it.due) + ' · <span data-ago="' + it.due + '"></span> ago' : 'Due ' + hm(it.due)) + '</div>' +
      '<div class="block-actions">' + actions(it) + '</div>' +
      '<div class="block-foot"><button class="btn wa" data-a="whatsapp">💬 WhatsApp</button>' + lockApps(t) +
      '<button class="link" data-a="stopAll">Emergency stop (all devices)</button></div></section>';
  }
  // Phone: the home screen is covered during a lock, so the allowed apps open from here.
  var appNames = null;
  function lockApps(t) {
    if (PLATFORM !== 'android') return '';
    if (!appNames) { appNames = {}; listApps().forEach(function (a) { appNames[a.pkg] = a.label; }); }
    var ub = E.unblockOf(S.state, myDev()) || androidPreset();
    return '<button class="btn wa" data-a="dialer">📞 Phone</button>' + (ub.apps || []).filter(function (p) { return appNames[p] && !/whatsapp|com\.scaffold/.test(p); }).map(function (p) {
      return '<button class="btn wa" data-a="openApp" data-id="' + esc(p) + '">' + esc(appNames[p]) + '</button>';
    }).join('');
  }

  function remindView(it) {
    var t = it.task;
    var when = it.status === 'late' ? 'Late · deadline was ' + (it.dueToday ? '' : niceDay(it.deadlineDay) + ' ') + hm(it.due) : !it.hasDue ? 'No deadline' : it.future ? 'Due ' + niceDay(it.deadlineDay) + ' ' + hm(it.due) : 'Due ' + hm(it.due) + ' · <span data-left="' + it.due + '"></span> left';
    var lockWarn = (E.lockOf(t) && it.hasDue && it.status !== 'late') ? '<div class="warn">🔒 Devices lock at ' + hm(it.due) + (it.future ? ' on ' + niceDay(it.deadlineDay) : '') + ' if this is not done.</div>' : '';
    return '<section class="remind" style="--c:' + taskColor(t) + '"><div class="remind-emoji">' + esc(t.emoji) + '</div>' +
      '<h2>' + esc(t.title) + '</h2>' + descBox(t) + '<div class="remind-sub">' + when + '</div>' + lockWarn +
      '<div class="remind-actions">' + actions(it) + '<button class="btn ghost sm" data-a="close">Later</button></div></section>';
  }

  function noteView(p, count) {
    var n = p.note, key = p.id + '@' + p.since;
    if (!S.noteSeen[p.id] || S.noteSeen[p.id].key !== key) S.noteSeen[p.id] = { key: key, at: now() };
    var hold = Math.max(0, +n.hold || 0) * 1000, until = S.noteSeen[p.id].at + hold;
    var edit = S.noteEdit === p.id, locked = until > now();
    return '<section class="note-pop" style="--c:' + taskColor(n) + '"><div class="note-kicker">📌 Note' + (count > 1 ? ' · 1 of ' + count : '') + '</div>' +
      (edit
        ? '<div class="note-text note-edit">' + rteBar() + '<div class="rte md" contenteditable="true" spellcheck="true" data-ph="Write the note">' + mdHtml(n.text) + '</div></div>' +
          '<div class="note-btns"><button class="btn ghost" data-a="noteEditCancel">Cancel</button><button class="btn primary" data-a="noteEditSave" data-id="' + p.id + '">Save</button></div>'
        : '<div class="note-text md">' + mdHtml(n.text, p.id) + '</div>' +
          '<div class="note-meta">Comes back every ' + everyLabel(n.every) + '</div>' +
          '<div class="note-btns"><button class="btn ghost big" data-a="noteEdit" data-id="' + p.id + '" data-hold="' + until + '" data-done="✏️ Edit"' + (locked ? ' disabled' : '') + '>✏️ Edit</button>' +
          '<button class="btn primary big" data-a="dismissNote" data-id="' + p.id + '" data-hold="' + until + '"' + (locked ? ' disabled' : '') + '>' + (locked ? 'Read it… <span data-holdleft="' + until + '"></span>' : 'Got it') + '</button></div>') +
      '<div class="block-foot"><button class="link" data-a="stopAll">Emergency stop (all devices)</button></div></section>';
  }
  function everyLabel(m) { m = +m || 60; return m % 1440 === 0 ? (m / 1440 === 1 ? 'day' : m / 1440 + ' days') : m % 60 === 0 ? (m / 60 === 1 ? 'hour' : m / 60 + ' hours') : m + ' min'; }

  function timerView(timer) {
    var t = rec(timer.taskId) || { title: 'Focus', emoji: '⏱' };
    var total = (timer.minutes || t.minutes || 20) * 60000, left = timer.endsAt - now();
    return '<section class="timer" style="--c:' + taskColor(t) + '">' +
      '<div class="timer-kicker">' + esc(t.emoji) + ' ' + esc(t.title) + '</div>' +
      ring(1 - left / total, 260, 16, taskColor(t), '<b data-clock="' + timer.endsAt + '">' + clock(left) + '</b><small>left</small>') +
      '<p class="timer-hint">Keep going. It counts as done when the timer ends.</p>' +
      '<div class="block-foot"><button class="btn wa" data-a="whatsapp">💬 WhatsApp</button><button class="link" data-a="stopTimer">Stop timer</button></div></section>';
  }

  // ---------- Calendar ----------
  // ---------- Calendar: month / week / day ----------
  // The anchor day (S.calDay) drives every view; ‹ › move it by a month, week or day.
  var HOUR_PX = 44, EV_COLOR = '#5cc8ff';
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function calView() { var v = S.calView || lsGet('scaffold-calview') || 'month'; return v === 'range' && !calRange() ? 'week' : v; }
  // Custom range picked by dragging on the mini month: up to 7 days = columns, more = whole weeks in a month-style grid.
  function calRange() { if (S.calRange === undefined) { try { S.calRange = JSON.parse(lsGet('scaffold-calrange') || 'null'); } catch (e) { S.calRange = null; } } return S.calRange && S.calRange.from && S.calRange.n > 0 ? S.calRange : null; }
  function saveRange() { lsSet('scaffold-calrange', JSON.stringify(S.calRange)); }
  function rangeKeys(rg) { var ks = []; for (var i = 0; i < rg.n; i++) ks.push(E.dateKey(E.addDays(E.fromKey(rg.from), i))); return ks; }
  function shortDay(k) { var d = new Date(E.fromKey(k)); return MONTHS[d.getMonth()].slice(0, 3) + ' ' + d.getDate(); }
  function calList() { return S.calList != null ? S.calList : lsGet('scaffold-callist') === '1'; }
  function calAnchor() { return calView() === 'range' ? calRange().from : S.calDay || E.dateKey(now()); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function weekStart(key) { var t = E.fromKey(key); return E.addDays(t, -new Date(t).getDay()); }   // weeks run Sunday → Saturday
  // "Show in monthly" lives in state.marks (events from Google can't carry it); repeating Google events share one mark.
  function markKey(e) { return e.series ? 'gid:' + e.series : e.ro && e.gid ? 'gid:' + e.gid : e.virt || e.id; }
  // Google calendars and colors (bridge v2). Hidden calendars are hidden on every device (marks 'cal:'+id).
  // Google's API still sends its old palette; these are the colors Google Calendar shows today.
  var GCOLORS = { 1: '#7986cb', 2: '#33b679', 3: '#8e24aa', 4: '#e67c73', 5: '#f6bf26', 6: '#f4511e', 7: '#039be5', 8: '#616161', 9: '#3f51b5', 10: '#0b8043', 11: '#d50000' };
  var CAL_COLORS = { '#ac725e': '#795548', '#d06b64': '#e67c73', '#f83a22': '#d50000', '#fa573c': '#f4511e', '#ff7537': '#ef6c00', '#ffad46': '#f09300', '#42d692': '#009688', '#16a765': '#0b8043',
    '#7bd148': '#7cb342', '#b3dc6c': '#c0ca33', '#fbe983': '#e4c441', '#fad165': '#f6bf26', '#92e1c0': '#33b679', '#9fe1e7': '#039be5', '#9fc6e7': '#4285f4', '#4986e7': '#3f51b5',
    '#9a9cff': '#7986cb', '#b99aff': '#b39ddb', '#c2c2c2': '#616161', '#cabdbf': '#a79b8e', '#cca6ac': '#ad1457', '#f691b2': '#d81b60', '#cd74e6': '#8e24aa', '#a47ae2': '#9e69af' };
  function calColor(c) { var x = (c && c.color || '').toLowerCase(); return CAL_COLORS[x] || (c && c.color) || EV_COLOR; }
  var GCOLOR_NAMES = { 1: 'Lavender', 2: 'Sage', 3: 'Grape', 4: 'Flamingo', 5: 'Banana', 6: 'Tangerine', 7: 'Peacock', 8: 'Graphite', 9: 'Blueberry', 10: 'Basil', 11: 'Tomato' };
  function gcalInfo() { return ((S.state.gev || {})._cals) || null; }
  function gcals() { var g = gcalInfo(); return g ? g.list || [] : []; }
  function gcal(id) { var l = gcals(); for (var i = 0; i < l.length; i++) if (l[i].id === id || (!id && l[i].primary)) return l[i]; return null; }
  function palette() { return GCOLORS; }
  function calHidden(id) { var c = id || (gcal('') || {}).id; var r = (S.state.marks || {})['cal:' + c]; return !!(r && !r.del && r.hidden); }
  function evColor(e) { if (e.color && GCOLORS[e.color]) return GCOLORS[e.color]; var c = gcal(e.cal || ''); return c ? calColor(c) : EV_COLOR; }
  function inkOn(hex) { var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex || ''); if (!m) return '#0f1117'; var l = (0.299 * parseInt(m[1], 16) + 0.587 * parseInt(m[2], 16) + 0.114 * parseInt(m[3], 16)) / 255; return l > 0.6 ? '#0f1117' : '#ffffff'; }
  function shownAgenda(t) { return E.dayAgenda(S.state, t).filter(function (a) { return a.kind !== 'event' || !calHidden(a.rec.cal); }); }
  function monthlyOn(e) { var m = S.state.marks || {}, r = m[markKey(e)]; return !!(r && !r.del && r.monthly); }

  function calendarView() {
    var v = calView(), key = calAnchor(), d = new Date(E.fromKey(key)), title;
    if (v === 'month') title = MONTHS[d.getMonth()] + ' ' + d.getFullYear();
    else if (v === 'week') {
      var a = new Date(weekStart(key)), b = new Date(E.addDays(weekStart(key), 6));
      title = MONTHS[a.getMonth()].slice(0, 3) + ' ' + a.getDate() + ' – ' + (a.getMonth() !== b.getMonth() ? MONTHS[b.getMonth()].slice(0, 3) + ' ' : '') + b.getDate();
    } else if (v === 'range') {
      var rk = rangeKeys(calRange()), a2 = new Date(E.fromKey(rk[0])), b2 = new Date(E.fromKey(rk[rk.length - 1]));
      title = shortDay(rk[0]) + ' – ' + (a2.getMonth() !== b2.getMonth() ? shortDay(rk[rk.length - 1]) : b2.getDate());
    } else title = cap(niceDay(key)) + (/^(today|tomorrow|yesterday)$/.test(niceDay(key)) ? ' · ' + DAYNAMES[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()].slice(0, 3) : '');
    var seg = function (items, act, cur) { return '<div class="seg">' + items.map(function (x) { return '<button class="seg-b' + (x[0] === cur ? ' on' : '') + '" data-a="' + act + '" data-id="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>'; };
    var body;
    if (v === 'month') body = monthGrid(key);
    else if (v === 'week') { var ks = []; for (var i = 0; i < 7; i++) ks.push(E.dateKey(E.addDays(weekStart(key), i))); body = calTimeline(ks); }
    else if (v === 'range') { var rr = calRange(); body = rr.n <= 7 ? calTimeline(rangeKeys(rr)) : weeksGrid(rangeKeys(rr)); }
    else body = calList() ? dayList(key) : calTimeline([key]);
    var cal = S.local.cal || {};
    return '<div class="cal-layout">' + calSide(v, key) + '<div class="cal-main">' +
      '<div class="sec-head cal-top"><h2>' + esc(title) + '</h2><div class="row-btns"><button class="btn ghost sm" data-a="calPrev">‹</button><button class="btn ghost sm" data-a="calToday">Today</button><button class="btn ghost sm" data-a="calNext">›</button></div></div>' +
      '<div class="cal-bar">' + seg([['month', 'Month'], ['week', 'Week'], ['day', 'Day']].concat(calRange() ? [['range', calRange().n + ' days']] : []), 'calView', v) +
      (v === 'day' ? seg([['cv', 'Timeline'], ['list', 'List']], 'calMode', calList() ? 'list' : 'cv') : '') +
      (gcals().length ? '<button class="btn ghost sm cal-cals-btn" data-a="calCals">Calendars</button>' : '') +
      '<span class="sp"></span><button class="btn primary sm" data-a="editEvent">＋ Event</button></div>' + hiBar() + body +
      '<div class="legend cal-legend">' + (cal.status ? '<span class="lg-note">Google: ' + esc(cal.status) + '</span>' : '<span class="lg-note">Google Calendar: not connected (Settings)</span>') + '</div></div></div>';
  }

  // Wide screens: mini month (today filled, the shown day / week marked; tap = jump there, same view) + calendar checkboxes.
  function calSide(v, key) {
    var today = E.dateKey(now()), a = new Date(E.fromKey(key)), m = S.miniMonth && S.miniKey === key ? S.miniMonth : new Date(a.getFullYear(), a.getMonth(), 1);
    S.miniMonth = m; S.miniKey = key;
    var first = new Date(m.getFullYear(), m.getMonth(), 1, 12), start = E.addDays(first.getTime(), -first.getDay());
    var ws = E.dateKey(weekStart(key)), we = E.dateKey(E.addDays(weekStart(key), 6)), cells = '';
    if (v === 'range') { var rk = rangeKeys(calRange()); ws = rk[0]; we = rk[rk.length - 1]; v = 'week'; }
    for (var i = 0; i < 42; i++) {
      var t = E.addDays(start, i), k = E.dateKey(t), d = new Date(t);
      var inSel = v === 'week' ? k >= ws && k <= we : v === 'day' ? k === key : false;
      cells += '<button class="mm-d' + (d.getMonth() !== m.getMonth() ? ' out' : '') + (k === today ? ' today' : '') + (inSel ? ' sel' : '') + (k === key ? ' anchor' : '') +
        (v === 'week' && k === ws ? ' s0' : '') + (v === 'week' && k === we ? ' s1' : '') + '" data-a="calJump" data-id="' + k + '" data-mm="' + k + '">' + d.getDate() + '</button>';
    }
    var list = gcals(), mine = list.filter(function (c) { return !c.ro; }), other = list.filter(function (c) { return c.ro; });
    var group = function (title, cs) {
      return cs.length ? '<h4>' + title + '</h4>' + cs.map(function (c) {
        return '<label class="cs-c"><input type="checkbox" data-change="calShow" data-id="' + esc(c.id) + '"' + (calHidden(c.id) ? '' : ' checked') + ' style="--c:' + esc(calColor(c)) + '"><span>' + esc(c.name) + '</span></label>';
      }).join('') : '';
    };
    return '<aside class="cal-side"><div class="mm"><div class="mm-h"><b>' + MONTHS[m.getMonth()] + ' ' + m.getFullYear() + '</b><span><button class="mm-n" data-a="miniPrev">‹</button><button class="mm-n" data-a="miniNext">›</button></span></div>' +
      '<div class="mm-g">' + DAYNAMES.map(function (w) { return '<i>' + w[0] + '</i>'; }).join('') + cells + '</div></div>' +
      (list.length ? '<div class="cs">' + group('My calendars', mine) + group('Other calendars', other) + '</div>' : '') + '</aside>';
  }

  function monthCell(t, label, out, lanes) {
    var k = E.dateKey(t), chips = [], due = false;
    shownAgenda(t).forEach(function (a) {
      if (a.kind === 'event' && monthlyOn(a.rec)) { if (!multiDay(a.rec)) chips.push('<i class="chip ev" style="background:' + evColor(a.rec) + ';color:' + inkOn(evColor(a.rec)) + '">' + esc(a.rec.title) + '</i>'); }
      else if (a.kind === 'todo' && a.rec.monthly && !a.done) { due = true; chips.push('<i class="chip dl">' + esc(a.rec.title) + ' Deadline</i>'); }
    });
    var room = Math.max(1, 3 - (lanes || 0)), shown = chips.length > room ? chips.slice(0, room - 1).concat('<i class="chip more">+' + (chips.length - room + 1) + ' more</i>') : chips;
    return '<button class="cal-day' + (k === E.dateKey(now()) ? ' today' : '') + (due ? ' due' : '') + (out ? ' out' : '') + '" data-a="calPick" data-id="' + k + '"><b>' + label + '</b><span class="chips">' + shown.join('') + '</span></button>';
  }
  // One week row of the month grid. days: 7 of { t, label, out } or null (blank). Multi-day events are bars across it.
  function monthWeek(days) {
    var real = days.filter(Boolean), keys = real.map(function (x) { return E.dateKey(x.t); }), c0 = days.indexOf(real[0]);
    var bars = dayBars(keys, function (r) { return multiDay(r) && monthlyOn(r); });
    return '<div class="cal-week" style="--lanes:' + bars.lanes + '">' + days.map(function (x) { return x ? monthCell(x.t, x.label, x.out, bars.lanes) : '<i class="cal-blank"></i>'; }).join('') +
      bars.map(function (b) {
        var c = evColor(b.a.rec);
        return '<button class="chip ev mbar' + (b.cl ? ' bar cl' : '') + (b.cr ? ' bar cr' : '') + '" data-a="editEvent" data-id="' + b.a.id + '" style="--c0:' + (c0 + b.i0) + ';--n:' + (b.i1 - b.i0 + 1) + ';--lane:' + b.lane + ';background:' + c + ';color:' + inkOn(c) + '">' + esc(b.a.rec.title) + '</button>';
      }).join('') + '</div>';
  }
  function weekRows(days) { var out = ''; for (var i = 0; i < days.length; i += 7) out += monthWeek(days.slice(i, i + 7)); return out; }
  function monthGrid(key) {
    var m = new Date(E.fromKey(key));
    var first = new Date(m.getFullYear(), m.getMonth(), 1), offset = first.getDay(), daysIn = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
    var days = [];
    for (var i = 0; i < offset; i++) days.push(null);
    for (var dn = 1; dn <= daysIn; dn++) days.push({ t: new Date(m.getFullYear(), m.getMonth(), dn, 12).getTime(), label: dn });
    while (days.length % 7) days.push(null);
    return '<div class="cal-head">' + DAYNAMES.map(function (w) { return '<i>' + w + '</i>'; }).join('') + '</div><div class="cal-grid month">' + weekRows(days) + '</div>';
  }
  // More than 7 days picked: the whole weeks that hold them, like Google; days outside the pick are dimmed.
  function weeksGrid(keys) {
    var a = weekStart(keys[0]), b = E.addDays(weekStart(keys[keys.length - 1]), 6), days = [];
    for (var t = a; t <= b; t = E.addDays(t, 1)) { var k = E.dateKey(t), d = new Date(t); days.push({ t: t, label: d.getDate() === 1 || t === a ? MONTHS[d.getMonth()].slice(0, 3) + ' ' + d.getDate() : d.getDate(), out: keys.indexOf(k) < 0 }); }
    return '<div class="cal-head">' + DAYNAMES.map(function (w) { return '<i>' + w + '</i>'; }).join('') + '</div><div class="cal-grid month">' + weekRows(days) + '</div>';
  }

  // The day as a list (the old agenda), without "(repeating)".
  function dayList(key) {
    var rows = shownAgenda(E.fromKey(key)).map(function (a) {
      var r = a.rec;
      if (a.kind === 'event') return '<button class="ag-row ev" data-a="editEvent" data-id="' + a.id + '" style="--c:' + evColor(r) + '"><span class="ag-t">' + (r.allDay ? 'all day' : hm(r.start) + '–' + hm(r.end)) + '</span><span class="ag-x">' + (r.gid ? '<i class="gtag">G</i>' : '📅') + ' ' + esc(r.title) + '</span></button>';
      if (a.kind === 'todo') return '<button class="ag-row td' + (a.done ? ' dn' : '') + '" data-a="editTodo" data-id="' + a.id + '" style="--c:' + taskColor(r) + '"><span class="ag-t">⏰ ' + esc(r.due || 'end of day') + '</span><span class="ag-x">' + (a.done ? '✓ ' : '') + esc(r.emoji || '✅') + ' ' + esc(r.title) + '</span></button>';
      return '<button class="ag-row hb' + (a.done ? ' dn' : '') + '" data-a="editHabit" data-id="' + a.id + '" style="--c:' + taskColor(r) + '"><span class="ag-t">' + esc(r.start || '') + '</span><span class="ag-x">' + (a.done ? '✓ ' : '') + '🔁 ' + esc(r.title) + '</span></button>';
    }).join('');
    return '<section class="agenda">' + (rows || '<p class="empty">Nothing on this day.</p>') + '</section>';
  }

  // Side-by-side columns for blocks that overlap in time.
  function layoutDay(items) {
    items.sort(function (x, y) { return x.s - y.s || y.e - x.e; });
    var cluster = [], ends = [], cEnd = 0;
    function flush() { cluster.forEach(function (it) { it.cols = ends.length; }); cluster = []; ends = []; cEnd = 0; }
    items.forEach(function (it) {
      if (cluster.length && it.s >= cEnd) flush();
      var c = -1; for (var i = 0; i < ends.length; i++) if (ends[i] <= it.s) { c = i; break; }
      if (c < 0) { c = ends.length; ends.push(it.e); } else ends[c] = it.e;
      it.col = c; cluster.push(it); cEnd = Math.max(cEnd, it.e);
    });
    flush();
    // Like Google: a block spreads right over empty columns; one with a later block beside it still reaches most of
    // the way under that block (its title stays readable on the left), and later columns are drawn on top.
    items.forEach(function (it) {
      var bc = it.cols;
      items.forEach(function (o) { if (o !== it && o.col > it.col && o.col < bc && o.s < it.e && o.e > it.s) bc = o.col; });
      it.left = it.col / it.cols; it.right = bc >= it.cols ? 1 : Math.min(1, (bc + 0.7) / it.cols);
    });
    return items;
  }
  // Events that take whole days (all-day, or 24 h and longer) show as one bar across the days they cover.
  function multiDay(r) { return r.allDay || (r.end || 0) - r.start >= E.DAY; }
  // Bars for a run of consecutive days: [{ a, i0, i1, lane, cl, cr }] (cl / cr: it goes on before / after the run).
  function dayBars(keys, pick) {
    var by = {}, out = [];
    keys.forEach(function (k, i) {
      shownAgenda(E.fromKey(k)).forEach(function (a) {
        if (a.kind !== 'event' || !pick(a.rec)) return;
        if (by[a.id]) by[a.id].i1 = i; else out.push(by[a.id] = { a: a, i0: i, i1: i });
      });
    });
    var first = E.at(E.fromKey(keys[0]), '00:00'), last = E.at(E.addDays(E.fromKey(keys[keys.length - 1]), 1), '00:00'), lanes = [];
    out.sort(function (x, y) { return x.i0 - y.i0 || (y.i1 - y.i0) - (x.i1 - x.i0); });
    out.forEach(function (b) {
      var l = 0; while (lanes[l] != null && lanes[l] >= b.i0) l++;
      lanes[l] = b.i1; b.lane = l; b.cl = b.a.rec.start < first; b.cr = (b.a.rec.end || 0) > last;
    });
    out.lanes = lanes.length;
    return out;
  }

  // Week / day timeline: events solid, habits dotted and see-through (done ones stronger). Tap empty time = new event.
  function calTimeline(keys, viewOnly) {
    var today = E.dateKey(now()), heads = '', cols = '', ix = E.linkIndex(S.state), hi = !viewOnly && S.calHi;
    var bars = dayBars(keys, multiDay), anyAll = bars.length > 0;
    keys.forEach(function (k) {
      var t = E.fromKey(k), d0 = E.at(t, '00:00'), d1 = E.at(E.addDays(t, 1), "00:00"), items = [];
      shownAgenda(t).forEach(function (a) {
        var r = a.rec;
        if (a.kind === 'event') {
          if (multiDay(r)) return;   // in the all-day row
          var s = Math.max(r.start, d0), e = Math.min(r.end || r.start + 30 * E.MIN, d1);
          var L = E.linkOf(ix, r), sk = L ? E.sessKey(L, r) : '', ss = sk ? (S.state.sess || {})[sk] : null;
          items.push({ a: a, s: s, e: Math.max(e, s + 15 * E.MIN), color: evColor(r), drag: !viewOnly && !r.ro && !r.virt, rsz: (r.end || 0) <= d1, rs: r.start, re: r.end || r.start + 30 * E.MIN,
            link: L && L.link, sdone: !!(ss && ss.done), hi: !!(hi && L && blockMatch({ link: L.link, tasks: (ss && ss.tasks) || [] }, hi.k, hi.id)) });
        }
      });
      var d = new Date(t);
      heads += '<div class="cv-dh' + (k === today ? ' today' : '') + '" data-a="calPick" data-id="' + k + '"><small>' + DAYNAMES[d.getDay()] + '</small><b>' + d.getDate() + '</b></div>';
      var blocks = layoutDay(items).map(function (it) {
        var a = it.a, r = a.rec, top = (it.s - d0) / 3600000 * HOUR_PX, h = Math.max(16, (it.e - it.s) / 3600000 * HOUR_PX - 2);
        var cls = 'cv-ev ' + (a.kind === 'habit' ? 'hb' + (a.done ? ' dn' : '') : 'ev') + (it.drag ? ' drag' : '') + (h < 34 ? ' short' : '') + (it.link ? ' lk' : '') + (it.sdone ? ' sdn' : '') + (it.hi ? ' hi' : '') + (it.col > 0 ? ' ov' : '');
        var lr = it.link ? linkRec(it.link) : null;
        var act = a.kind === 'habit' ? 'editHabit' : 'editEvent';
        return '<div class="' + cls + '" data-a="' + act + '" data-id="' + a.id + '" data-ev="' + a.id + '" data-s="' + it.rs + '" data-e="' + it.re + '" style="top:' + top + 'px;height:' + h + 'px;left:calc(' + (it.left * 100) + '% + 1px);width:calc(' + ((it.right - it.left) * 100) + '% - 3px);z-index:' + (2 + it.col) + ';--c:' + it.color + ';--ink:' + inkOn(it.color) + '">' +
          '<b>' + ((a.kind === 'habit' && a.done) || it.sdone ? '✓ ' : '') + esc((lr && lr.emoji ? lr.emoji + ' ' : '') + r.title) + '</b><small>' + hm(it.rs) + '–' + hm(it.re) + '</small>' + (it.drag && it.rsz ? '<i class="rs"></i>' : '') + '</div>';
      }).join('');
      var nowLine = k === today ? '<i class="cv-now" style="top:' + ((now() - d0) / 3600000 * HOUR_PX) + 'px"></i>' : '';
      cols += '<div class="cv-col' + (k === today ? ' today' : '') + '" data-day="' + k + '">' + blocks + nowLine + '</div>';
    });
    var hours = ''; for (var hh = 1; hh < 24; hh++) hours += '<i style="top:' + hh * HOUR_PX + 'px">' + (hh < 10 ? '0' : '') + hh + ':00</i>';
    var grid = 'grid-template-columns: 44px repeat(' + keys.length + ', minmax(0, 1fr))';
    return '<div class="cv n' + keys.length + (viewOnly ? ' cv-view' : '') + (hi ? ' hiing' : '') + '" style="--h:' + HOUR_PX + 'px">' +
      (keys.length > 1 ? '<div class="cv-row" style="' + grid + '"><i></i>' + heads + '</div>' : '') +
      (anyAll ? '<div class="cv-row cv-alls" style="' + grid + '"><i class="cv-gut" style="grid-row:1 / span ' + bars.lanes + '">all day</i>' + bars.map(function (b) {
        var c = evColor(b.a.rec);
        return '<button class="chip ev bar' + (b.cl ? ' cl' : '') + (b.cr ? ' cr' : '') + '" data-a="editEvent" data-id="' + b.a.id + '" style="grid-column:' + (b.i0 + 2) + ' / ' + (b.i1 + 3) + ';grid-row:' + (b.lane + 1) + ';background:' + c + ';color:' + inkOn(c) + '">' + esc(b.a.rec.title) + '</button>';
      }).join('') + '</div>' : '') +
      '<div class="cv-scroll"><div class="cv-body" style="' + grid + ';height:' + 24 * HOUR_PX + 'px"><div class="cv-hours">' + hours + '</div>' + cols + '</div></div></div>';
  }

  // After each paint: keep the timeline's scroll position, wire taps on empty time and drag to move / resize events.
  // Drag across the mini month to pick the days to show (any run of days, e.g. Fri–Tue). A plain tap still jumps.
  function wireMini() {
    var g = $app.querySelector('.mm-g'); if (!g) return;
    var d0 = null, d1 = null;
    var keyAt = function (e) { var el = document.elementFromPoint(e.clientX, e.clientY); el = el && el.closest('[data-mm]'); return el && g.contains(el) ? el.getAttribute('data-mm') : null; };
    var paintSel = function () { var a = d0 < d1 ? d0 : d1, b = d0 < d1 ? d1 : d0; g.querySelectorAll('[data-mm]').forEach(function (x) { var k = x.getAttribute('data-mm'); x.classList.toggle('drag', k >= a && k <= b); }); };
    g.addEventListener('pointerdown', function (e) { var k = keyAt(e); if (!k || (e.pointerType === 'mouse' && e.button !== 0)) return; d0 = d1 = k; try { g.setPointerCapture(e.pointerId); } catch (x) {} });
    g.addEventListener('pointermove', function (e) { if (!d0) return; var k = keyAt(e); if (k && k !== d1) { d1 = k; paintSel(); } });
    var end = function () {
      if (!d0) return; var a = d0 < d1 ? d0 : d1, b = d0 < d1 ? d1 : d0; d0 = null;
      if (a === b) return;
      S.mmDragged = Date.now();
      var n = Math.round((E.fromKey(b) - E.fromKey(a)) / E.DAY) + 1;
      if (n === 7 && E.dateKey(weekStart(a)) === a) { S.calDay = a; S.calView = 'week'; lsSet('scaffold-calview', 'week'); }
      else { S.calRange = { from: a, n: n }; saveRange(); S.calView = 'range'; lsSet('scaffold-calview', 'range'); }
      S.miniMonth = null; render();
    };
    g.addEventListener('pointerup', end); g.addEventListener('pointercancel', function () { d0 = null; paintSel && g.querySelectorAll('.drag').forEach(function (x) { x.classList.remove('drag'); }); });
  }
  // The calendar fills the window: only the timeline scrolls, never the page.
  function fitTimeline() {
    var sc = $app.querySelector('.cal-main .cv-scroll'); if (!sc) return;
    sc.style.height = '320px'; sc.style.maxHeight = 'none';
    var cs = getComputedStyle($app), padB = parseFloat(cs.paddingBottom) || 0, r = sc.getBoundingClientRect();
    var below = $app.getBoundingClientRect().bottom - padB - r.bottom;
    sc.style.height = Math.max(260, Math.floor(innerHeight - (r.top + scrollY) - below - padB)) + 'px';
  }
  window.addEventListener('resize', function () { fitTimeline(); });
  function wireTimeline() {
    var sc = $app.querySelector('.cv-scroll'); if (!sc) return;
    var n = new Date(), start = Math.max(0, Math.min((n.getHours() - 1.5) * HOUR_PX, 24 * HOUR_PX));
    if (sc.closest('.cv-view')) {   // Today page: look only; taps on blocks open them, editing happens in the Calendar
      if (S.todayScroll == null || S.todayScrollDay !== E.dateKey(now())) { S.todayScroll = start; S.todayScrollDay = E.dateKey(now()); }
      sc.scrollTop = S.todayScroll;
      sc.addEventListener('scroll', function () { S.todayScroll = sc.scrollTop; });
      return;
    }
    fitTimeline();
    if (S.calScroll == null) { S.calScroll = start; if (n.getHours() < 8) S.calScroll = 7 * HOUR_PX; }
    sc.scrollTop = S.calScroll;
    sc.addEventListener('scroll', function () { S.calScroll = sc.scrollTop; });
    var body = sc.querySelector('.cv-body'), d = null;
    body.addEventListener('click', function (e) {
      if (S.dragEnded && Date.now() - S.dragEnded < 400) { e.preventDefault(); e.stopPropagation(); return; }
      var col = e.target.closest('.cv-col');
      if (!col || e.target.closest('.cv-ev')) return;
      var y = e.clientY - col.getBoundingClientRect().top, mins = Math.max(0, Math.min(23 * 60 + 30, Math.floor(y / HOUR_PX * 2) * 30));
      var s = E.fromKey(col.dataset.day); s = E.at(s, (mins / 60 | 0) + ':' + (mins % 60));
      openEventEditor({ title: '', allDay: false, start: s, end: s + 60 * E.MIN });
    });
    body.addEventListener('pointerdown', function (e) {
      var el = e.target.closest('.cv-ev.drag'); if (!el || (e.pointerType === 'mouse' && e.button !== 0)) return;
      var colsEls = Array.prototype.slice.call(body.querySelectorAll('.cv-col')), col = el.parentNode;
      d = { el: el, id: el.dataset.ev, mode: e.target.classList.contains('rs') ? 'resize' : 'move', x: e.clientX, y: e.clientY, top: el.offsetTop, h: el.offsetHeight,
        colW: col.getBoundingClientRect().width, ci: colsEls.indexOf(col), n: colsEls.length, s: +el.dataset.s, e: +el.dataset.e, dm: 0, dc: 0, on: false, touch: e.pointerType !== 'mouse', pid: e.pointerId };
      if (d.touch) d.timer = setTimeout(function () { if (d && !d.on) { begin(); try { navigator.vibrate && navigator.vibrate(15); } catch (x) {} } }, 380);
    });
    function begin() { d.on = true; S.dragging = true; d.el.classList.add('dragging'); try { d.el.setPointerCapture(d.pid); } catch (x) {} }
    body.addEventListener('pointermove', function (e) {
      if (!d) return;
      var dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (!d.on) { if (Math.abs(dx) + Math.abs(dy) < 6) return; if (d.touch) { clearTimeout(d.timer); d = null; return; } begin(); }
      e.preventDefault();
      var dm = Math.round(dy / (HOUR_PX / 4)) * 15;
      if (d.mode === 'move') {
        d.dc = d.n > 1 ? Math.max(-d.ci, Math.min(d.n - 1 - d.ci, Math.round(dx / d.colW))) : 0;
        d.dm = dm;
        d.el.style.top = (d.top + dm / 60 * HOUR_PX) + 'px';
        d.el.style.transform = 'translateX(' + d.dc * d.colW + 'px)';
      } else {
        d.dm = Math.max(dm, 15 - Math.round((d.e - d.s) / E.MIN));
        d.el.style.height = Math.max(16, d.h + d.dm / 60 * HOUR_PX) + 'px';
      }
      var lab = d.el.querySelector('small'), ns = d.mode === 'move' ? d.s + d.dm * E.MIN : d.s, ne = d.e + d.dm * E.MIN;
      if (lab) lab.textContent = hm(ns) + '–' + hm(ne);
    });
    body.addEventListener('touchmove', function (e) { if (d && d.on) e.preventDefault(); }, { passive: false });
    function end() {
      if (!d) return;
      clearTimeout(d.timer);
      var was = d; d = null;
      if (!was.on) return;
      S.dragging = false; S.dragEnded = Date.now();
      if (!was.dm && !was.dc) return render();
      var ev = E.eventsFor(S.state)[was.id]; if (!ev) return render();
      var c = JSON.parse(JSON.stringify(ev)); delete c.synced; delete c.gupd;
      if (was.mode === 'move') { var ds = was.dm * E.MIN; c.start = E.at(E.addDays(c.start, was.dc), hm(c.start)) + ds; c.end = c.start + (ev.end - ev.start); }
      else c.end = ev.end + was.dm * E.MIN;
      if (c.series) return scopeBox('Change repeating event', false, function (scope) { c.scope = scope; c.keepRule = true; apply(E.opPut('events', c, by(), now())); }, render);
      apply(E.opPut('events', c, by(), now()));
    }
    body.addEventListener('pointerup', end);
    body.addEventListener('pointercancel', function () { if (d && !d.on) { clearTimeout(d.timer); d = null; } else end(); });
  }

  // ---------- Tasks & projects ----------
  function tasksView() {
    if (S.project && S.state.projects[S.project] && !S.state.projects[S.project].del) return projectView(S.state.projects[S.project]);
    var projects = live('projects').sort(function (a, b) { return (a.deadline || '9999').localeCompare(b.deadline || '9999') || a.name.localeCompare(b.name); });
    var brought = {}; projects.forEach(function (p) { if (p.vault) brought[p.vault] = 1; });
    var vault = E.vaultProjects(S.state).filter(function (v) { return !brought[v.key]; });
    var todos = live('todos').filter(function (t) { return !t.test; });
    var today = E.dateKey(now()), groups = { now: [], later: [], repeat: [], someday: [], done: [] };
    todos.forEach(function (t) {
      var rep = t.repeat || 'none', c = (S.state.comps || {})[E.itemKey(S.state, t.id, now())], done = c && !c.undone;
      if (rep !== 'none') groups.repeat.push(t);
      else if (done) groups.done.push(t);
      else if (!t.date) groups.someday.push(t);
      else if (t.date <= today) groups.now.push(t);
      else groups.later.push(t);
    });
    groups.later.sort(function (a, b) { return a.date.localeCompare(b.date); });
    var doneAt = function (t) { var c = (S.state.comps || {})[E.compKey(t.id, 'once')]; return (c && c.ts) || 0; };
    groups.done.sort(function (a, b) { return doneAt(b) - doneAt(a); });
    function sec(title, list) { return list.length ? '<h3 class="mt">' + title + '</h3><div class="grid-cards">' + list.map(todoRow).join('') + '</div>' : ''; }
    return '<div class="sec-head"><h2>Projects</h2><button class="btn sm" data-a="editProject">＋ Project</button></div>' +
      (projects.length ? '<div class="proj-grid">' + projects.map(projectCard).join('') + '</div>' : '<p class="empty">No projects yet.</p>') +
      (vault.length ? '<details class="vault"><summary>🗂️ From your Obsidian vault (' + vault.length + ' active)</summary>' + vault.map(function (v) {
        return '<div class="row vrow"><span class="row-main"><b>' + esc(v.name) + '</b><small>' + (v.total || v.items.length) + ' open items' + (v.desc ? ' · ' + esc(v.desc.slice(0, 70)) : '') + '</small></span><button class="btn sm" data-a="bringIn" data-id="' + esc(v.key) + '">Bring in</button></div>';
      }).join('') + '</details>' : '') +
      '<div class="sec-head mt2"><h2>Tasks</h2><button class="btn primary sm" data-a="editTodo">＋ Task</button></div>' +
      (todos.length ? sec('Today and overdue', groups.now) + sec('Coming up', groups.later) + sec('Repeating (old: will become habits)', groups.repeat) + sec('No deadline', groups.someday) + sec('Done', groups.done.slice(0, 10)) : '<p class="empty">No tasks yet.</p>');
  }

  function todoWhen(t) {
    var rep = t.repeat || 'none', by = t.dueEnd ? 'end of day' : (t.due || '21:00');
    if (rep === 'custom') { var full = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], ds = (t.days || []).slice().sort(); return (ds.length && ds.length < 7 ? ds.map(function (d) { return full[d]; }).join(', ') : 'Every day') + ' · by ' + by; }
    if (rep === 'week') return 'Every week · by ' + WEEKDAYS[t.dueDay == null ? 6 : +t.dueDay] + ' ' + by;
    if (rep === 'month') return 'Every month · by day ' + (t.dueDay || 'last') + ' ' + by;
    if (rep === 'days') return 'Every ' + (t.every || 2) + ' days · by ' + by;
    if (!t.date) return 'No deadline';
    return 'Due ' + niceDay(t.date) + (t.due && t.due !== '23:59' ? ' ' + t.due : '');
  }
  function todoRow(t) {
    var proj = projectOf(t), c = (S.state.comps || {})[E.itemKey(S.state, t.id, now())], done = c && !c.undone;
    var late = !done && (t.repeat || 'none') === 'none' && t.date && t.date < E.dateKey(now());
    return '<div class="row-wrap"><button class="row' + (done ? ' dn' : '') + '" data-a="editTodo" data-id="' + t.id + '" style="--c:' + taskColor(t) + '">' +
      '<span class="emoji sm">' + esc(t.emoji || '✅') + '</span><span class="row-main"><b>' + (done ? '✓ ' : '') + esc(t.title) + '</b><small' + (late ? ' class="late-t"' : '') + '>' + esc(todoWhen(t)) + (proj ? ' · ' + esc(proj.name) : '') + '</small></span>' +
      '<span class="row-lvl">' + pushIcons(t, 'todo') + '</span></button>' + (done ? '' : periodSquare('todo', t.id, t)) + '</div>';
  }

  function projectCard(p) {
    var pr = E.projectProgress(S.state, p.id, now()), frac = pr.total ? pr.done / pr.total : 0;
    return '<button class="proj" data-a="openProject" data-id="' + p.id + '" style="--c:' + taskColor(p) + '"><span class="proj-e">' + esc(p.emoji || '🗂️') + '</span><b>' + esc(p.name) + '</b>' +
      '<small>' + pr.done + '/' + pr.total + ' tasks' + (p.deadline ? ' · due ' + esc(niceDay(p.deadline)) : '') + (p.vault ? ' · 🗂️ vault' : '') + '</small>' +
      '<span class="pbar"><i style="width:' + Math.round(frac * 100) + '%"></i></span></button>';
  }

  function projectView(p) {
    var pr = E.projectProgress(S.state, p.id, now());
    var todos = live('todos').filter(function (t) { return t.project === p.id; });
    var vp = vaultOf(p), used = {};
    todos.forEach(function (t) { if (t.vault && t.vault.item) used[t.vault.item] = 1; });
    var dd = p.deadline ? Math.round((E.fromKey(p.deadline) - E.fromKey(E.dateKey(now()))) / E.DAY) : null;
    return '<div class="sec-head"><button class="btn ghost sm" data-a="backProjects">‹ Projects</button><button class="btn ghost sm" data-a="editProject" data-id="' + p.id + '">Edit</button></div>' +
      '<section class="hero proj-hero" style="--c:' + taskColor(p) + '"><span class="proj-e big">' + esc(p.emoji || '🗂️') + '</span><div class="hero-txt"><div class="big">' + esc(p.name) + '</div>' +
      '<div class="goal">' + pr.done + ' of ' + pr.total + ' tasks done' + (p.deadline ? ' · deadline ' + esc(niceDay(p.deadline)) + (dd != null ? (dd >= 0 ? ' (' + dd + ' days left)' : ' <span class="late-t">(' + (-dd) + ' days late)</span>') : '') : '') + '</div>' +
      '<span class="pbar"><i style="width:' + (pr.total ? Math.round(pr.done / pr.total * 100) : 0) + '%"></i></span></div></section>' +
      '<div class="sec-head"><h3>Tasks</h3><button class="btn primary sm" data-a="editTodo" data-k="' + esc(JSON.stringify({ project: p.id, color: p.color })) + '">＋ Task</button></div>' +
      (todos.length ? todos.map(todoRow).join('') : '<p class="empty">No tasks in this project yet.</p>') +
      (p.vault ? '<h3 class="mt">🗂️ Development items in the vault</h3>' + (vp ? (vp.items.length ? '<p class="muted">Pick the ones you want to turn into tasks.' + (vp.total > vp.items.length ? ' Showing ' + vp.items.length + ' of ' + vp.total + '.' : '') + '</p>' + vp.items.map(function (it, i) {
        return '<div class="row vrow' + (used[it] ? ' dn' : '') + '"><span class="row-main"><span>' + esc(cleanItem(it)) + '</span></span>' + (used[it] ? '<span class="chip done">task</span>' : '<button class="btn sm" data-a="vaultTask" data-id="' + i + '">＋ Task</button>') + '</div>';
      }).join('') : '<p class="empty">No open Development items.</p>') : '<p class="muted">Waiting for a computer to read this project from the vault…</p>') : '');
  }

  // ---------- Habits ----------
  function habitsView() {
    var st = E.stats(S.state, now(), 28), pct = st.week == null ? null : Math.round(st.week * 100);
    var byId = {}, hadTiny = false; st.tasks.forEach(function (x) { byId[x.id] = x; if (x.cells.some(function (c) { return c.s === 'tiny'; })) hadTiny = true; });
    var list = live('tasks').filter(function (t) { return !t.test; }).sort(function (a, b) { return ((a.active === false) - (b.active === false)) || (a.due || '').localeCompare(b.due || ''); });
    var lockedId = S.r.lock && S.r.lock.id;
    var rows = list.map(function (t) {
      var x = byId[t.id], on = t.active !== false;
      var p = x && x.week != null ? Math.round(x.week * 100) + '%' : '–';
      return '<div class="stat-row' + (on ? '' : ' off') + '" style="--c:' + taskColor(t) + '"><div class="stat-head">' +
        '<button class="habit-open" ' + (t.id === lockedId ? 'disabled title="Locked habits cannot be edited"' : 'data-a="editHabit" data-id="' + t.id + '"') + '><span class="emoji sm">' + esc(t.emoji) + '</span><span class="row-main"><b>' + esc(t.title) + '</b><small>' + esc(habitWhen(t)) + ' · ' + pushIcons(t, 'habit') + '</small></span></button>' +
        '<span class="stat-num">' + p + '</span>' + (x && x.streak ? '<span class="streak">🔥 ' + x.streak + '</span>' : '') +
        periodSquare('habit', t.id, t) + '<button class="switch' + (on ? ' on' : '') + '" data-a="toggleHabit" data-id="' + t.id + '" title="' + (on ? 'Active' : 'Paused') + '"><i></i></button></div>' +
        (x ? '<div class="heat">' + x.cells.map(function (c) { return '<i class="h-' + c.s + '" title="' + c.day + '"></i>'; }).join('') + '</div>' : '') + '</div>';
    }).join('');
    return '<div class="sec-head"><h2>Habits</h2><button class="btn primary sm" data-a="editHabit">＋ Habit</button></div>' +
      '<section class="hero">' + ring(pct == null ? 0 : pct / 100, 110, 11, pctColor(pct), '<b>' + (pct == null ? '–' : pct + '%') + '</b><small>7 days</small>') +
      '<div class="hero-txt"><div class="big">' + (pct == null ? 'No data yet' : pct >= 80 ? 'On target 🎯' : 'Goal: 80%') + '</div>' +
      (hadTiny ? '<div class="goal">Full = 1 · 🌱 old tiny win = ½</div>' : '') + '<div class="goal">⛔ Emergency stops this week: <b>' + st.stops + '</b></div></div></section>' +
      '<div class="legend"><span><i class="h-full"></i>done</span>' + (hadTiny ? '<span><i class="h-tiny"></i>tiny</span>' : '') + '<span><i class="h-miss"></i>missed</span><span><i class="h-none"></i>off day</span><span class="lg-note">last 4 weeks →</span></div>' +
      (rows ? '<div class="grid-cards wide">' + rows + '</div>' : '<p class="empty">No habits yet.</p>') +
      '<h3 class="mt">Templates</h3><div class="tpl-grid">' + TEMPLATES.map(function (t, i) {
        return '<button class="tpl" data-a="template" data-id="' + i + '" style="--c:' + t.color + '"><span>' + t.emoji + '</span>' + esc(t.title) + '<small>' + pushLabel(t, 'habit') + '</small></button>';
      }).join('') + '</div>';
  }


  // ---------- Restriction modes ----------
  function myDev() { return S.local.deviceId || ''; }
  function allModes() { return [E.FULL_LOCK].concat(live('modes').sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); })); }
  function lockModeName(t) { var m = E.modeById(S.state, t.lockMode || 'full') || E.FULL_LOCK; return m.name; }
  function androidPreset() { return { apps: ['com.whatsapp', 'com.whatsapp.w4b', 'com.scaffold.app'], sites: [] }; }
  function presetFor(d) { return d.platform === 'android' ? androidPreset() : d.platform === 'mac' ? { apps: ['com.operasoftware.Opera', 'com.operasoftware.OperaGX', 'net.whatsapp.WhatsApp', 'desktop.WhatsApp', 'com.scaffold.desktop'], sites: ['web.whatsapp.com'] } : { apps: ['opera.exe', 'whatsapp.exe', 'scaffold.exe'], sites: ['web.whatsapp.com'] }; }
  // Devices that published their apps (records may be split in parts: id#n). This device is listed even before it has.
  function devices() {
    var by = {}, d = S.state.devs || {};
    Object.keys(d).forEach(function (k) {
      var r = d[k]; if (!r || r.del) return;
      var base = k.split('#')[0], x = by[base] || (by[base] = { id: base, parts: [] });
      x.parts.push(r); if (r.name) { x.name = r.name; x.platform = r.platform; }
    });
    var out = Object.keys(by).map(function (k) {
      var x = by[k]; x.parts.sort(function (a, b) { return (a.part || 0) - (b.part || 0); });
      x.apps = [].concat.apply([], x.parts.map(function (r) { return r.apps || []; })); delete x.parts; return x;
    }).filter(function (x) { return x.name; });
    if (myDev() && !by[myDev()]) out.push({ id: myDev(), name: S.local.deviceName || 'This device', platform: PLATFORM === 'android' ? 'android' : /mac/i.test(navigator.platform) ? 'mac' : 'win', apps: PLATFORM === 'android' ? listApps().map(function (a) { return { id: a.pkg, label: a.label }; }) : [] });
    return out.sort(function (a, b) { return (a.id === myDev() ? -1 : 0) - (b.id === myDev() ? -1 : 0) || a.name.localeCompare(b.name); });
  }
  var DEV_ICON = { android: '📱', mac: '💻', win: '🖥️' };
  // Phones and tablets publish their apps from here (computers do it from the desktop app).
  function publishAndroidApps() {
    if (PLATFORM !== 'android' || !myDev() || !S.local.syncCode) return;
    var apps = listApps().map(function (a) { return { id: a.pkg, label: a.label }; }).sort(function (a, b) { return a.label.localeCompare(b.label); });
    var cur = (S.state.devs || {})[myDev()], sig = JSON.stringify(apps.map(function (a) { return a.id; })) + (S.local.deviceName || '');
    if (cur && cur.sig === sig && now() - (cur.ts || 0) < 7 * E.DAY) return;
    var per = 40, parts = Math.max(1, Math.ceil(apps.length / per)), p = { devs: {} }, t = now();
    for (var i = 0; i < parts; i++) { var r = { id: i ? myDev() + '#' + i : myDev(), part: i, apps: apps.slice(i * per, (i + 1) * per), ts: t, by: by() }; if (!i) { r.name = S.local.deviceName || 'Phone'; r.platform = 'android'; r.parts = parts; r.sig = sig; } p.devs[r.id] = r; }
    apply(p);
  }
  function modeChip() {
    var a = S.act; if (!a) return '';
    return '<button class="pill mode-chip" data-a="modeChip" style="--c:' + esc(a.mode.color || '#7c9cff') + '" title="' + esc(a.src === 'event' ? 'From the event “' + a.title + '”' : a.src === 'lock' ? 'Deadline lock' : 'Turned on by hand') + '">' + esc(a.mode.emoji || '🛡️') + ' ' + esc(a.mode.name) + (a.until ? '<small> · until ' + hm(a.until) + '</small>' : '') + '</button>';
  }
  function modeSummary(m) {
    var ds = devices().map(function (d) { var l = E.modeList(m, d.id); return (DEV_ICON[d.platform] || '•') + ' ' + l.apps.length + (d.platform !== 'android' ? ' + ' + l.sites.length + ' sites' : ''); }).join(' · ');
    return m.builtin ? 'Blocks everything except the unblockable apps' : (m.list === 'white' ? 'Allows only: ' : 'Blocks: ') + ds;
  }
  function modesView() {
    var a = S.act, eventOn = a && (a.src === 'event' || a.src === 'lock');
    var head = '<div class="sec-head"><h2>Restriction modes</h2><button class="btn primary sm" data-a="editMode">＋ Mode</button></div>' +
      (a ? '<section class="hero mode-hero" style="--c:' + esc(a.mode.color || '#7c9cff') + '"><span class="proj-e big">' + esc(a.mode.emoji || '🛡️') + '</span><div class="hero-txt"><div class="big">' + esc(a.mode.name) + ' Mode is on</div>' +
        '<div class="goal">' + (a.src === 'event' ? 'From the event “' + esc(a.title) + '” · ends ' + hm(a.until) : a.src === 'lock' ? 'Deadline lock: ' + esc(a.title) + ' · until it is done' : 'Turned on by hand · ' + (a.until ? 'until ' + hm(a.until) : 'until you turn it off')) + '</div>' +
        (a.src === 'manual' ? '<button class="btn sm" data-a="modeOff">Turn off</button>' : '<div class="goal muted">Only ⛔ Emergency stop ends it early.</div>') + '</div></section>' : '<p class="muted">No mode is on. Turn one on below, or give an event a mode in the calendar.</p>');
    var rows = allModes().map(function (m) {
      var on = a && a.mode.id === m.id;
      return '<div class="row-wrap"><button class="row' + (on ? ' on' : '') + '" ' + (m.builtin ? '' : 'data-a="editMode" data-id="' + esc(m.id) + '"') + ' style="--c:' + esc(m.color || '#7c9cff') + '"><span class="emoji sm">' + esc(m.emoji || '🛡️') + '</span><span class="row-main"><b>' + esc(m.name) + (on ? ' · on' : '') + '</b><small>' + esc(modeSummary(m)) + '</small></span></button>' +
        (on ? '' : '<button class="btn sm" data-a="modeOn" data-id="' + esc(m.id) + '"' + (eventOn ? ' disabled title="A mode from an event or a deadline lock is on"' : '') + '>Turn on</button>') + '</div>';
    }).join('');
    var ub = devices().map(function (d) {
      var u = E.unblockOf(S.state, d.id), set = u || presetFor(d), names = {}; (d.apps || []).forEach(function (x) { names[x.id] = x.label; });
      var list = (set.apps || []).filter(function (id) { return names[id]; }).map(function (id) { return names[id]; }).concat(d.platform !== 'android' ? set.sites || [] : []);
      return '<button class="row" data-a="editUnblock" data-id="' + esc(d.id) + '"><span class="emoji sm">' + (DEV_ICON[d.platform] || '•') + '</span><span class="row-main"><b>' + esc(d.name) + (d.id === myDev() ? ' (this device)' : '') + '</b><small>' + esc(list.join(', ') || 'Nothing') + (u ? '' : ' · preset') + '</small></span></button>';
    }).join('');
    return head + '<h3 class="mt">Modes</h3><div class="grid-cards">' + rows + '</div>' +
      '<h3 class="mt">🔓 Unblockable</h3><p class="muted">No mode ever blocks these, on each device.</p><div class="grid-cards">' + ub + '</div>' +
      (devices().length < 2 ? '<p class="muted">Other devices show up here once they run this version.</p>' : '');
  }
  function appPicker(d, chosen, name) {
    var apps = (d.apps || []).slice(), have = {}; apps.forEach(function (x) { have[x.id] = 1; });
    chosen.forEach(function (id) { if (!have[id]) apps.push({ id: id, label: id }); });
    return '<input class="app-filter" type="search" placeholder="Search apps…" data-for="' + esc(name) + '">' +
      '<div class="apps" data-list="' + esc(name) + '">' + (apps.length ? apps.map(function (x) { return '<label class="check sm"><input type="checkbox" name="' + esc(name) + '" value="' + esc(x.id) + '"' + (chosen.indexOf(x.id) >= 0 ? ' checked' : '') + '> ' + esc(x.label) + '</label>'; }).join('') : '<p class="muted">This device hasn’t sent its app list yet.</p>') + '</div>';
  }
  function wireFilters(f) {
    f.addEventListener('input', function (e) {
      var inp = e.target.closest('.app-filter'); if (!inp) return;
      var q = inp.value.toLowerCase(), box = f.querySelector('[data-list="' + inp.getAttribute('data-for') + '"]');
      box.querySelectorAll('label').forEach(function (l) { l.style.display = !q || l.textContent.toLowerCase().indexOf(q) >= 0 ? '' : 'none'; });
    });
  }
  function sitesText(list) { return esc((list || []).join('\n')); }
  function readSites(v) { return String(v || '').split(/[\s,]+/).map(function (x) { return E.parseUrl(x).host || ''; }).filter(Boolean).filter(function (x, i, a) { return a.indexOf(x) === i; }); }
  function openModeEditor(m) {
    var isNew = !m || !m.id, t = Object.assign({ name: '', emoji: '🎨', color: COLORS[4], list: 'black', dev: {} }, m || {}), ds = devices();
    $modal.innerHTML = modalShell(isNew ? 'New mode' : 'Edit mode',
      '<label class="field">Name<input name="name" required maxlength="40" value="' + esc(t.name) + '" placeholder="e.g. Drawing"></label>' + emojiField(t) + colorField(t) +
      '<div class="field">How it works<div class="levels two-l">' + [['black', '⛔', 'Block these', 'Everything else stays open.'], ['white', '✅', 'Allow only these', 'Everything else is blocked.']].map(function (x) {
        return '<label class="lvl' + (t.list === x[0] ? ' on' : '') + '"><input type="radio" name="list" value="' + x[0] + '"' + (t.list === x[0] ? ' checked' : '') + '><span class="lvl-ic">' + x[1] + '</span><span><b>' + x[2] + '</b><small>' + x[3] + '</small></span></label>';
      }).join('') + '</div></div>' +
      ds.map(function (d, i) {
        var l = E.modeList(t, d.id);
        return '<details class="dev-box"' + (i === 0 ? ' open' : '') + '><summary>' + (DEV_ICON[d.platform] || '•') + ' ' + esc(d.name) + ' <small>' + l.apps.length + ' apps' + (d.platform !== 'android' ? ', ' + l.sites.length + ' sites' : '') + '</small></summary>' +
          '<div class="field">Apps' + appPicker(d, l.apps, 'a_' + d.id) + '</div>' +
          (d.platform !== 'android' ? '<label class="field">Websites <small>(one per line, e.g. youtube.com; searching always works)</small><textarea name="s_' + esc(d.id) + '" rows="3">' + sitesText(l.sites) + '</textarea></label>' : '') + '</details>';
      }).join('') + '<p class="muted">The unblockable apps are never blocked, whatever is picked here.</p>', !isNew);
    var f = wire(t, function (fd) {
      t.name = fd.get('name').trim(); t.list = fd.get('list') || 'black'; t.dev = t.dev || {};
      ds.forEach(function (d) { t.dev[d.id] = { apps: fd.getAll('a_' + d.id), sites: d.platform !== 'android' ? readSites(fd.get('s_' + d.id)) : [] }; });
      apply(E.opPut('modes', t, by(), now())); closeModal(); toast(isNew ? '🛡️ Mode added' : 'Saved');
    }, function () { confirmBox('Delete “' + t.name + '” Mode?', 'Events and locks that use it stop using it.', 'Delete', function () { apply(E.opDel('modes', t, by(), now())); closeModal(); }); });
    f.addEventListener('change', function (e) { if (e.target.name === 'list') f.querySelectorAll('.lvl').forEach(function (x) { x.classList.toggle('on', x.contains(e.target)); }); });
    wireFilters(f);
  }
  function openUnblockEditor(devId) {
    var d = devices().filter(function (x) { return x.id === devId; })[0]; if (!d) return;
    var cur = E.unblockOf(S.state, d.id) || presetFor(d);
    $modal.innerHTML = modalShell('🔓 Unblockable · ' + esc(d.name),
      '<p class="muted">No mode ever blocks these on ' + esc(d.name) + '.' + (d.platform !== 'android' ? ' Keep the browser here: blocked websites freeze inside it.' : '') + '</p>' +
      '<div class="field">Apps' + appPicker(d, cur.apps || [], 'ua') + '</div>' +
      (d.platform !== 'android' ? '<label class="field">Websites <small>(one per line)</small><textarea name="us" rows="3">' + sitesText(cur.sites) + '</textarea></label>' : ''), false);
    var f = wire({}, function (fd) {
      var u = JSON.parse(JSON.stringify((S.state.cfg || {}).unblock || { id: 'unblock', dev: {} })); delete u.ts; delete u.by; delete u.del; u.id = 'unblock'; u.dev = u.dev || {};
      u.dev[d.id] = { apps: fd.getAll('ua'), sites: d.platform !== 'android' ? readSites(fd.get('us')) : [] };
      apply(E.opPut('cfg', u, by(), now())); closeModal(); toast('Saved');
    });
    wireFilters(f);
  }
  function turnOnBox(id) {
    var m = E.modeById(S.state, id); if (!m) return;
    var el = document.createElement('div');
    el.className = 'modal-bg top-layer';
    el.innerHTML = '<div class="modal small"><h2>' + esc((m.emoji || '🛡️') + ' ' + m.name) + '</h2><p>Turn it on for:</p><div class="row-btns dur">' +
      [[30, '30 min'], [60, '1 hour'], [120, '2 hours'], [0, 'Until I turn it off']].map(function (x) { return '<button class="btn" data-min="' + x[0] + '">' + x[1] + '</button>'; }).join('') +
      '</div><div class="modal-actions"><span class="sp"></span><button class="btn ghost" data-no>Cancel</button></div></div>';
    document.body.appendChild(el);
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-min]');
      if (b) { var mins = +b.getAttribute('data-min'), t = now(); el.remove(); apply(E.opPut('cfg', { id: 'modeOn', mode: id, at: t, until: mins ? t + mins * E.MIN : 0 }, by(), t)); toast('🛡️ ' + m.name + ' Mode is on'); }
      else if (e.target.closest('[data-no]') || e.target === el) el.remove();
    });
  }
  // Computers: the "Close this Program" pop-up (one row per program open when the mode started).
  function closeProgView() {
    var g = S.local.guard || {}, list = g.list || [];
    if (!list.length) { setTimeout(function () { B.closeWindow(); }, 300); return '<section class="remind"><p class="muted">Nothing to close.</p></section>'; }
    return '<section class="closeprog"><h2>🛡️ ' + esc(g.mode) + ' Mode is on</h2><p class="muted">These programs are blocked now. Save your work, then choose.</p>' +
      list.map(function (p) {
        return '<div class="cp-row"><b>' + esc(p.name) + '</b><div class="row-btns"><button class="btn primary sm" data-a="guardAct" data-id="close" data-k="' + esc(p.id) + '">Close Now</button>' +
          (p.waits < 3 ? '<button class="btn sm" data-a="guardAct" data-id="wait" data-k="' + esc(p.id) + '">Give me 2 minutes' + (p.waits ? ' (' + (3 - p.waits) + ' left)' : '') + '</button>' : '') +
          '<button class="btn ghost sm" data-a="guardAct" data-id="freeze" data-k="' + esc(p.id) + '">🧊 Freeze program instead</button></div></div>';
      }).join('') + '</section>';
  }

  // ---------- Notes ----------
  function notesView() {
    var notes = live('notes').sort(function (a, b) { return ((a.active === false) - (b.active === false)) || (a.every || 0) - (b.every || 0); });
    return '<div class="sec-head"><h2>Notes</h2><button class="btn primary sm" data-a="editNote">＋ Note</button></div>' +
      '<p class="muted">Each note pops up on every device at its own rhythm and stays until you tap “Got it”.</p>' +
      (notes.length ? '<div class="grid-cards">' + notes.map(function (n) {
        var on = n.active !== false, p = E.notePops(n, now());
        return '<div class="note-row' + (on ? '' : ' off') + '" style="--c:' + taskColor(n) + '"><button class="note-open" data-a="editNote" data-id="' + n.id + '"><span class="note-body md">' + mdHtml(n.text) + '</span>' +
          '<small>🔁 every ' + everyLabel(n.every) + ' · ⏳ ' + (+n.hold || 0) + ' s · 🕗 ' + esc(n.from || '00:00') + '–' + esc(n.to || '24:00') + (n.days && n.days.length && n.days.length < 7 ? ' · ' + n.days.map(function (d) { return DAYNAMES[d]; }).join(' ') : '') + (on && p.next ? ' · next ' + (E.dateKey(p.next) === E.dateKey(now()) ? hm(p.next) : niceDay(E.dateKey(p.next)) + ' ' + hm(p.next)) : '') + '</small></button>' +
          '<button class="switch' + (on ? ' on' : '') + '" data-a="toggleNote" data-id="' + n.id + '"><i></i></button></div>';
      }).join('') + '</div>' : '<p class="empty">No notes yet. Add things you must not forget.</p>');
  }

  // ---------- Settings ----------
  function settingsView() {
    var L = S.local, h = '<div class="sec-head"><h2>Settings</h2></div><div class="panels">';
    h += '<section class="panel kill">' + (S.r.paused
      ? '<h3>Scaffold is OFF everywhere</h3><p>No locks, pop-ups, notes or reminders on any device.</p><button class="btn primary wide" data-a="resume">▶ Resume on all devices</button>'
      : '<h3>⛔ Emergency stop</h3><p>Turns Scaffold off on <b>every device</b> at once. Everything goes back to normal until you resume.</p><button class="btn danger wide" data-a="stopAll">Stop everything</button>') + '</section>';
    h += '<section class="panel"><h3>🔗 Sync between devices</h3>';
    if (L.syncCode) {
      h += '<p>Type this code on your other devices:</p><div class="code" data-a="copyCode">' + esc(L.syncCode) + '</div>' +
        '<p class="muted">Status: <span class="dot ' + (/connected/.test(L.sync && L.sync.status) ? 'ok' : '') + '"></span>' + esc(L.sync && L.sync.status || '…') + '</p>' +
        '<button class="btn ghost sm" data-a="leaveSync">Disconnect</button>' +
        (function () {
          var fb = S.state.cfg && S.state.cfg.fb, url = fb && !fb.del ? fb.url || '' : '';
          return '<label class="field" style="margin-top:12px">⚡ Instant sync (Firebase database URL) <small>' + (url ? 'set once, shared with every device' : 'not set: devices use the slower backup routes') + '</small>' +
            '<div class="join"><input id="fb-url" value="' + esc(url) + '" placeholder="https://name-default-rtdb.firebaseio.com" autocapitalize="off" autocomplete="off"><button class="btn" data-a="saveFb">Save</button></div></label>';
        })();
    } else {
      h += '<p>Create a code on your first device, then join with it everywhere else.</p><button class="btn primary" data-a="newCode">Create sync code</button>' +
        '<div class="join"><input id="join-code" placeholder="maple-otter-quartz-river-1234" autocapitalize="off" autocomplete="off"><button class="btn" data-a="joinCode">Join</button></div>';
    }
    h += '<label class="field">This device<input id="dev-name" value="' + esc(L.deviceName) + '"></label><button class="btn ghost sm" data-a="saveName">Save name</button></section>';
    if (L.perms) {
      var P = [['accessibility', 'App blocker', 'Needed to lock apps and keep notes on screen. On Samsung: if it is greyed out, open App info → ⋮ → “Allow restricted settings” first.'],
        ['notifications', 'Notifications', 'Reminders and the status bar.'],
        ['fullScreen', 'Full-screen pop-ups', 'Lets reminders and notes take over the screen.'],
        ['exactAlarm', 'Exact alarms', 'Reminders on time, to the minute.'],
        ['battery', 'No battery limits', 'Keeps Scaffold running in the background all the time.'],
        ['installs', 'Install updates', 'Lets Scaffold update itself when a new version comes out.']];
      h += '<section class="panel"><h3>📱 Permissions</h3>' + P.map(function (p) {
        var ok = L.perms[p[0]];
        return '<div class="perm"><span class="perm-ic">' + (ok ? '✅' : '⚠️') + '</span><span class="perm-txt"><b>' + p[1] + '</b><small>' + p[2] + '</small></span>' + (ok ? '' : '<button class="btn sm" data-a="perm" data-id="' + p[0] + '">Fix</button>') + '</div>';
      }).join('') + '<div class="perm"><span class="perm-ic">' + (L.perms.grayscale ? '✅' : '➖') + '</span><span class="perm-txt"><b>Grey screen while locked (optional)</b><small>' + (L.perms.grayscale ? 'On: the screen turns grey during locks.' : 'Needs a one-time computer command; see the setup guide.') + '</small></span></div>' +
        '<button class="btn ghost sm" data-a="perm" data-id="appInfo">Open app info</button></section>';
    }
    if (PLATFORM === 'desktop') {
      var V = L.vault || {}, C = L.cal || {};
      h += '<section class="panel"><h3>💻 This computer</h3><label class="check"><input type="checkbox" data-change="autostart"' + (L.autostart ? ' checked' : '') + '> Start Scaffold when the computer starts</label>' +
        '<p class="muted">What gets blocked is set in 🛡️ Modes. Emergency stop shortcut: <b>Ctrl+Alt+Shift+K</b> (⌘ on Mac).</p></section>';
      h += '<section class="panel"><h3>🗂️ Obsidian vault</h3><p>Scaffold lists your <b>active</b> vault projects in Tasks, and ticks their Development items when you finish the matching task.</p>' +
        '<label class="field">Vault folder<input id="vault-path" value="' + esc(L.vaultPath || V.path || '') + '" placeholder="/path/to/Second Brain"></label><button class="btn ghost sm" data-a="saveVault">Save and scan</button>' +
        '<p class="muted">Status: ' + esc(V.status || 'not scanned yet') + '</p></section>';
      h += '<section class="panel"><h3>📅 Google Calendar (two-way)</h3>' + (L.calUrl
        ? (L.scriptOld || (L.scriptV && L.scriptV < 2) || /Calendar API/.test(C.status || '') ? '<div class="callout"><p>⚠️ <b>Your Google script needs an update</b> (all your calendars with their colors, descriptions, repeating events). About 2 minutes:</p><ol class="steps">' +
            '<li><button class="btn sm" data-a="copyScript">Copy new script</button></li>' +
            '<li>Open <b>script.google.com</b> → your Scaffold project. Select all the code, delete it, paste.</li>' +
            '<li>On the left, next to <b>Services</b>, click <b>+</b> → <b>Google Calendar API</b> → <b>Add</b>.</li>' +
            '<li><b>Deploy → Manage deployments</b> → ✏️ (edit) → Version: <b>New version</b> → <b>Deploy</b>. Allow access if Google asks. The URL stays the same.</li></ol></div>' : '') +
          '<p class="muted">Status: <span class="dot ' + (/ok|synced/.test(C.status || '') ? 'ok' : '') + '"></span>' + esc(C.status || 'connecting…') + '</p><label class="field">Bridge URL<input id="cal-url" value="' + esc(L.calUrl) + '"></label><button class="btn ghost sm" data-a="saveCal">Save</button>'
        : '<p>Events you add or change on either side show up on the other. One-time setup, about 5 minutes:</p><ol class="steps">' +
          '<li>Open <b>script.google.com</b> → <b>New project</b>.</li>' +
          '<li>Delete what is there and paste the bridge script: <button class="btn sm" data-a="copyScript">Copy script</button></li>' +
          '<li>On the left, next to <b>Services</b>, click <b>+</b> → <b>Google Calendar API</b> → <b>Add</b>.</li>' +
          '<li><b>Deploy → New deployment</b> → type <b>Web app</b>. Execute as <b>Me</b>, access <b>Anyone</b>. Deploy, then allow access to your calendar.</li>' +
          '<li>Copy the <b>Web app URL</b> and paste it here:</li></ol>' +
          '<div class="join"><input id="cal-url" placeholder="https://script.google.com/macros/s/…/exec"><button class="btn" data-a="saveCal">Connect</button></div>' +
          '<p class="muted">Do this on one computer only. The script only works with the secret key built into it.</p>') + '</section>';
    } else {
      h += '<section class="panel"><h3>📅 Google Calendar · 🗂️ Obsidian</h3><p class="muted">These connect from a computer (Settings there). Everything they bring in shows up here too.</p></section>';
    }
    h += '<section class="panel"><h3>🧪 Try it</h3><p>Check that everything works before you rely on it.</p><div class="row-btns"><button class="btn" data-a="test" data-id="remind">Test reminder (all devices)</button><button class="btn" data-a="test" data-id="lock">Test lock (all devices)</button></div></section>';
    h += '<section class="panel"><h3>🧯 Removing Scaffold</h3><p class="muted">Emergency stop frees every device instantly. To remove it completely:<br>' +
      '<b>Android:</b> Settings → Apps → Scaffold → Uninstall.<br><b>Mac:</b> menu bar icon → Quit, then delete the app.<br><b>Windows:</b> tray icon → Quit, then delete the folder.<br>If anything ever gets stuck: <b>Android</b> Settings → Accessibility → Scaffold → Off; <b>computers</b> tray / menu bar icon → Quit Scaffold (Force Quit and Task Manager reopen it within seconds).</p></section>';
    var U = L.update || {};
    h += '<section class="panel"><h3>⬆️ Updates</h3><p>Version <b>' + esc(L.version || '?') + '</b>. ' + (PLATFORM === 'android' ? 'New versions download by themselves; Android may ask you to tap Install.' : 'New versions install by themselves, never during a lock.') + '</p>' +
      (U.status ? '<p class="muted">Last check: ' + esc(U.status) + (U.checked ? ' (' + new Date(U.checked).toLocaleString() + ')' : '') + '</p>' : '') +
      '<div class="row-btns" id="updBox">' + updBtn() + '</div></section>';
    h += '</div><p class="muted center">Scaffold ' + esc(L.version || '') + ' · ' + esc(PLATFORM) + ' · ' + esc(L.deviceId) + '</p>';
    return h;
  }

  // ---------- editors ----------
  function sel(v, cur) { return String(v) === String(cur) ? ' selected' : ''; }
  function emojiField(t) { return '<div class="field">Picture<div class="emoji-grid">' + EMOJIS.map(function (e) { return '<button type="button" class="ep' + (e === t.emoji ? ' on' : '') + '" data-emoji="' + e + '">' + e + '</button>'; }).join('') + '</div></div>'; }
  function colorField(t) { return '<div class="field">Color<div class="color-row">' + COLORS.map(function (c) { return '<button type="button" class="cp' + (c === t.color ? ' on' : '') + '" data-color="' + c + '" style="background:' + c + '"></button>'; }).join('') + '</div></div>'; }
  // Reminders (off / nudge / nag) with their window, plus the lock toggle (only with a deadline).
  function pushField(t, kind) {
    var cur = E.pushOf(t, kind), rw = { from: t.rfrom || t.start || '09:00', to: t.rto || t.due || '21:00' };
    var every = +(t.remind || 30), pre = [1, 5, 15, 30, 45, 60, 90, 120], custom = pre.indexOf(every) < 0;
    return '<div class="field">How hard should Scaffold push?<div class="levels three">' + ['off', 'nudge', 'nag'].map(function (k) {
        return '<label class="lvl' + (cur === k ? ' on' : '') + '"><input type="radio" name="push" value="' + k + '"' + (cur === k ? ' checked' : '') + '><span class="lvl-ic">' + PUSH[k].icon + '</span><span><b>' + PUSH[k].name + '</b><small>' + PUSH[k].desc + '</small></span></label>';
      }).join('') + '</div></div>' +
      '<div class="f-rem"><div class="two"><label class="field">Remind me every<select name="remind">' + pre.map(function (m) { return '<option value="' + m + '"' + (!custom && every === m ? ' selected' : '') + '>' + m + (m === 1 ? ' minute' : ' minutes') + '</option>'; }).join('') +
      '<option value="custom"' + (custom ? ' selected' : '') + '>Custom…</option></select></label>' +
      '<label class="field f-remind">Minutes<input type="number" name="remindN" min="1" max="1440" value="' + every + '"></label></div>' +
      '<div class="field">Reminder window' + (kind === 'todo' ? ' <small>(every day until it is done)</small>' : '') + '<div class="pair"><input type="time" name="rfrom" value="' + esc(rw.from) + '"><span>to</span><input type="time" name="rto" value="' + esc(rw.to) + '"></div></div></div>' +
      '<div class="field dl-row"><label class="check f-lock"><input type="checkbox" name="lock"' + (E.lockOf(t) ? ' checked' : '') + '> 🔒 Lock at deadline <small class="f-locknote">(needs a deadline with a time)</small></label>' +
      '<label class="f-lockmode">with <select name="lockMode">' + allModes().map(function (m) { return '<option value="' + esc(m.id) + '"' + sel(m.id, t.lockMode || 'full') + '>' + esc((m.emoji || '🛡️') + ' ' + m.name) + '</option>'; }).join('') + '</select></label></div>';
  }
  function doneFields(t) {
    return '<div class="field timer-row"><label class="check"><input type="checkbox" name="timer"' + (t.kind === 'timer' ? ' checked' : '') + '> ⏱ Timer</label>' +
      '<label class="f-minutes"><input type="number" name="minutes" min="1" max="240" value="' + esc(t.minutes || 20) + '"> minutes <small>(done when it finishes)</small></label></div>';
  }
  function listApps() { if (PLATFORM !== 'android') return []; try { return JSON.parse(B.listApps()); } catch (e) { return []; } }
  function modalShell(title, body, canDelete) {
    return '<div class="modal-bg"><form class="modal" id="editor"><div class="sec-head"><h2>' + title + '</h2><button type="button" class="x" data-close>✕</button></div>' + body +
      '<div class="modal-actions">' + (canDelete ? '<button type="button" class="btn danger sm" data-del>Delete</button>' : '') + '<span class="sp"></span><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Save</button></div></form></div>';
  }
  // Shared wiring: picture, color, weekday chips, level highlight, close, delete.
  function wire(t, onSave, onDelete, onChange) {
    S.modalOpen = true;
    var f = document.getElementById('editor');
    f.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-close')) closeModal();
      else if (b.dataset.emoji) { t.emoji = b.dataset.emoji; f.querySelectorAll('.ep').forEach(function (x) { x.classList.toggle('on', x === b); }); }
      else if (b.dataset.color) { t.color = b.dataset.color; f.querySelectorAll('.cp').forEach(function (x) { x.classList.toggle('on', x === b); }); }
      else if (b.dataset.day) { t.days = t.days || []; var d = +b.dataset.day, i = t.days.indexOf(d); if (i >= 0) t.days.splice(i, 1); else t.days.push(d); t.days.sort(); b.classList.toggle('on'); }
      else if (b.hasAttribute('data-del') && onDelete) onDelete();
    });
    f.addEventListener('change', function (e) {
      if (f.timer && f.querySelector('.f-minutes')) f.querySelector('.f-minutes').style.display = f.timer.checked ? '' : 'none';
      if (f.remind && f.querySelector('.f-remind')) f.querySelector('.f-remind').style.display = f.remind.value === 'custom' ? '' : 'none';
      if (e.target.name === 'push') f.querySelectorAll('.lvl').forEach(function (x) { x.classList.toggle('on', x.contains(e.target)); });
      pushVis(f);
      if (onChange) onChange(f, e);
    });
    f.addEventListener('input', function (e) { if (e.target.name === 'due') pushVis(f); });
    f.addEventListener('submit', function (e) { e.preventDefault(); onSave(new FormData(f), f); });
    if (f.remind && f.querySelector('.f-remind')) f.querySelector('.f-remind').style.display = f.remind.value === 'custom' ? '' : 'none';
    if (f.timer && f.querySelector('.f-minutes')) f.querySelector('.f-minutes').style.display = f.timer.checked ? '' : 'none';
    pushVis(f);
    if (onChange) onChange(f, {});
    return f;
  }
  // Reminder fields only for Nudge / Nag; the lock only with a deadline (f.dl: task deadline, f.dueOn: habit deadline).
  function pushVis(f) {
    var pv = f.querySelector('input[name="push"]:checked'), rem = f.querySelector('.f-rem'); if (!rem) return;
    rem.style.display = pv && pv.value !== 'off' ? '' : 'none';
    var dl = f.dl || f.dueOn, has = !dl || (dl.checked && !!(f.due && f.due.value));   // "by the end of the day" can't lock
    if (f.lock) { f.lock.disabled = !has; f.querySelector('.f-lock').classList.toggle('off', !has); f.querySelector('.f-locknote').style.display = has ? 'none' : ''; f.querySelector('.f-lockmode').style.display = has && f.lock.checked ? '' : 'none'; }
  }
  function readDone(t, fd, apps) {
    t.push = fd.get('push') || 'off'; t.lock = !!fd.get('lock'); t.rfrom = fd.get('rfrom') || '09:00'; t.rto = fd.get('rto') || '21:00';
    t.kind = fd.get('timer') ? 'timer' : 'check'; t.minutes = Math.max(1, Math.min(240, Math.round(+fd.get('minutes') || 20)));
    delete t.tiny; delete t.level; delete t.start; delete t.dueEnd; delete t.desktop; delete t.allowApps; t.lockMode = fd.get('lockMode') || 'full';
    t.remind = fd.get('remind') === 'custom' ? Math.min(1440, Math.max(1, Math.round(+fd.get('remindN') || 30))) : +fd.get('remind');
  }

  function habitWhen(t) {
    var rep = t.repeat || 'weekdays', by = E.hasDue(t, 'habit') ? ' · by ' + (t.due && t.due !== '23:59' ? t.due : 'end of day') : '';
    if (rep === 'week') return 'Every week' + (E.hasDue(t, 'habit') ? ' · by ' + WEEKDAYS[t.dueDay == null ? 6 : +t.dueDay] + ' ' + (t.due && t.due !== '23:59' ? t.due : '') : '');
    if (rep === 'month') return 'Every month' + (E.hasDue(t, 'habit') ? ' · by day ' + (t.dueDay || 'last') + ' ' + (t.due && t.due !== '23:59' ? t.due : '') : '');
    if (rep === 'every') return 'Every ' + (t.every || 2) + ' days' + by;
    return ((t.days && t.days.length && t.days.length < 7) ? t.days.map(function (d) { return DAYNAMES[d]; }).join(' ') : 'Every day') + by;
  }
  // Details shown with the task when it's time to do it: notifications, the reminder pop-up and the lock screen.
  function descField(t, what) { return '<label class="field">' + what + ' description <small>(shows in its notifications, pop-up and lock screen)</small><textarea name="tdesc" rows="3" placeholder="e.g. Draw them standing upright, in their fighting clothes, weapons in hand">' + esc(t.desc || '') + '</textarea></label>'; }
  function readDesc(t, fd) { var d = (fd.get('tdesc') || '').trim(); if (d) t.desc = d; else delete t.desc; }
  function descBox(t) { return t.desc ? '<div class="task-desc">' + esc(t.desc) + '</div>' : ''; }

  function openHabitEditor(task) {
    var isNew = !task || !task.id;
    var t = Object.assign({ title: '', emoji: '📖', color: COLORS[0], days: [], push: 'nag', remind: 30, kind: 'check', minutes: 20, allowApps: [], active: true }, task || {});
    var apps = listApps(), r = t.repeat || 'weekdays', dueOn = E.hasDue(t, 'habit');
    $modal.innerHTML = modalShell(isNew ? 'New habit' : 'Edit habit',
      '<label class="field">What?<input name="title" required maxlength="60" value="' + esc(t.title) + '" placeholder="e.g. Read"></label>' + descField(t, 'Habit') + emojiField(t) + colorField(t) +
      '<label class="field">Repeats<select name="repeat"><option value="weekdays"' + sel('weekdays', r) + '>Every day / on set days</option><option value="week"' + sel('week', r) + '>Every week</option><option value="month"' + sel('month', r) + '>Every month</option><option value="every"' + sel('every', r) + '>Every few days</option></select></label>' +
      '<div class="field f-days">Days <small>(none selected = every day)</small><div class="day-row">' + DAYS.map(function (d, i) { return '<button type="button" class="dp' + ((t.days || []).indexOf(i) >= 0 ? ' on' : '') + '" data-day="' + i + '">' + d + '</button>'; }).join('') + '</div></div>' +
      '<div class="two"><label class="field f-dueday-w">By which day<select name="dueDayW">' + WEEKDAYS.map(function (w, i) { return '<option value="' + i + '"' + sel(i, t.dueDay == null ? 6 : t.dueDay) + '>' + w + '</option>'; }).join('') + '</select></label>' +
      '<label class="field f-dueday-m">By which day of the month<input type="number" name="dueDayM" min="1" max="31" value="' + esc(r === 'month' ? t.dueDay || 28 : 28) + '"></label>' +
      '<label class="field f-every">Every how many days<input type="number" name="every" min="2" max="365" value="' + esc(t.every || 2) + '"></label></div>' +
      '<div class="field dl-row"><label class="check"><input type="checkbox" name="dueOn"' + (dueOn ? ' checked' : '') + '> ⏰ Deadline</label>' +
      '<label class="f-dl">at <input type="time" name="due" value="' + esc(dueOn && t.due !== '23:59' ? t.due || '' : '') + '"> <small>(blank = end of the day)</small></label></div>' +
      '<label class="check"><input type="checkbox" name="active"' + (t.active !== false ? ' checked' : '') + '> Active (turn off to pause this habit)</label>' +
      pushField(t, 'habit') + doneFields(t), !isNew);
    wire(t, function (fd) {
      t.title = fd.get('title').trim(); readDesc(t, fd); t.repeat = fd.get('repeat'); t.dueOn = !!fd.get('dueOn'); t.due = t.dueOn ? fd.get('due') || '' : '';
      if (t.repeat !== 'weekdays') t.days = [];
      if (t.repeat === 'week') t.dueDay = +fd.get('dueDayW');
      if (t.repeat === 'month') t.dueDay = Math.min(31, Math.max(1, +fd.get('dueDayM') || 28));
      if (t.repeat === 'every') { t.every = Math.max(2, +fd.get('every') || 2); if (!t.date) t.date = E.dateKey(now()); }
      t.active = !!fd.get('active'); readDone(t, fd, apps); if (!t.dueOn || !t.due) t.lock = false;
      apply(E.opPut('tasks', t, by(), now())); closeModal(); toast(isNew ? '✨ Habit added' : 'Saved');
    }, function () { confirmBox('Delete “' + t.title + '”?', 'Its history stays in the tracker until it ages out.', 'Delete', function () { apply(E.opDel('tasks', t, by(), now())); closeModal(); }); },
    function (f) {
      var rep = f.repeat.value;
      f.querySelector('.f-days').style.display = rep === 'weekdays' ? '' : 'none';
      f.querySelector('.f-dueday-w').style.display = rep === 'week' ? '' : 'none';
      f.querySelector('.f-dueday-m').style.display = rep === 'month' ? '' : 'none';
      f.querySelector('.f-every').style.display = rep === 'every' ? '' : 'none';
      f.querySelector('.f-dl').style.display = f.dueOn.checked ? '' : 'none';
    });
  }

  function openTodoEditor(task) {
    var isNew = !task || !task.id;
    var t = Object.assign({ title: '', emoji: '✅', color: COLORS[1], date: '', due: '', push: 'nudge', remind: 120, kind: 'check', minutes: 20, allowApps: [] }, task || {});
    var apps = listApps(), projects = live('projects'), old = (t.repeat || 'none') !== 'none', dl = !!t.date && !old;
    $modal.innerHTML = modalShell(isNew ? 'New task' : 'Edit task',
      '<label class="field">What?<input name="title" required maxlength="80" value="' + esc(t.title) + '" placeholder="e.g. Buy batteries"></label>' + descField(t, 'Task') +
      (t.vault ? '<p class="muted">🗂️ From the vault: “' + esc(cleanItem(t.vault.item)) + '”. Finishing it ticks it in Obsidian.</p>' : '') +
      (old ? '<p class="muted">🔁 This is an old repeating task (' + esc(todoWhen(t)) + '). It is being turned into a habit.</p>' : '') +
      '<label class="field">Project<select name="project"><option value="">None</option>' + projects.map(function (p) { return '<option value="' + p.id + '"' + sel(p.id, t.project) + '>' + esc((p.emoji || '') + ' ' + p.name) + '</option>'; }).join('') + '</select></label>' +
      (old ? '' : '<div class="field dl-row"><label class="check"><input type="checkbox" name="dl"' + (dl ? ' checked' : '') + '> ⏰ Deadline</label>' +
        '<span class="f-dl"><input type="date" name="date" value="' + esc(t.date || E.dateKey(now())) + '"> <input type="time" name="due" value="' + esc(t.due && t.due !== '23:59' ? t.due : '') + '"> <small>(time: blank = end of the day)</small></span></div>' +
        '<label class="check f-monthly"><input type="checkbox" name="monthly"' + (t.monthly ? ' checked' : '') + '> Show in monthly <small>(marks the deadline day in the month view)</small></label>') +
      emojiField(t) + colorField(t) + pushField(t, 'todo') + doneFields(t), !isNew);
    wire(t, function (fd) {
      t.title = fd.get('title').trim(); readDesc(t, fd); t.project = fd.get('project') || '';
      if (!old) {
        var on = !!fd.get('dl');
        if (on && !fd.get('date')) return toast('Pick the deadline day');
        t.repeat = 'none'; t.date = on ? fd.get('date') : ''; t.due = on ? fd.get('due') || '' : ''; t.monthly = on && !!fd.get('monthly');
        ['days', 'dueDay', 'every'].forEach(function (k) { delete t[k]; });
      }
      readDone(t, fd, apps); if (!old && (!t.date || !t.due)) t.lock = false;
      apply(E.opPut('todos', t, by(), now())); closeModal(); toast(isNew ? '✨ Task added' : 'Saved');
    }, function () { confirmBox('Delete “' + t.title + '”?', 'This removes the task from every device.', 'Delete', function () { apply(E.opDel('todos', t, by(), now())); closeModal(); }); },
    function (f) {
      if (!f.dl) return;
      f.querySelector('.f-dl').style.display = f.dl.checked ? '' : 'none';
      f.querySelector('.f-monthly').style.display = f.dl.checked ? '' : 'none';
    });
  }

  function openProjectEditor(p) {
    var isNew = !p || !p.id;
    var t = Object.assign({ name: '', emoji: '🚀', color: COLORS[4], deadline: '' }, p || {});
    $modal.innerHTML = modalShell(isNew ? 'New project' : 'Edit project',
      '<label class="field">Name<input name="name" required maxlength="60" value="' + esc(t.name) + '" placeholder="e.g. Move apartments"></label>' +
      '<label class="field">Deadline <small>(optional)</small><input type="date" name="deadline" value="' + esc(t.deadline || '') + '"></label>' +
      (t.vault ? '<p class="muted">🗂️ Linked to the vault project at ' + esc(t.vaultPath || '') + '.</p>' : '') + emojiField(t) + colorField(t), !isNew);
    wire(t, function (fd) {
      t.name = fd.get('name').trim(); t.deadline = fd.get('deadline') || '';
      var patch = E.opPut('projects', t, by(), now());
      apply(patch); closeModal(); toast(isNew ? '✨ Project added' : 'Saved');
      if (isNew) { S.project = Object.keys(patch.projects)[0]; render(); }
    }, function () {
      confirmBox('Delete project “' + t.name + '”?', 'Its tasks stay, without a project.' + (t.vault ? ' The vault project is not touched.' : ''), 'Delete', function () { apply(E.opDel('projects', t, by(), now())); S.project = ''; closeModal(); });
    });
  }

  // ---------- Note text: light Markdown <-> formatted blocks ----------
  // Stored text, one block per line: "# " heading, "## " subheading, "- " bullet, "1. " numbered, "- [ ] " / "- [x] " checklist.
  // Inline: **bold** *italic* ~~strike~~ ++underline++, "\" escapes a mark. Blocks are <div data-t="p|h1|h2|ul|ol|cl" data-c="1 if ticked">.
  var MD_TAG = { '**': 'b', '*': 'i', '~~': 's', '++': 'u' };
  function mdInline(s) {
    var toks = [], re = /\\([\s\S])|\*\*|~~|\+\+|\*/g, m, last = 0;
    while ((m = re.exec(s))) {
      if (m.index > last) toks.push({ text: s.slice(last, m.index) });
      toks.push(m[1] !== undefined ? { text: m[1] } : { mark: m[0] });
      last = re.lastIndex;
    }
    if (last < s.length) toks.push({ text: s.slice(last) });
    var count = {}; toks.forEach(function (t) { if (t.mark) count[t.mark] = (count[t.mark] || 0) + 1; });
    var seen = {}; toks.forEach(function (t) { if (t.mark) { seen[t.mark] = (seen[t.mark] || 0) + 1; if (count[t.mark] % 2 && seen[t.mark] === count[t.mark]) { t.text = t.mark; delete t.mark; } } });   // unpaired last mark: literal
    var out = '', stack = [];
    toks.forEach(function (t) {
      if (!t.mark) { out += esc(t.text); return; }
      var tag = MD_TAG[t.mark], i = stack.lastIndexOf(tag);
      if (i < 0) { stack.push(tag); out += '<' + tag + '>'; return; }
      var above = stack.splice(i);
      for (var k = above.length - 1; k >= 0; k--) out += '</' + above[k] + '>';
      above.slice(1).forEach(function (a) { stack.push(a); out += '<' + a + '>'; });
    });
    for (var k = stack.length - 1; k >= 0; k--) out += '</' + stack[k] + '>';
    return out;
  }
  var MAX_INDENT = 4;
  function mdLine(l) {
    var ind = /^\t*/.exec(l)[0].length, r = mdLineType(l.slice(ind)); r.i = Math.min(MAX_INDENT, ind); return r;
  }
  function mdLineType(l) {
    var m;
    if ((m = /^## (.*)$/.exec(l))) return { t: 'h2', s: m[1] };
    if ((m = /^# (.*)$/.exec(l))) return { t: 'h1', s: m[1] };
    if ((m = /^- \[([ xX])\](?: (.*))?$/.exec(l))) return { t: 'cl', c: m[1] !== ' ', s: m[2] || '' };
    if ((m = /^[-*] (.*)$/.exec(l))) return { t: 'ul', s: m[1] };
    if ((m = /^\d+\. (.*)$/.exec(l))) return { t: 'ol', s: m[1] };
    return { t: 'p', s: l };
  }
  // tick: note id when checklist lines can be ticked (pop-up).
  // Numbered lines count per indent level (a deeper line in between doesn't restart the count).
  function olCounter() { var counts = []; return function (t, lvl) { counts.length = lvl + 1; counts[lvl] = t === 'ol' ? (counts[lvl] || 0) + 1 : 0; return counts[lvl]; }; }
  function mdHtml(text, tick) {
    var num = olCounter();
    return String(text || '').split('\n').map(function (l, i) {
      var b = mdLine(l), inner = mdInline(b.s), n = num(b.t, b.i);
      return '<div data-t="' + b.t + '"' + (b.i ? ' data-i="' + b.i + '"' : '') + (b.t === 'ol' ? ' data-n="' + n + '"' : '') + (b.c ? ' data-c="1"' : '') + (tick && b.t === 'cl' ? ' data-a="tickNote" data-id="' + esc(tick) + '" data-k="' + i + '"' : '') + '>' + (inner || '<br>') + '</div>';
    }).join('');
  }
  function mdEsc(s) { return s.replace(/[\\*]/g, '\\$&').replace(/~~/g, '\\~\\~').replace(/\+\+/g, '\\+\\+'); }
  function mdFromInline(node) {
    var out = '';
    node.childNodes.forEach(function (c) {
      if (c.nodeType === 3) { out += mdEsc(c.data.replace(/\u200B/g, '').replace(/\u00a0/g, ' ')); return; }
      if (c.nodeType !== 1) return;
      var inner = mdFromInline(c), tag = c.nodeName.toLowerCase();
      if (!inner) return;
      var mk = { b: '**', strong: '**', i: '*', em: '*', u: '++', s: '~~', strike: '~~', del: '~~' }[tag];
      out += mk ? mk + inner + mk : inner;
    });
    return out;
  }
  function mdFromEditor(ed) {
    var num = olCounter(), lines = [];
    ed.childNodes.forEach(function (b) {
      if (b.nodeType !== 1) return;
      var t = b.dataset.t || 'p', s = mdFromInline(b).replace(/^\t+/, ''), lvl = +b.dataset.i || 0, n = num(t, lvl);
      if (t === 'p' && /^(#{1,2} |[-*] |\d+\. )/.test(s)) s = '\\' + s;
      lines.push('\t'.repeat(lvl) + ({ h1: '# ', h2: '## ', ul: '- ', ol: n + '. ', cl: b.dataset.c === '1' ? '- [x] ' : '- [ ] ' }[t] || '') + s);
    });
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    return lines.join('\n');
  }
  function noteTick(text, line) {
    var ls = String(text || '').split('\n');
    if (ls[line] && /^\t*- \[[ xX]\]/.test(ls[line])) ls[line] = ls[line].replace(/^(\t*)- \[([ xX])\]/, function (m, ind, c) { return ind + (c === ' ' ? '- [x]' : '- [ ]'); });
    return ls.join('\n');
  }

  var IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || '');
  var RTE_TOOLS = [['bold', '<b>B</b>', 'Bold (' + (IS_MAC ? '⌘' : 'Ctrl+') + 'B)'], ['italic', '<i>I</i>', 'Italic (' + (IS_MAC ? '⌘' : 'Ctrl+') + 'I)'], ['underline', '<u>U</u>', 'Underline (' + (IS_MAC ? '⌘' : 'Ctrl+') + 'U)'], ['strikeThrough', '<s>S</s>', 'Strikethrough (' + (IS_MAC ? '⌘⇧X' : 'Alt+Shift+5') + ')'],
    ['|'], ['ul', '•', 'Bullets (' + (IS_MAC ? '⌘⇧8' : 'Ctrl+Shift+8') + ')'], ['ol', '1.', 'Numbered (' + (IS_MAC ? '⌘⇧7' : 'Ctrl+Shift+7') + ')'], ['cl', '☑', 'Checklist (' + (IS_MAC ? '⌘⇧9' : 'Ctrl+Shift+9') + ')'], ['h1', 'H', 'Heading (' + (IS_MAC ? '⌘⌥1' : 'Ctrl+Alt+1') + ')'], ['|'], ['outdent', '⇤', 'Move left (Shift+Tab)'], ['indent', '⇥', 'Move right (Tab)']];
  function rteBar() { return '<div class="rte-bar">' + RTE_TOOLS.map(function (t) { return t[0] === '|' ? '<i class="rte-sep"></i>' : '<button type="button" class="rte-b" data-fmt="' + t[0] + '" title="' + esc(t[2]) + '">' + t[1] + '</button>'; }).join('') + '</div>'; }
  function rteField(text) {
    return '<div class="field">Note' + rteBar() +
      '<div class="rte md" contenteditable="true" spellcheck="true" data-ph="e.g. Reply to João about Saturday">' + (text ? mdHtml(text) : '<div data-t="p"><br></div>') + '</div></div>';
  }
  function wireRte(ed, bar) {
    try { document.execCommand('styleWithCSS', false, false); } catch (e) {}
    var LIST = { ul: 1, ol: 1, cl: 1 };
    function sel() { var s = window.getSelection(); return s.rangeCount && ed.contains(s.getRangeAt(0).startContainer) ? s.getRangeAt(0) : null; }
    function blockOf(n) { while (n && n.parentNode !== ed) { if (n === ed) return null; n = n.parentNode; } return n && n.nodeType === 1 ? n : null; }
    function caretAt(node, off) { var r = document.createRange(); r.setStart(node, off); r.collapse(true); var s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
    function fill(b) { if (!b.textContent.replace(/\u200B/g, '') && !b.querySelector('br')) b.innerHTML = '<br>'; }
    function setType(b, t, ticked) { b.dataset.t = t; if (t === 'cl') b.dataset.c = ticked ? '1' : '0'; else delete b.dataset.c; }
    function before(r, b) { var x = document.createRange(); x.setStart(b, 0); x.setEnd(r.startContainer, r.startOffset); return x; }
    function normalize() {
      var s = window.getSelection(), an = s.anchorNode, ao = s.anchorOffset, run = null, moved = false;
      Array.prototype.slice.call(ed.childNodes).forEach(function (c) {
        if (c.nodeType === 1 && c.nodeName === 'DIV') { run = null; if (!c.dataset.t) c.dataset.t = 'p'; return; }
        if (c.nodeType === 3 && !c.data.trim() && !run) { if (!c.data) ed.removeChild(c); return; }
        if (!run) { run = document.createElement('div'); run.dataset.t = 'p'; ed.insertBefore(run, c); }
        run.appendChild(c); moved = true;
      });
      if (!ed.firstElementChild) { ed.innerHTML = '<div data-t="p"><br></div>'; caretAt(ed.firstChild, 0); }
      blank();
      ed.querySelectorAll('[style]').forEach(function (x) { x.removeAttribute('style'); });
      if (moved && an && ed.contains(an)) try { caretAt(an, ao); } catch (e) {}
    }
    function blank() { var f = ed.firstElementChild; ed.classList.toggle('blank', ed.children.length === 1 && f.dataset.t === 'p' && !f.textContent.replace(/\u200B/g, '')); }
    function blocksInSel(r) {
      var a = blockOf(r.startContainer), z = blockOf(r.endContainer), out = [];
      if (!a) return out;
      for (var b = a; b; b = b.nextElementSibling) { out.push(b); if (b === z || !z) break; }
      return out;
    }
    function block(t) {
      var r = sel(); if (!r) { ed.focus(); r = sel(); if (!r) return; }
      var bs = blocksInSel(r), all = bs.every(function (b) { return b.dataset.t === t; });
      bs.forEach(function (b) { setType(b, all ? 'p' : t); });
      renumber(); paintBar();
    }
    function renumber() { var num = olCounter(); Array.prototype.forEach.call(ed.children, function (b) { var n = num(b.dataset.t, +b.dataset.i || 0); if (b.dataset.t === 'ol') b.dataset.n = n; else delete b.dataset.n; }); }
    function setIndent(b, lvl) { lvl = Math.max(0, Math.min(MAX_INDENT, lvl)); if (lvl) b.dataset.i = lvl; else delete b.dataset.i; }
    function indent(dir) {
      var r = sel(); if (!r) { ed.focus(); r = sel(); if (!r) return; }
      blocksInSel(r).forEach(function (b) { setIndent(b, (+b.dataset.i || 0) + dir); });
      renumber();
    }
    function fmt(cmd) {
      if (cmd === 'indent' || cmd === 'outdent') return indent(cmd === 'indent' ? 1 : -1);
      if (LIST[cmd] || cmd === 'h1' || cmd === 'h2' || cmd === 'p') return block(cmd === 'p' ? 'p' : cmd);
      document.execCommand(cmd, false, null); normalize(); paintBar();
    }
    function enter() {
      var r = sel(); if (!r) return;
      if (!r.collapsed) r.deleteContents();
      normalize(); r = sel(); if (!r) return;
      var b = blockOf(r.startContainer); if (!b) return;
      var t = b.dataset.t || 'p';
      if (LIST[t] && !b.textContent.replace(/\u200B/g, '').trim()) {   // Enter on an empty list line: move it left, then end the list
        if (+b.dataset.i) setIndent(b, +b.dataset.i - 1); else setType(b, 'p');
        renumber(); paintBar(); return;
      }
      var x = document.createRange(); x.setStart(r.startContainer, r.startOffset); x.setEnd(b, b.childNodes.length);
      var frag = x.extractContents(), nb = document.createElement('div');
      setType(nb, t === 'h1' || t === 'h2' ? 'p' : t, false); setIndent(nb, +b.dataset.i || 0);
      nb.appendChild(frag);
      if (!nb.textContent.replace(/\u200B/g, '')) nb.innerHTML = '<br>';
      fill(b); b.parentNode.insertBefore(nb, b.nextSibling);
      var first = nb.firstChild; while (first && first.nodeType === 1 && first.firstChild && first.nodeName !== 'BR') first = first.firstChild;
      caretAt(first && first.nodeType === 3 ? first : nb, 0);
      nb.scrollIntoView({ block: 'nearest' });
      renumber(); paintBar();
    }
    // Typing marks: "- " "* " bullet, "1. " numbered, "[] " "[ ] " "- [ " checklist ("[x] " ticked), "# " "## " heading; **b** *i* ~~s~~ ++u++.
    // added: how many characters the last input put just before the caret (keyboards may insert whole words at once).
    var BLOCK_MARKS = [[/^[-*] /, 'ul'], [/^\d+\. /, 'ol'], [/^\[[xX]\] /, 'cl', 1], [/^(\[\] |\[ \] |\[ )/, 'cl'], [/^## /, 'h2'], [/^# /, 'h1']];
    var UL_MARKS = [[/^\[[xX]\] /, 'cl', 1], [/^(\[\] |\[ \] |\[ )/, 'cl']];
    var INLINE_MARKS = [[/\*\*([^*\s](?:[^*]*[^*\s])?)\*\*/g, 'b'], [/~~([^~]+)~~/g, 's'], [/\+\+([^+]+)\+\+/g, 'u'], [/(^|[^*\\])\*([^*\s](?:[^*]*[^*\s])?)\*(?!\*)/g, 'i']];
    function marks(added) {
      var r = sel(); if (!r || !r.collapsed) return;
      var b = blockOf(r.startContainer); if (!b) return;
      added = Math.max(1, added || 1);
      var t = b.dataset.t || 'p', pre = before(r, b).toString().replace(/\u00a0/g, ' ').replace(/\u200B/g, '');
      if (t === 'cl' && b.dataset.fresh && /^\] ?/.test(pre)) {   // "- [ ] ": the "] " after the box already made
        if (/^\] /.test(pre)) { delete b.dataset.fresh; cut(b, 2); }
        return;
      }
      var list = t === 'p' ? BLOCK_MARKS : t === 'ul' ? UL_MARKS : t === 'h1' ? [[/^# /, 'h2']] : [];
      for (var i = 0; i < list.length; i++) {
        var m = list[i][0].exec(pre);
        if (m && pre.length - added < m[0].length) {   // the mark was just typed
          setType(b, list[i][1], list[i][2]); cut(b, m[0].length);
          if (list[i][1] === 'cl' && !list[i][2]) b.dataset.fresh = '1'; else delete b.dataset.fresh;
          if (list[i][1] === 'cl' && b.dataset.fresh && /^\] /.test(before(sel(), b).toString())) { delete b.dataset.fresh; cut(b, 2); }
          paintBar(); return marks(added - m[0].length);
        }
      }
      if (b.dataset.fresh && pre.length > 1) delete b.dataset.fresh;
      r = sel(); var n = r.startContainer, off = r.startOffset;
      if (n.nodeType !== 3) return;
      var s = n.data.slice(0, off), from = Math.max(0, off - added - 4), best = null;
      INLINE_MARKS.forEach(function (im) {
        im[0].lastIndex = 0; var m;
        while ((m = im[0].exec(s))) {
          var lead = im[1] === 'i' ? m[1].length : 0, start = m.index + lead, end = m.index + m[0].length;
          if (end > from && (!best || end < best.end)) best = { start: start, end: end, inner: im[1] === 'i' ? m[2] : m[1], tag: im[1] };
        }
      });
      if (!best) return;
      var x = document.createRange(); x.setStart(n, best.start); x.setEnd(n, best.end);
      var tail = document.createRange(); tail.setStart(n, best.end); tail.setEnd(n, off);
      var rest = tail.toString(); tail.deleteContents(); x.deleteContents();
      var el = document.createElement(best.tag); el.textContent = best.inner;
      x.insertNode(el);
      var after = document.createTextNode(rest || '\u200B'); el.parentNode.insertBefore(after, el.nextSibling);
      caretAt(after, after.data.length); paintBar();
      if (rest) marks(rest.length);
    }
    // Deletes the first n characters of block b (the typed mark); the caret stays where it was.
    function cut(b, n) {
      var r = sel(), keep = r ? Math.max(0, before(r, b).toString().length - n) : 0;
      var w = document.createTreeWalker(b, NodeFilter.SHOW_TEXT), tx, left = n;
      while (left > 0 && (tx = w.nextNode())) { var k = Math.min(left, tx.data.length); tx.deleteData(0, k); left -= k; }
      if (!b.textContent) { b.innerHTML = '<br>'; caretAt(b, 0); return; }
      w = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
      while ((tx = w.nextNode())) { if (keep <= tx.data.length) return caretAt(tx, keep); keep -= tx.data.length; }
      caretAt(b, b.childNodes.length);
    }
    function paintBar() {
      if (!ed.isConnected) { document.removeEventListener('selectionchange', paintBar); return; }
      var r = sel(), b = r && blockOf(r.startContainer), t = b ? b.dataset.t : '';
      bar.querySelectorAll('[data-fmt]').forEach(function (x) {
        var k = x.dataset.fmt, on = false;
        if (LIST[k] || k === 'h1') on = t === k || (k === 'h1' && t === 'h2');
        else if (r && k !== 'indent' && k !== 'outdent') try { on = document.queryCommandState(k); } catch (e) {}
        x.classList.toggle('on', on);
      });
    }
    bar.addEventListener('mousedown', function (e) { if (e.target.closest('[data-fmt]')) e.preventDefault(); });   // keep the caret in the note
    bar.addEventListener('click', function (e) {
      var x = e.target.closest('[data-fmt]'); if (!x) return;
      e.preventDefault(); if (!sel()) { ed.focus(); var last = ed.lastElementChild; if (last) caretAt(last, last.childNodes.length); }
      var k = x.dataset.fmt;
      if (k === 'h1') { var cb = blockOf((sel() || {}).startContainer), ct = cb ? cb.dataset.t : ''; k = ct === 'h1' ? 'h2' : ct === 'h2' ? 'p' : 'h1'; }   // H cycles: heading → subheading → normal
      fmt(k);
    });
    ed.addEventListener('beforeinput', function (e) {
      if (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') { e.preventDefault(); enter(); return; }
      if (e.inputType === 'deleteContentBackward') {
        var r = sel(); if (!r || !r.collapsed) return;
        var b = blockOf(r.startContainer);
        if (b && !before(r, b).toString().replace(/\u200B/g, '')) {
          if (b.dataset.t !== 'p') { e.preventDefault(); setType(b, 'p'); delete b.dataset.fresh; renumber(); paintBar(); }
          else if (+b.dataset.i) { e.preventDefault(); setIndent(b, +b.dataset.i - 1); }
        }
      }
    });
    ed.addEventListener('input', function (e) { normalize(); renumber(); if (!e.isComposing && /^insert/.test(e.inputType || 'insert') && e.inputType !== 'insertFromPaste') marks(e.data ? e.data.length : 1); });
    ed.addEventListener('compositionend', function (e) { var k = e.data ? e.data.length : 1; setTimeout(function () { marks(k); }, 0); });
    ed.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); enter(); return; }
      if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); indent(e.shiftKey ? -1 : 1); return; }
      var mod = e.ctrlKey || e.metaKey, c = e.code, cmd = null;
      if (mod && !e.shiftKey && !e.altKey) cmd = { KeyB: 'bold', KeyI: 'italic', KeyU: 'underline' }[c];
      else if (mod && e.shiftKey && !e.altKey) cmd = { Digit8: 'ul', Digit7: 'ol', Digit9: 'cl', KeyX: 'strikeThrough' }[c];
      else if (mod && e.altKey && !e.shiftKey) cmd = { Digit1: 'h1', Digit2: 'h2', Digit0: 'p' }[c];
      else if (!mod && e.altKey && e.shiftKey && c === 'Digit5') cmd = 'strikeThrough';
      if (cmd) { e.preventDefault(); fmt(cmd); }
    });
    ed.addEventListener('paste', function (e) {
      e.preventDefault();
      var lines = ((e.clipboardData || window.clipboardData).getData('text/plain') || '').replace(/\r/g, '').split('\n');
      lines.forEach(function (l, i) { if (i) enter(); if (l) document.execCommand('insertText', false, l); });
    });
    // Tick a checklist box in the editor by tapping it.
    ed.addEventListener('click', function (e) {
      var b = blockOf(e.target);
      if (b && b.dataset.t === 'cl' && e.clientX - b.getBoundingClientRect().left < 26) { b.dataset.c = b.dataset.c === '1' ? '0' : '1'; e.preventDefault(); }
    });
    document.addEventListener('selectionchange', paintBar);
    blank();
    return { value: function () { return mdFromEditor(ed); } };
  }

  function openNoteEditor(n) {
    var isNew = !n || !n.id;
    var t = Object.assign({ text: '', every: 60, hold: 5, from: '08:00', to: '23:00', days: [], color: COLORS[6], active: true }, n || {});
    var unit = t.every % 1440 === 0 ? 1440 : t.every % 60 === 0 ? 60 : 1;
    $modal.innerHTML = modalShell(isNew ? 'New note' : 'Edit note',
      rteField(t.text) +
      '<div class="note-when"><div class="field">Pop up every<div class="pair"><input type="number" name="n" min="1" max="999" value="' + (t.every / unit) + '"><select name="unit"><option value="1"' + sel(1, unit) + '>minutes</option><option value="60"' + sel(60, unit) + '>hours</option><option value="1440"' + sel(1440, unit) + '>days</option></select></div></div>' +
      '<div class="field">Only between<div class="pair"><input type="time" name="from" value="' + esc(t.from) + '"><span>and</span><input type="time" name="to" value="' + esc(t.to) + '"></div></div></div>' +
      '<div class="field">Active days <small>(none selected = every day)</small><div class="day-row">' + DAYS.map(function (d, i) { return '<button type="button" class="dp' + ((t.days || []).indexOf(i) >= 0 ? ' on' : '') + '" data-day="' + i + '">' + d + '</button>'; }).join('') + '</div></div>' +
      '<label class="field">Can\'t dismiss for the first (seconds)<input type="number" name="hold" min="0" max="600" value="' + esc(t.hold) + '"></label>' +
      '<label class="check"><input type="checkbox" name="active"' + (t.active !== false ? ' checked' : '') + '> Active</label>' + colorField(t), !isNew);
    var rte = wireRte($modal.querySelector('.rte'), $modal.querySelector('.rte-bar'));
    wire(t, function (fd) {
      var text = rte.value();
      if (!E.plainNote(text).trim()) return toast('Write the note first');
      var every = Math.max(1, (+fd.get('n') || 1) * (+fd.get('unit') || 1));
      if (every !== t.every || isNew || (fd.get('active') && t.active === false)) t.anchor = now();
      t.text = text; t.every = every; t.hold = Math.max(0, +fd.get('hold') || 0);
      t.from = fd.get('from') || '00:00'; t.to = fd.get('to') || '24:00'; t.active = !!fd.get('active');
      if (!t.days || t.days.length === 7) t.days = [];
      apply(E.opPut('notes', t, by(), now())); closeModal(); toast(isNew ? '📌 Note added' : 'Saved');
    }, function () { confirmBox('Delete this note?', 'It stops popping up on every device.', 'Delete', function () { apply(E.opDel('notes', t, by(), now())); closeModal(); }); });
  }

  // "This event / This and following events / All events", like Google. ruleChanged: a new repeat rule can't apply to one occurrence.
  function scopeBox(title, ruleChanged, fn, onCancel, del) {
    var el = document.createElement('div'), opts = (ruleChanged ? [] : [['one', 'This event']]).concat([['following', 'This and following events'], ['all', 'All events']]);
    el.className = 'modal-bg top-layer';
    el.innerHTML = '<div class="modal small"><h2>' + esc(title) + '</h2><div class="scope-list">' + opts.map(function (o, i) {
      return '<label class="check"><input type="radio" name="scope" value="' + o[0] + '"' + (i === 0 ? ' checked' : '') + '> ' + o[1] + '</label>'; }).join('') + '</div>' +
      '<div class="modal-actions"><span class="sp"></span><button class="btn ghost" data-no>Cancel</button><button class="btn ' + (del ? 'danger' : 'primary') + '" data-yes>' + (del ? 'Delete' : 'OK') + '</button></div></div>';
    document.body.appendChild(el);
    el.addEventListener('click', function (e) {
      if (e.target.closest('[data-yes]')) { var v = el.querySelector('input[name=scope]:checked').value; el.remove(); fn(v); }
      else if (e.target.closest('[data-no]') || e.target === el) { el.remove(); if (onCancel) onCancel(); }
    });
  }

  // Show / hide each Google calendar (on every device).
  function openCalendars() {
    $modal.innerHTML = '<div class="modal-bg"><form class="modal" id="editor"><div class="sec-head"><h2>Calendars</h2><button type="button" class="x" data-close>✕</button></div>' +
      gcals().map(function (c) {
        return '<label class="check cal-pick"><input type="checkbox" data-cal="' + esc(c.id) + '"' + (calHidden(c.id) ? '' : ' checked') + '><i style="background:' + esc(calColor(c)) + '"></i> ' + esc(c.name) + (c.ro ? ' <small>(read-only)</small>' : '') + '</label>';
      }).join('') + '<p class="muted">Hiding a calendar hides it on every device. It stays in Google.</p><div class="modal-actions"><span class="sp"></span><button type="button" class="btn primary" data-close>Done</button></div></form></div>';
    S.modalOpen = true;
    var f = document.getElementById('editor');
    f.addEventListener('change', function (e) { var id = e.target.dataset.cal; if (id) apply(E.opPut('marks', { id: 'cal:' + id, hidden: !e.target.checked }, by(), now())); });
    f.addEventListener('click', function (e) { if (e.target.closest('[data-close]')) closeModal(); });
  }

  function repeatText(rule) {
    var r = E.parseRule(rule); if (!r) return '';
    if (!r.simple) return 'Custom repeat (change it in Google Calendar)';
    var t = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' }[r.freq];
    if (r.freq === 'weekly' && r.days.length) t += ' on ' + r.days.map(function (d) { return DAYNAMES[d]; }).join(', ');
    return t + (r.count ? ', ' + r.count + ' times' : r.until ? ', until ' + niceDay(r.until) : '');
  }
  function sameRule(a, b, start) {
    var x = E.parseRule(a), y = E.parseRule(b), wd = [new Date(start).getDay()];
    if (!x || !y) return !x === !y;
    var dx = x.freq === 'weekly' && !x.days.length ? wd : x.days, dy = y.freq === 'weekly' && !y.days.length ? wd : y.days;
    return x.freq === y.freq && dx.slice().sort().join() === dy.slice().sort().join() && x.count === y.count && x.until === y.until;
  }
  function plainDesc(html) { return String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\n{3,}/g, '\n\n').trim(); }

  function openEventEditor(ev) {
    var isNew = !ev || !ev.id, day = S.calDay || E.dateKey(now());
    var t = Object.assign({ title: '', allDay: false, start: E.at(E.fromKey(day), '10:00'), end: E.at(E.fromKey(day), '11:00') }, ev || {});
    var ro = !!t.ro, dis = ro ? ' disabled' : '', was = isNew ? false : monthlyOn(t);
    var cals = gcals().filter(function (c) { return !c.ro; }), v2 = cals.length > 0, myCal = t.cal || (gcal('') || {}).id || '';
    var rule = E.parseRule(t.rrule), canRule = !rule || rule.simple, desc0 = plainDesc(t.desc);
    var rf = rule && rule.simple ? rule.freq : rule ? 'custom' : 'none', rdays = rule && rule.days.length ? rule.days : [new Date(t.start).getDay()];
    var rend = rule && rule.count ? 'count' : rule && rule.until ? 'until' : 'never';
    var L0 = isNew ? null : E.linkOf(E.linkIndex(S.state), t), link0 = L0 ? L0.link.k + ':' + L0.link.id : t.link && t.link.k ? t.link.k + ':' + t.link.id : '';
    var sk0 = L0 ? E.sessKey(L0, t) : '', ss0 = sk0 ? (S.state.sess || {})[sk0] : null;
    var ixm = E.linkIndex(S.state), Lm = isNew ? null : ixm['i:' + (t.virt || t.id)] || (t.gid && ixm['g:' + t.gid]) || (t.series && ixm['g:' + t.series]);
    var mode0 = t.mode != null ? t.mode : (Lm && Lm.mode) || '';
    var orig = JSON.stringify([t.title, t.allDay, t.start, t.end, myCal, t.color || '', desc0, t.rrule || '', link0, mode0]);
    var sessBox = L0 && !ro && t.start <= now() && linkRec(L0.link) ? '<div class="sess-box"><b>Session</b>' + sessionControls({ e: t, link: L0.link, key: sk0, done: !!(ss0 && ss0.done), tasks: (ss0 && ss0.tasks) || [] }) + '</div>' : '';
    var linkSel = function () {
      var o = function (k, r, label) { var v = k + ':' + r.id; return '<option value="' + esc(v) + '"' + (v === link0 ? ' selected' : '') + '>' + esc(label) + '</option>'; };
      var todos = live('todos').filter(function (x) { var c = (S.state.comps || {})[E.itemKey(S.state, x.id, now())]; return !x.test && (!(c && !c.undone) || 'todo:' + x.id === link0); });
      return '<label class="field">Linked to <small>(its designated period)</small><select name="link"><option value="">Nothing</option>' +
        '<optgroup label="Tasks">' + todos.map(function (x) { return o('todo', x, (x.emoji || '✅') + ' ' + x.title); }).join('') + '</optgroup>' +
        '<optgroup label="Habits">' + live('tasks').filter(function (x) { return !x.test; }).map(function (x) { return o('habit', x, (x.emoji || '🔁') + ' ' + x.title); }).join('') + '</optgroup>' +
        '<optgroup label="Projects">' + live('projects').map(function (x) { return o('project', x, (x.emoji || '🗂️') + ' ' + x.name); }).join('') + '</optgroup></select></label>' +
        '<div class="field f-stasks"></div>';
    };
    var pal = palette(), colorBtns = '<button type="button" class="cp ecp' + (!t.color ? ' on' : '') + '" data-ecolor="" title="Calendar color" style="background:' + esc(gcal(myCal) ? calColor(gcal(myCal)) : EV_COLOR) + '"></button>' +
      Object.keys(pal).map(function (k) { return '<button type="button" class="cp ecp' + (t.color === k ? ' on' : '') + '" data-ecolor="' + k + '" title="' + (GCOLOR_NAMES[k] || '') + '" style="background:' + esc(pal[k]) + '"></button>'; }).join('');
    $modal.innerHTML = modalShell(isNew ? 'New event' : ro ? 'Event (read-only calendar)' : 'Edit event',
      (ro ? '<p class="muted">This calendar is read-only. Here you can only choose whether it shows in the month view.</p>' : '') +
      sessBox + '<label class="field">Title<input name="title" required maxlength="120" value="' + esc(t.title) + '"' + dis + '></label>' +
      (ro ? '' : linkSel() + '<label class="field">🛡️ Restriction mode <small>(on while the event runs)</small><select name="emode"><option value="">None</option>' + allModes().map(function (m) { return '<option value="' + esc(m.id) + '"' + sel(m.id, mode0) + '>' + esc((m.emoji || '🛡️') + ' ' + m.name) + '</option>'; }).join('') + '</select></label>') +
      (v2 && !ro ? '<label class="field">Calendar<select name="cal">' + cals.map(function (c) { return '<option value="' + esc(c.id) + '"' + (c.id === myCal ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select></label>' : '') +
      '<label class="check"><input type="checkbox" name="allDay"' + (t.allDay ? ' checked' : '') + dis + '> All day</label>' +
      '<div class="ev-when"><div class="field">Starts<div class="pair"><input type="date" name="sdate" value="' + E.dateKey(t.start) + '" required' + dis + '><input type="time" name="start" class="f-t" value="' + hm(t.start) + '"' + dis + '></div></div>' +
      '<div class="field">Ends<div class="pair"><input type="date" name="edate" value="' + E.dateKey(t.allDay ? Math.max(t.start, t.end - E.DAY) : t.end) + '" required' + dis + '><input type="time" name="end" class="f-t" value="' + hm(t.end) + '"' + dis + '></div></div></div>' +
      (ro ? '' : '<label class="field">Repeat<select name="rf"' + (canRule ? '' : ' disabled') + '><option value="none"' + sel('none', rf) + '>Does not repeat</option><option value="daily"' + sel('daily', rf) + '>Daily</option><option value="weekly"' + sel('weekly', rf) + '>Weekly</option><option value="monthly"' + sel('monthly', rf) + '>Monthly</option><option value="yearly"' + sel('yearly', rf) + '>Yearly</option>' + (canRule ? '' : '<option value="custom" selected>' + esc(repeatText(t.rrule)) + '</option>') + '</select></label>' +
        '<div class="field f-rdays">On <div class="day-row">' + DAYS.map(function (d, i) { return '<button type="button" class="dp rdp' + (rdays.indexOf(i) >= 0 ? ' on' : '') + '" data-rday="' + i + '">' + d + '</button>'; }).join('') + '</div></div>' +
        '<div class="two f-rend"><label class="field">Ends<select name="rend"><option value="never"' + sel('never', rend) + '>Never</option><option value="until"' + sel('until', rend) + '>On a date</option><option value="count"' + sel('count', rend) + '>After…</option></select></label>' +
        '<label class="field f-runtil">Last day<input type="date" name="runtil" value="' + esc(rule && rule.until || E.dateKey(E.addDays(t.start, 30))) + '"></label><label class="field f-rcount">Times<input type="number" name="rcount" min="1" max="999" value="' + esc(rule && rule.count || 10) + '"></label></div>') +
      (ro ? '' : '<div class="field">Color<div class="color-row">' + colorBtns + '</div></div>') +
      '<label class="field">Description<textarea name="desc" rows="3"' + dis + '>' + esc(desc0) + '</textarea></label>' +
      '<label class="check"><input type="checkbox" name="monthly"' + (was ? ' checked' : '') + '> Show in monthly</label>' +
      (ro ? '' : t.gid ? '<p class="muted">Synced with Google Calendar.</p>' : (S.local.calUrl || (S.local.cal || {}).status ? '' : '<p class="muted">Connect Google Calendar on a computer to sync it there too.</p>')), !isNew && !ro);
    var f = document.getElementById('editor'), color = t.color || '', rd = rdays.slice(), stasks0 = (ss0 && ss0.tasks) || [];
    // Like Google: moving the start moves the end with it (same length); the end can be on a later day.
    var whenOf = function (dk, tm) { return dk ? E.at(E.fromKey(dk), f.allDay.checked ? '00:00' : tm || '00:00') : null; };
    var s0 = whenOf(f.sdate.value, f.start.value);
    var keepLen = function () {
      var ns = whenOf(f.sdate.value, f.start.value); if (ns == null || s0 == null) return;
      var ne = whenOf(f.edate.value, f.end.value), dl = ns - s0; s0 = ns;
      if (ne == null || !dl) return;
      ne += dl; f.edate.value = E.dateKey(ne); if (!f.allDay.checked) f.end.value = hm(ne);
    };
    f.sdate.addEventListener('change', keepLen); f.start.addEventListener('change', keepLen);
    f.allDay.addEventListener('change', function () { s0 = whenOf(f.sdate.value, f.start.value); });
    // A project event: pick the tasks for this one session.
    var paintSt = function () {
      var box = f.querySelector('.f-stasks'); if (!box || !f.link) return;
      var v = f.link.value, pid = v.indexOf('project:') === 0 ? v.slice(8) : '';
      if (!pid) { box.innerHTML = ''; box.style.display = 'none'; return; }
      var list = openTasksOf(pid), ids = {}; list.forEach(function (x) { ids[x.id] = 1; });
      stasks0.forEach(function (id) { var x = (S.state.todos || {})[id]; if (x && !ids[id] && x.project === pid) list.push(x); });
      box.style.display = '';
      box.innerHTML = 'Tasks for this session <small>(this day only)</small>' + (list.length ? '<div class="apps">' + list.map(function (x) { return '<label class="check sm"><input type="checkbox" name="stask" value="' + esc(x.id) + '"' + (stasks0.indexOf(x.id) >= 0 ? ' checked' : '') + '> ' + esc((x.emoji || '') + ' ' + x.title) + '</label>'; }).join('') + '</div>' : '<p class="muted">This project has no open tasks.</p>');
    };
    paintSt(); if (f.link) f.link.addEventListener('change', paintSt);
    f.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-ecolor')) { color = b.getAttribute('data-ecolor'); f.querySelectorAll('.ecp').forEach(function (x) { x.classList.toggle('on', x === b); }); }
      if (b.hasAttribute('data-rday')) { var d = +b.getAttribute('data-rday'), i = rd.indexOf(d); if (i >= 0) { if (rd.length > 1) rd.splice(i, 1); } else rd.push(d); f.querySelectorAll('.rdp').forEach(function (x) { x.classList.toggle('on', rd.indexOf(+x.getAttribute('data-rday')) >= 0); }); }
    });
    wire(t, function (fd) {
      var monthly = !!fd.get('monthly');
      if (!ro) {
        var d = E.fromKey(fd.get('sdate')), d2 = E.fromKey(fd.get('edate') || fd.get('sdate')), c = JSON.parse(JSON.stringify(t));
        c.title = fd.get('title').trim(); c.allDay = !!fd.get('allDay');
        if (c.allDay) { c.start = E.at(d, '00:00'); c.end = E.at(E.addDays(d2, 1), '00:00'); }
        else { c.start = E.at(d, fd.get('start') || '10:00'); c.end = E.at(d2, fd.get('end') || '11:00'); }
        if (c.end <= c.start) return toast('The end is before the start');
        if (v2) { var nc = fd.get('cal') || myCal; if (nc !== myCal) c.oldCal = myCal; c.cal = nc; }
        c.color = color;
        var dsc = (fd.get('desc') || '').trim(); if (dsc !== desc0) c.desc = dsc;
        var nf = fd.get('rf') || rf;
        if (nf !== 'custom') c.rrule = nf === 'none' ? '' : E.buildRule({ freq: nf, days: nf === 'weekly' ? rd : [], count: fd.get('rend') === 'count' ? Math.max(1, +fd.get('rcount') || 1) : 0, until: fd.get('rend') === 'until' ? fd.get('runtil') : '' }, c.allDay);
        var ruleChanged = !sameRule(c.rrule, t.rrule, t.start);
        var lv = fd.get('link') || '', li = lv.indexOf(':');
        if (!c.id) c.id = E.uid();
        if (lv) c.link = { k: lv.slice(0, li), id: lv.slice(li + 1), o: (L0 && L0.o) || c.id };
        else if (L0) c.link = { k: '', id: '', o: L0.o }; else delete c.link;
        var stasks = lv.indexOf('project:') === 0 ? fd.getAll('stask') : null, mv = fd.get('emode') || '';
        if (mv || mode0) c.mode = mv; else delete c.mode;
        if (nf === 'custom' || !ruleChanged) { c.rrule = t.rrule || ''; c.keepRule = true; } else delete c.keepRule;
        var changed = isNew || JSON.stringify([c.title, c.allDay, c.start, c.end, c.cal || myCal, c.color || '', c.desc != null ? c.desc : desc0, c.rrule || '', lv, mv]) !== orig;
        var saveTasks = function () { if (stasks && c.link && JSON.stringify(stasks) !== JSON.stringify(stasks0)) sessPut(E.sessKey({ o: c.link.o }, c), { tasks: stasks }); };
        var save = function (scope) {
          if (scope) c.scope = scope;
          if (!c.series) { if (!c.rrule) delete c.rrule; delete c.keepRule; }
          var patch = E.opPut('events', c, by(), now()); t.id = Object.keys(patch.events)[0]; apply(patch); saveTasks();
          if (monthly !== was) apply(E.opPut('marks', { id: markKey(c), monthly: monthly }, by(), now()));
          S.calDay = fd.get('sdate'); closeModal(); toast(isNew ? '📅 Event added' : 'Saved');
        };
        if (changed && t.series) return scopeBox('Edit repeating event', ruleChanged || (c.cal !== myCal), save);
        if (changed) return save();
        saveTasks();
      }
      if (monthly !== was) apply(E.opPut('marks', { id: markKey(t), monthly: monthly }, by(), now()));
      closeModal(); toast(isNew ? '📅 Event added' : 'Saved');
    }, function () {
      var go = function (scope) { var c = JSON.parse(JSON.stringify(t)); if (scope) c.scope = scope; apply(E.opDel('events', c, by(), now())); closeModal(); };
      if (t.series) return scopeBox('Delete repeating event', false, go, null, true);
      confirmBox('Delete “' + t.title + '”?', t.gid ? 'It is removed from Google Calendar too.' : t.rrule ? 'Every repeat is removed, on every device.' : 'This removes it from every device.', 'Delete', function () { go(''); });
    },
    function (f) {
      f.querySelectorAll('.f-t').forEach(function (x) { x.style.display = f.allDay.checked ? 'none' : ''; });
      if (!f.rf) return;
      var r = f.rf.value;
      f.querySelector('.f-rdays').style.display = r === 'weekly' ? '' : 'none';
      f.querySelector('.f-rend').style.display = r === 'none' || r === 'custom' ? 'none' : '';
      f.querySelector('.f-runtil').style.display = f.rend.value === 'until' ? '' : 'none';
      f.querySelector('.f-rcount').style.display = f.rend.value === 'count' ? '' : 'none';
    });
  }

  function closeModal() { $modal.innerHTML = ''; S.modalOpen = false; render(); }

  function confirmBox(title, text, ok, fn, danger) {
    var el = document.createElement('div');
    el.className = 'modal-bg top-layer';
    el.innerHTML = '<div class="modal small"><h2>' + esc(title) + '</h2><p>' + esc(text) + '</p><div class="modal-actions"><span class="sp"></span><button class="btn ghost" data-no>Cancel</button><button class="btn ' + (danger ? 'danger' : 'primary') + '" data-yes>' + esc(ok) + '</button></div></div>';
    document.body.appendChild(el);
    el.addEventListener('click', function (e) {
      if (e.target.closest('[data-yes]')) { el.remove(); fn(); }
      else if (e.target.closest('[data-no]') || e.target === el) el.remove();
    });
  }

  var toastTimer;
  function toast(msg) {
    var el = document.getElementById('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
    el.textContent = msg; el.className = 'show';
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.className = ''; }, 2200);
  }

  // ---------- live clocks ----------
  function tick() {
    var n = now();
    document.querySelectorAll('[data-left]').forEach(function (el) { el.textContent = dur(+el.getAttribute('data-left') - n); });
    document.querySelectorAll('[data-ago]').forEach(function (el) { el.textContent = dur(n - +el.getAttribute('data-ago')); });
    document.querySelectorAll('[data-clock]').forEach(function (el) { el.textContent = clock(+el.getAttribute('data-clock') - n); });
    document.querySelectorAll('[data-holdleft]').forEach(function (el) { el.textContent = Math.ceil((+el.getAttribute('data-holdleft') - n) / 1000) + ' s'; });
    document.querySelectorAll('[data-hold]').forEach(function (el) { if (el.disabled && +el.getAttribute('data-hold') <= n) { el.disabled = false; el.textContent = el.getAttribute('data-done') || 'Got it'; } });
  }
  var lastMinute = -1, lastTimerFrac = -1, lastNotes = '';
  setInterval(function () {
    tick();
    if (!S.local) return;
    var m = new Date().getMinutes();
    var timer = S.local.timer;
    var busy = S.modalOpen || S.dragging || S.noteEdit || document.querySelector('.top-layer') || (document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName));
    if (timer && timer.endsAt > now()) {
      var total = (timer.minutes || 20) * 60000, frac = Math.round((1 - (timer.endsAt - now()) / total) * 400);
      if (frac !== lastTimerFrac && !busy) { lastTimerFrac = frac; render(); }
    } else if (timer && timer.endsAt <= now() && !busy) render();
    var notesNow = E.pendingNotes(S.state, now()).map(function (n) { return n.id + n.since; }).join();
    if (notesNow !== lastNotes) { lastNotes = notesNow; if (!busy) render(); }
    if (m !== lastMinute) { lastMinute = m; if (!busy) render(); }
  }, 1000);

  window.onNative = function () { if (S.dragging || S.noteEdit) { load(); return; } if (!S.modalOpen) render(); else load(); paintUpd(); };
  if (B.onNative) B.onNative(function () { window.onNative(); });   // desktop: the main process says something changed
  // "Check for updates now" button: live state while a check runs, then the result right away.
  function updState() {
    var U = (S.local && S.local.update) || {}, st = U.status || '', mine = S.updClick && (U.checked || 0) >= S.updClick - 2000;
    var m = /downloading version ([\d.]+): (\d+)%/.exec(st);
    if (m && (U.running || mine)) return { k: 'dl', v: m[1], pct: +m[2] };
    if (/ready: tap Install/.test(st)) return { k: 'install', v: (/version ([\d.]+)/.exec(st) || [])[1] || '' };
    if (/^installing/.test(st)) return { k: 'busy', t: st.charAt(0).toUpperCase() + st.slice(1) };
    if (U.running || (S.updClick && !mine) || (mine && /checking/.test(st))) { if (S.updClick && now() - S.updClick > 200000) { S.updStale = 1; S.updShow = now() + 8000; return { k: 'err', t: 'no answer' }; } return { k: 'busy', t: 'Checking for updates…' }; }
    if (mine || (S.updShow && now() < S.updShow)) {
      if (!S.updShow) S.updShow = now() + 8000;
      if (S.updStale) return { k: 'err', t: 'no answer' };
      if (/up to date/.test(st)) return { k: 'ok', t: 'No updates: ' + (S.local.version || '') + ' is the latest' };
      if (/downloaded|updated/.test(st)) return { k: 'ok', t: st.charAt(0).toUpperCase() + st.slice(1) };
      return { k: 'err', t: st.replace(/^(error|update failed):\s*/, '') || 'failed' };
    }
    return { k: 'idle' };
  }
  function updBtn() {
    var u = updState();
    if (S.updClick && u.k !== 'busy' && u.k !== 'dl') S.updClick = 0;
    if (u.k === 'busy') return '<button class="btn upd busy" disabled><span class="spin"></span>' + esc(u.t) + '</button>';
    if (u.k === 'dl') return '<button class="btn upd busy" disabled style="--p:' + u.pct + '%"><span class="spin"></span>Found version ' + esc(u.v) + ': downloading ' + u.pct + '%</button>';
    if (u.k === 'install') return '<button class="btn primary upd" data-a="test" data-id="install">⬆️ Install version ' + esc(u.v) + '</button>';
    if (u.k === 'ok') return '<button class="btn upd good" data-a="test" data-id="update">✅ ' + esc(u.t) + '</button>';
    if (u.k === 'err') return '<button class="btn upd bad" data-a="test" data-id="update">⚠️ Check failed: ' + esc(u.t) + ' · tap to retry</button>';
    return '<button class="btn upd" data-a="test" data-id="update">Check for updates now</button>';
  }
  function paintUpd() { var el = document.getElementById('updBox'); if (el) el.innerHTML = updBtn(); }
  setInterval(function () { if (S.updClick || S.updShow) { if (S.updShow && now() >= S.updShow) { S.updShow = 0; S.updStale = 0; } paintUpd(); } }, 1000);
  window.setMode = function (mode, task) { S.mode = mode || 'main'; S.modeTask = task || ''; if (!S.modalOpen) render(); };
  render();
})();
