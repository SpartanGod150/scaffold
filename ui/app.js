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
  var LEVELS = [
    null,
    { icon: '🔔', name: 'Nudge', desc: 'Notifications only.' },
    { icon: '📣', name: 'Nag', desc: 'Pop-ups that take over the screen.' },
    { icon: '🔒', name: 'Lock at deadline', desc: 'Not done by the deadline? Every device locks until it is.' },
    { icon: '⛓️', name: 'Lock from start', desc: 'Every device stays locked from the start time until it is done.' }
  ];
  var TEMPLATES = [
    { emoji: '🪥', title: 'Brush teeth', start: '07:00', due: '08:00', level: 4, kind: 'check', remind: 15, color: '#5cc8ff', desktop: 'lock' },
    { emoji: '🛏️', title: 'Make the bed', start: '07:00', due: '09:00', level: 2, kind: 'check', remind: 30, color: '#c58cff', desktop: 'none' },
    { emoji: '📖', title: 'Read', start: '20:00', due: '21:30', level: 3, kind: 'timer', minutes: 20, tiny: 'Read 1 page', remind: 30, color: '#ffb86b', desktop: 'lock' },
    { emoji: '📚', title: 'Study', start: '14:00', due: '18:00', level: 3, kind: 'timer', minutes: 45, tiny: 'Study 10 minutes', remind: 45, color: '#7c9cff', desktop: 'focus' },
    { emoji: '💻', title: 'Work on a project', start: '15:00', due: '20:00', level: 2, kind: 'timer', minutes: 30, tiny: 'Open the project for 5 minutes', remind: 60, color: '#5ed3a8', desktop: 'focus' },
    { emoji: '🧹', title: 'Tidy up', start: '18:00', due: '21:00', level: 2, kind: 'timer', minutes: 10, remind: 45, color: '#ffd75e', desktop: 'none' }
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
    tickNote: function (id, line) { var n = S.state.notes[id]; if (!n) return; var c = JSON.parse(JSON.stringify(n)); c.anchor = c.anchor || c.ts; c.text = noteTick(c.text, +line); apply(E.opPut('notes', c, by(), now())); },
    dismissNote: function (id) { apply(E.opAck(id, by(), now())); delete S.noteSeen[id]; if (S.mode === 'note' && !E.pendingNotes(S.state, now()).filter(function (n) { return n.id !== id; }).length) B.closeWindow(); },
    calPrev: function () { calMove(-1); },
    calNext: function () { calMove(1); },
    calToday: function () { S.calDay = null; S.calScroll = null; render(); },
    calPick: function (key) { S.calDay = key; S.calView = 'day'; lsSet('scaffold-calview', 'day'); render(); },
    calView: function (v) { S.calView = v; lsSet('scaffold-calview', v); render(); },
    calCals: function () { openCalendars(); },
    calMode: function (m) { S.calList = m === 'list'; lsSet('scaffold-callist', S.calList ? '1' : '0'); render(); },
    editEvent: function (id) {
      var all = E.eventsFor(S.state), e = id && all[id] ? JSON.parse(JSON.stringify(all[id])) : null;
      if (e && e.virt) e = JSON.parse(JSON.stringify(S.state.events[e.virt]));   // not on Google yet: edit the whole series
      if (e) { delete e.synced; delete e.gupd; }
      openEventEditor(e);
    },
    perm: function (n) { B.openPermission(n); },
    test: function (k) {
      if (k === 'lock') {
        var d = new Date(); d.setSeconds(0, 0);
        apply(E.opTask({ title: 'Test lock: tap “I did it”', emoji: '🧪', start: hm(d), due: hm(d), days: [d.getDay()], level: 4, kind: 'check', remind: 30, color: '#ff7a90', desktop: 'lock', test: true }, by(), now()));
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
    var lockHere = S.r.lock && !S.r.paused && !(PLATFORM === 'desktop' && (S.r.lock.task.desktop || 'lock') !== 'lock');
    if (lockHere) return paint(blockView(S.r.lock));
    if (S.mode === 'block') { S.mode = 'main'; if (PLATFORM === 'desktop') return B.closeWindow(); }
    if (S.mode === 'remind') {
      var it = item(S.modeTask);
      if (it && !it.done && !S.r.paused) return paint(remindView(it));
      return B.closeWindow();
    }
    paint(shell());
  }
  function paint(html) {
    var full = /^<section class="(block|remind)/.exec(html), key = full ? full[1] + (S.r.lock ? S.r.lock.id : S.modeTask) : '';
    if (key && key !== S.guardKey) { S.guardUntil = Date.now() + 1500; S.guardKey = key; } else if (!key) S.guardKey = '';
    $app.innerHTML = html; tick(); wireTimeline();
  }

  function shell() {
    var views = { today: todayView, calendar: calendarView, tasks: tasksView, habits: habitsView, notes: notesView, settings: settingsView };
    var tabs = [['today', '☀️', 'Today'], ['calendar', '📅', 'Calendar'], ['tasks', '✅', 'Tasks'], ['habits', '🔁', 'Habits'], ['notes', '📌', 'Notes']];
    var nav = tabs.map(function (t) { return '<button class="tab' + (S.view === t[0] ? ' on' : '') + '" data-a="nav" data-id="' + t[0] + '"><span>' + t[1] + '</span>' + t[2] + '</button>'; }).join('');
    return '<header class="top">' +
      '<div class="brand"><span class="logo">▦</span> Scaffold</div><div class="top-r">' +
      (S.r.paused ? '<button class="pill go" data-a="resume">▶ Resume</button>' : '<button class="pill stop" data-a="stopAll">⛔ Stop all</button>') +
      '<button class="gear' + (S.view === 'settings' ? ' on' : '') + '" data-a="nav" data-id="settings" title="Settings">⚙️</button></div>' +
      '</header>' +
      (S.r.lock && !S.r.paused ? '<div class="banner lockb">🔒 <b>' + esc(S.r.lock.task.title) + '</b> is overdue: ' + ((S.r.lock.task.desktop === 'focus') ? 'distracting apps are being closed' : 'your other devices are locked') + ' until it is done.</div>' : '') +
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
    var todayItems = r.items.filter(function (i) { return !i.nudge || i.status === 'late' || i.done; });
    var later = r.items.filter(function (i) { return i.nudge && i.status !== 'late' && !i.done; });
    var next = todayItems.filter(function (i) { return !i.done; })[0];
    var hero = '<section class="hero">' +
      ring(pct == null ? 0 : pct / 100, 132, 12, pctColor(pct), '<b>' + (pct == null ? '–' : pct + '%') + '</b><small>habits · 7d</small>') +
      '<div class="hero-txt"><div class="big">' + r.done + ' / ' + r.total + ' <span>done</span></div>' +
      '<div class="goal">Goal: <b>80%</b> of habits, every week</div>' +
      (next ? '<div class="next">Next: ' + esc(next.task.emoji) + ' <b>' + esc(next.task.title) + '</b> · ' + (next.status === 'upcoming' ? 'starts ' + hm(next.start) : next.status === 'open' ? '<span data-left="' + next.due + '"></span> left' : '<span class="late-t">late</span>') + '</div>' : (r.total ? '<div class="next good">Everything done today 🎉</div>' : '')) +
      '</div></section>';
    var pending = function (list) { return list.filter(function (i) { return !i.done; }).concat(list.filter(function (i) { return i.done; })); };
    return hero + timeline(todayItems.filter(function (i) { return !i.nudge; })) +
      '<section class="cards">' + (todayItems.length ? pending(todayItems).map(card).join('') : '<p class="empty">Nothing due today. Enjoy it.</p>') + '</section>' +
      (later.length ? '<h3 class="mt">Due later</h3><section class="cards">' + later.map(card).join('') + '</section>' : '');
  }

  function welcome() {
    return '<section class="welcome"><h1>Hi! 👋</h1><p>Scaffold keeps you on track across your phone, tablet and computers.</p>' +
      '<p><b>🔁 Habits</b>: things you do every day (or on set weekdays).<br><b>✅ Tasks</b>: one-time or repeating, with deadlines, grouped in projects.<br><b>📌 Notes</b>: thoughts that pop up until you read them.<br><b>📅 Calendar</b>: all of it, plus your Google Calendar.</p>' +
      '<h3>Quick start: a habit</h3><div class="tpl-grid">' + TEMPLATES.map(function (t, i) {
        return '<button class="tpl" data-a="template" data-id="' + i + '" style="--c:' + t.color + '"><span>' + t.emoji + '</span>' + esc(t.title) + '<small>' + LEVELS[t.level].icon + ' ' + LEVELS[t.level].name + '</small></button>';
      }).join('') + '</div><div class="row-btns"><button class="btn" data-a="editHabit">＋ Habit</button><button class="btn" data-a="editTodo">＋ Task</button><button class="btn" data-a="editNote">＋ Note</button></div></section>';
  }

  function timeline(items) {
    if (!items.length) return '';
    var d = new Date(), dayStart = E.at(now(), '00:00');
    var first = Math.min.apply(null, items.map(function (i) { return i.start; }));
    var from = Math.min(E.at(now(), '06:00'), first - 30 * E.MIN), to = dayStart + 24 * 60 * E.MIN, span = to - from;
    function x(t) { return ((Math.max(from, Math.min(to, t)) - from) / span * 100).toFixed(2) + '%'; }
    var hours = '';
    for (var h = Math.ceil((from - dayStart) / 3600000); h <= 24; h += 3) hours += '<i style="left:' + x(dayStart + h * 3600000) + '">' + E.pad(h % 24) + '</i>';
    var bars = items.map(function (it) {
      var w = Math.max(1.5, (it.due - it.start) / span * 100);
      return '<div class="tl-row"><div class="tl-bar ' + it.status + '" style="left:' + x(it.start) + ';width:' + w.toFixed(2) + '%;--c:' + taskColor(it.task) + '">' + esc(it.task.emoji) + '</div></div>';
    }).join('');
    return '<section class="timeline"><div class="tl-hours">' + hours + '</div>' + bars + '<div class="tl-now" style="left:' + x(d.getTime()) + '"></div></section>';
  }

  function statusChip(it) {
    if (it.done) return '<span class="chip done">' + (it.doneKind === 'tiny' ? '🌱 tiny win' : '✓ done') + '</span>';
    if (it.locked) return '<span class="chip lock">🔒 locked</span>';
    if (it.snoozedUntil) return '<span class="chip">⏸ until ' + hm(it.snoozedUntil) + '</span>';
    if (it.nudge && it.status !== 'late') return '<span class="chip">due ' + niceDay(it.deadlineDay) + ' ' + hm(it.due) + '</span>';
    if (it.nudge) return '<span class="chip late">late · was due ' + niceDay(it.deadlineDay) + '</span>';
    if (it.status === 'upcoming') return '<span class="chip">starts ' + hm(it.start) + '</span>';
    if (it.status === 'open') return '<span class="chip open">⏳ <span data-left="' + it.due + '"></span> left</span>';
    return '<span class="chip late">late · since ' + hm(it.due) + '</span>';
  }

  function actions(it, compact) {
    if (it.done) return '<button class="btn ghost sm" data-a="undo" data-id="' + it.id + '">Undo</button>';
    var t = it.task, h = '';
    if (t.kind === 'timer') h += '<button class="btn primary" data-a="timer" data-id="' + it.id + '">▶ Start ' + (t.minutes || 20) + ' min</button>';
    else h += '<button class="btn primary" data-a="done" data-id="' + it.id + '">✓ I did it</button>';
    if (t.tiny) h += '<button class="btn tiny" data-a="done" data-id="' + it.id + '" data-k="tiny">🌱 ' + esc(t.tiny) + '</button>';
    if (!compact && !it.nudge && it.status !== 'upcoming' && it.snoozesLeft > 0 && !it.snoozedUntil) h += '<button class="btn ghost sm" data-a="snooze" data-id="' + it.id + '">⏸ ' + E.SNOOZE_MIN + ' min (' + it.snoozesLeft + ' left)</button>';
    return h;
  }

  function card(it) {
    var t = it.task, proj = projectOf(t);
    var frac = it.nudge ? 0 : it.status === 'open' ? (now() - it.start) / Math.max(1, it.due - it.start) : it.status === 'late' ? 1 : 0;
    var when = it.nudge ? '' : hm(it.start) + (it.due !== it.start ? '–' + hm(it.due) : '') + ' · ';
    return '<article class="card s-' + it.status + (it.done ? ' is-done' : '') + '" style="--c:' + taskColor(t) + '">' +
      '<div class="card-top"><div class="emoji">' + esc(t.emoji || '•') + '</div>' +
      '<div class="card-main"><div class="kind">' + (it.type === 'habit' ? '🔁 Habit' : '✅ Task' + (proj ? ' · ' + esc(proj.emoji || '') + ' ' + esc(proj.name) : '')) + '</div><h3>' + esc(t.title) + '</h3><div class="meta">' + when + LEVELS[t.level || 1].icon + ' ' + LEVELS[t.level || 1].name + (t.kind === 'timer' ? ' · ⏱ ' + (t.minutes || 20) + ' min' : '') + '</div>' +
      statusChip(it) + '</div></div>' +
      (!it.done && !it.nudge ? '<div class="time-bar"><i style="width:' + Math.round(frac * 100) + '%"></i></div>' : '') +
      '<div class="card-actions">' + actions(it) + '</div></article>';
  }

  // ---------- full-screen modes ----------
  function blockView(it) {
    var t = it.task, isLate = now() >= it.due;
    return '<section class="block" style="--c:' + taskColor(t) + '">' +
      '<div class="block-emoji">' + esc(t.emoji || '🔒') + '</div>' +
      '<div class="block-kicker">🔒 Your devices are locked until you do this</div>' +
      '<h1>' + esc(t.title) + '</h1>' +
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
    return '<button class="btn wa" data-a="dialer">📞 Phone</button>' + (t.allowApps || []).filter(function (p) { return appNames[p]; }).map(function (p) {
      return '<button class="btn wa" data-a="openApp" data-id="' + esc(p) + '">' + esc(appNames[p]) + '</button>';
    }).join('');
  }

  function remindView(it) {
    var t = it.task;
    var when = it.nudge ? 'Due ' + niceDay(it.deadlineDay) + ' ' + hm(it.due) : it.status === 'upcoming' ? 'Starts ' + hm(it.start) : it.status === 'open' ? 'Due ' + hm(it.due) + ' · <span data-left="' + it.due + '"></span> left' : 'Late · deadline was ' + hm(it.due);
    var lockWarn = ((t.level || 1) === 3 && it.status !== 'late') ? '<div class="warn">🔒 Devices lock at ' + hm(it.due) + (it.nudge ? ' on ' + niceDay(it.deadlineDay) : '') + ' if this is not done.</div>' : '';
    return '<section class="remind" style="--c:' + taskColor(t) + '"><div class="remind-emoji">' + esc(t.emoji) + '</div>' +
      '<h2>' + esc(t.title) + '</h2><div class="remind-sub">' + when + '</div>' + lockWarn +
      '<div class="remind-actions">' + actions(it) + '<button class="btn ghost sm" data-a="close">Later</button></div></section>';
  }

  function noteView(p, count) {
    var n = p.note, key = p.id + '@' + p.since;
    if (!S.noteSeen[p.id] || S.noteSeen[p.id].key !== key) S.noteSeen[p.id] = { key: key, at: now() };
    var hold = Math.max(0, +n.hold || 0) * 1000, until = S.noteSeen[p.id].at + hold;
    return '<section class="note-pop" style="--c:' + taskColor(n) + '"><div class="note-kicker">📌 Note' + (count > 1 ? ' · 1 of ' + count : '') + '</div>' +
      '<div class="note-text md">' + mdHtml(n.text, p.id) + '</div>' +
      '<div class="note-meta">Comes back every ' + everyLabel(n.every) + '</div>' +
      '<button class="btn primary big" data-a="dismissNote" data-id="' + p.id + '" data-hold="' + until + '"' + (until > now() ? ' disabled' : '') + '>' + (until > now() ? 'Read it… <span data-holdleft="' + until + '"></span>' : 'Got it') + '</button>' +
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
  function calView() { return S.calView || lsGet('scaffold-calview') || 'month'; }
  function calList() { return S.calList != null ? S.calList : lsGet('scaffold-callist') === '1'; }
  function calAnchor() { return S.calDay || E.dateKey(now()); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function weekStart(key) { var t = E.fromKey(key); return E.addDays(t, -((new Date(t).getDay() + 6) % 7)); }
  // "Show in monthly" lives in state.marks (events from Google can't carry it); repeating Google events share one mark.
  function markKey(e) { return e.series ? 'gid:' + e.series : e.ro && e.gid ? 'gid:' + e.gid : e.virt || e.id; }
  // Google calendars and colors (bridge v2). Hidden calendars are hidden on every device (marks 'cal:'+id).
  var GCOLORS = { 1: '#a4bdfc', 2: '#7ae7bf', 3: '#dbadff', 4: '#ff887c', 5: '#fbd75b', 6: '#ffb878', 7: '#46d6db', 8: '#e1e1e1', 9: '#5484ed', 10: '#51b749', 11: '#dc2127' };
  var GCOLOR_NAMES = { 1: 'Lavender', 2: 'Sage', 3: 'Grape', 4: 'Flamingo', 5: 'Banana', 6: 'Tangerine', 7: 'Peacock', 8: 'Graphite', 9: 'Blueberry', 10: 'Basil', 11: 'Tomato' };
  function gcalInfo() { return ((S.state.gev || {})._cals) || null; }
  function gcals() { var g = gcalInfo(); return g ? g.list || [] : []; }
  function gcal(id) { var l = gcals(); for (var i = 0; i < l.length; i++) if (l[i].id === id || (!id && l[i].primary)) return l[i]; return null; }
  function palette() { var g = gcalInfo(); return (g && g.colors && Object.keys(g.colors).length) ? g.colors : GCOLORS; }
  function calHidden(id) { var c = id || (gcal('') || {}).id; var r = (S.state.marks || {})['cal:' + c]; return !!(r && !r.del && r.hidden); }
  function evColor(e) { if (e.color && palette()[e.color]) return palette()[e.color]; var c = gcal(e.cal || ''); return (c && c.color) || EV_COLOR; }
  function inkOn(hex) { var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex || ''); if (!m) return '#0f1117'; var l = (0.299 * parseInt(m[1], 16) + 0.587 * parseInt(m[2], 16) + 0.114 * parseInt(m[3], 16)) / 255; return l > 0.6 ? '#0f1117' : '#ffffff'; }
  function shownAgenda(t) { return E.dayAgenda(S.state, t).filter(function (a) { return a.kind !== 'event' || !calHidden(a.rec.cal); }); }
  function monthlyOn(e) { var m = S.state.marks || {}, r = m[markKey(e)]; return !!(r && !r.del && r.monthly); }

  function calendarView() {
    var v = calView(), key = calAnchor(), d = new Date(E.fromKey(key)), title;
    if (v === 'month') title = MONTHS[d.getMonth()] + ' ' + d.getFullYear();
    else if (v === 'week') {
      var a = new Date(weekStart(key)), b = new Date(E.addDays(weekStart(key), 6));
      title = MONTHS[a.getMonth()].slice(0, 3) + ' ' + a.getDate() + ' – ' + (a.getMonth() !== b.getMonth() ? MONTHS[b.getMonth()].slice(0, 3) + ' ' : '') + b.getDate();
    } else title = cap(niceDay(key)) + (/^(today|tomorrow|yesterday)$/.test(niceDay(key)) ? ' · ' + DAYNAMES[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()].slice(0, 3) : '');
    var seg = function (items, act, cur) { return '<div class="seg">' + items.map(function (x) { return '<button class="seg-b' + (x[0] === cur ? ' on' : '') + '" data-a="' + act + '" data-id="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>'; };
    var body;
    if (v === 'month') body = monthGrid(key);
    else if (v === 'week') { var ks = []; for (var i = 0; i < 7; i++) ks.push(E.dateKey(E.addDays(weekStart(key), i))); body = timeline(ks); }
    else body = calList() ? dayList(key) : timeline([key]);
    var cal = S.local.cal || {};
    return '<div class="sec-head cal-top"><h2>' + esc(title) + '</h2><div class="row-btns"><button class="btn ghost sm" data-a="calPrev">‹</button><button class="btn ghost sm" data-a="calToday">Today</button><button class="btn ghost sm" data-a="calNext">›</button></div></div>' +
      '<div class="cal-bar">' + seg([['month', 'Month'], ['week', 'Week'], ['day', 'Day']], 'calView', v) +
      (v === 'day' ? seg([['cv', 'Timeline'], ['list', 'List']], 'calMode', calList() ? 'list' : 'cv') : '') +
      (gcals().length ? '<button class="btn ghost sm" data-a="calCals">Calendars</button>' : '') +
      '<span class="sp"></span><button class="btn primary sm" data-a="editEvent">＋ Event</button></div>' + body +
      '<div class="legend cal-legend">' + (cal.status ? '<span class="lg-note">Google: ' + esc(cal.status) + '</span>' : '<span class="lg-note">Google Calendar: not connected (Settings)</span>') + '</div>';
  }

  function monthGrid(key) {
    var m = new Date(E.fromKey(key)), today = E.dateKey(now());
    var first = new Date(m.getFullYear(), m.getMonth(), 1), offset = (first.getDay() + 6) % 7, daysIn = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
    var cells = '';
    for (var i = 0; i < offset; i++) cells += '<i class="cal-blank"></i>';
    for (var dn = 1; dn <= daysIn; dn++) {
      var t = new Date(m.getFullYear(), m.getMonth(), dn, 12).getTime(), k = E.dateKey(t), chips = [], due = false;
      shownAgenda(t).forEach(function (a) {
        if (a.kind === 'event' && monthlyOn(a.rec)) chips.push('<i class="chip ev" style="background:' + evColor(a.rec) + ';color:' + inkOn(evColor(a.rec)) + '">' + esc(a.rec.title) + '</i>');
        else if (a.kind === 'todo' && a.rec.monthly && !a.done) { due = true; chips.push('<i class="chip dl">' + esc(a.rec.title) + ' Deadline</i>'); }
      });
      var shown = chips.length > 3 ? chips.slice(0, 2).concat('<i class="chip more">+' + (chips.length - 2) + ' more</i>') : chips;
      cells += '<button class="cal-day' + (k === today ? ' today' : '') + (due ? ' due' : '') + '" data-a="calPick" data-id="' + k + '"><b>' + dn + '</b><span class="chips">' + shown.join('') + '</span></button>';
    }
    return '<div class="cal-head">' + WEEKDAYS.map(function (w) { return '<i>' + w + '</i>'; }).join('') + '</div><div class="cal-grid month">' + cells + '</div>';
  }

  // The day as a list (the old agenda), without "(repeating)".
  function dayList(key) {
    var rows = shownAgenda(E.fromKey(key)).map(function (a) {
      var r = a.rec;
      if (a.kind === 'event') return '<button class="ag-row ev" data-a="editEvent" data-id="' + a.id + '" style="--c:' + evColor(r) + '"><span class="ag-t">' + (r.allDay ? 'all day' : hm(r.start) + '–' + hm(r.end)) + '</span><span class="ag-x">' + (r.gid ? '<i class="gtag">G</i>' : '📅') + ' ' + esc(r.title) + '</span></button>';
      if (a.kind === 'todo') return '<button class="ag-row td' + (a.done ? ' dn' : '') + '" data-a="editTodo" data-id="' + a.id + '" style="--c:' + taskColor(r) + '"><span class="ag-t">' + esc(r.start || '') + (r.due ? '–' + esc(r.due) : '') + '</span><span class="ag-x">' + (a.done ? '✓ ' : '') + esc(r.emoji || '✅') + ' ' + esc(r.title) + '</span></button>';
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
    return items;
  }

  // Week / day timeline: events solid, habits dotted and see-through (done ones stronger). Tap empty time = new event.
  function timeline(keys) {
    var today = E.dateKey(now()), heads = '', alls = '', cols = '', anyAll = false;
    keys.forEach(function (k) {
      var t = E.fromKey(k), d0 = E.at(t, '00:00'), d1 = E.at(E.addDays(t, 1), "00:00"), items = [], ad = [];
      shownAgenda(t).forEach(function (a) {
        var r = a.rec;
        if (a.kind === 'event') {
          var s = Math.max(r.start, d0), e = Math.min(r.end || r.start + 30 * E.MIN, d1);
          if (r.allDay || e - s >= d1 - d0) { ad.push(a); return; }
          items.push({ a: a, s: s, e: Math.max(e, s + 15 * E.MIN), color: evColor(r), drag: !r.ro && !r.virt && r.start >= d0 && (r.end || 0) <= d1 });
        } else if (a.kind === 'habit') {
          var hs = E.at(t, r.start || '00:00'), he = r.due ? E.at(t, r.due) : hs + 30 * E.MIN;
          if (he <= hs) he = hs + 30 * E.MIN;
          items.push({ a: a, s: hs, e: he, color: taskColor(r) });
        }
      });
      anyAll = anyAll || ad.length > 0;
      var d = new Date(t);
      heads += '<div class="cv-dh' + (k === today ? ' today' : '') + '" data-a="calPick" data-id="' + k + '"><small>' + WEEKDAYS[(d.getDay() + 6) % 7] + '</small><b>' + d.getDate() + '</b></div>';
      alls += '<div class="cv-ad">' + ad.map(function (a) { return '<button class="chip ev" data-a="editEvent" data-id="' + a.id + '" style="background:' + evColor(a.rec) + ';color:' + inkOn(evColor(a.rec)) + '">' + esc(a.rec.title) + '</button>'; }).join('') + '</div>';
      var blocks = layoutDay(items).map(function (it) {
        var a = it.a, r = a.rec, top = (it.s - d0) / 3600000 * HOUR_PX, h = Math.max(16, (it.e - it.s) / 3600000 * HOUR_PX - 2);
        var cls = 'cv-ev ' + (a.kind === 'habit' ? 'hb' + (a.done ? ' dn' : '') : 'ev') + (it.drag ? ' drag' : '') + (h < 34 ? ' short' : '');
        var act = a.kind === 'habit' ? 'editHabit' : 'editEvent';
        return '<div class="' + cls + '" data-a="' + act + '" data-id="' + a.id + '" data-ev="' + a.id + '" data-s="' + it.s + '" data-e="' + it.e + '" style="top:' + top + 'px;height:' + h + 'px;left:calc(' + (it.col / it.cols * 100) + '% + 1px);width:calc(' + (100 / it.cols) + '% - 3px);--c:' + it.color + ';--ink:' + inkOn(it.color) + '">' +
          '<b>' + (a.kind === 'habit' && a.done ? '✓ ' : '') + esc((a.kind === 'habit' && r.emoji ? r.emoji + ' ' : '') + r.title) + '</b><small>' + hm(it.s) + '–' + hm(it.e) + '</small>' + (it.drag ? '<i class="rs"></i>' : '') + '</div>';
      }).join('');
      var nowLine = k === today ? '<i class="cv-now" style="top:' + ((now() - d0) / 3600000 * HOUR_PX) + 'px"></i>' : '';
      cols += '<div class="cv-col' + (k === today ? ' today' : '') + '" data-day="' + k + '">' + blocks + nowLine + '</div>';
    });
    var hours = ''; for (var hh = 1; hh < 24; hh++) hours += '<i style="top:' + hh * HOUR_PX + 'px">' + (hh < 10 ? '0' : '') + hh + ':00</i>';
    var grid = 'grid-template-columns: 44px repeat(' + keys.length + ', minmax(0, 1fr))';
    return '<div class="cv n' + keys.length + '" style="--h:' + HOUR_PX + 'px">' +
      (keys.length > 1 ? '<div class="cv-row" style="' + grid + '"><i></i>' + heads + '</div>' : '') +
      (anyAll ? '<div class="cv-row cv-alls" style="' + grid + '"><i class="cv-gut">all day</i>' + alls + '</div>' : '') +
      '<div class="cv-scroll"><div class="cv-body" style="' + grid + ';height:' + 24 * HOUR_PX + 'px"><div class="cv-hours">' + hours + '</div>' + cols + '</div></div></div>';
  }

  // After each paint: keep the timeline's scroll position, wire taps on empty time and drag to move / resize events.
  function wireTimeline() {
    var sc = $app.querySelector('.cv-scroll'); if (!sc) return;
    if (S.calScroll == null) { var n = new Date(); S.calScroll = Math.max(0, Math.min((n.getHours() - 1.5) * HOUR_PX, 24 * HOUR_PX)); if (n.getHours() < 8) S.calScroll = 7 * HOUR_PX; }
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
      var rep = t.repeat || 'none', p = E.periodOf(t, now()), c = p ? (S.state.comps || {})[E.compKey(t.id, p.key)] : null, done = c && !c.undone;
      if (rep !== 'none') groups.repeat.push(t);
      else if (!t.date) groups.someday.push(t);
      else if (done) groups.done.push(t);
      else if (t.date <= today) groups.now.push(t);
      else groups.later.push(t);
    });
    groups.later.sort(function (a, b) { return a.date.localeCompare(b.date); });
    groups.done.sort(function (a, b) { return b.date.localeCompare(a.date); });
    function sec(title, list) { return list.length ? '<h3 class="mt">' + title + '</h3>' + list.map(todoRow).join('') : ''; }
    return '<div class="sec-head"><h2>Projects</h2><button class="btn sm" data-a="editProject">＋ Project</button></div>' +
      (projects.length ? '<div class="proj-grid">' + projects.map(projectCard).join('') + '</div>' : '<p class="empty">No projects yet.</p>') +
      (vault.length ? '<details class="vault"><summary>🗂️ From your Obsidian vault (' + vault.length + ' active)</summary>' + vault.map(function (v) {
        return '<div class="row vrow"><span class="row-main"><b>' + esc(v.name) + '</b><small>' + (v.total || v.items.length) + ' open items' + (v.desc ? ' · ' + esc(v.desc.slice(0, 70)) : '') + '</small></span><button class="btn sm" data-a="bringIn" data-id="' + esc(v.key) + '">Bring in</button></div>';
      }).join('') + '</details>' : '') +
      '<div class="sec-head mt2"><h2>Tasks</h2><button class="btn primary sm" data-a="editTodo">＋ Task</button></div>' +
      (todos.length ? sec('Today and overdue', groups.now) + sec('Coming up', groups.later) + sec('Repeating', groups.repeat) + sec('Someday (no date)', groups.someday) + sec('Done', groups.done.slice(0, 10)) : '<p class="empty">No tasks yet.</p>');
  }

  function todoWhen(t) {
    var rep = t.repeat || 'none', by = t.dueEnd ? 'end of day' : (t.due || '21:00');
    if (rep === 'custom') { var full = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], ds = (t.days || []).slice().sort(); return (ds.length && ds.length < 7 ? ds.map(function (d) { return full[d]; }).join(', ') : 'Every day') + ' · by ' + by; }
    if (rep === 'week') return 'Every week · by ' + WEEKDAYS[t.dueDay == null ? 6 : +t.dueDay] + ' ' + by;
    if (rep === 'month') return 'Every month · by day ' + (t.dueDay || 'last') + ' ' + by;
    if (rep === 'days') return 'Every ' + (t.every || 2) + ' days · by ' + by;
    if (!t.date) return 'No date';
    return niceDay(t.date) + (t.start ? ' ' + t.start : '') + (t.due ? '–' + t.due : '');
  }
  function todoRow(t) {
    var proj = projectOf(t), p = E.periodOf(t, now()), c = p ? (S.state.comps || {})[E.compKey(t.id, p.key)] : null, done = c && !c.undone;
    var late = !done && (t.repeat || 'none') === 'none' && t.date && t.date < E.dateKey(now());
    return '<button class="row' + (done ? ' dn' : '') + '" data-a="editTodo" data-id="' + t.id + '" style="--c:' + taskColor(t) + '">' +
      '<span class="emoji sm">' + esc(t.emoji || '✅') + '</span><span class="row-main"><b>' + (done ? '✓ ' : '') + esc(t.title) + '</b><small' + (late ? ' class="late-t"' : '') + '>' + esc(todoWhen(t)) + (proj ? ' · ' + esc(proj.name) : '') + '</small></span>' +
      '<span class="row-lvl">' + LEVELS[t.level || 1].icon + '</span></button>';
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
    var byId = {}; st.tasks.forEach(function (x) { byId[x.id] = x; });
    var list = live('tasks').filter(function (t) { return !t.test; }).sort(function (a, b) { return ((a.active === false) - (b.active === false)) || (a.start || '').localeCompare(b.start || ''); });
    var lockedId = S.r.lock && S.r.lock.id;
    var rows = list.map(function (t) {
      var x = byId[t.id], on = t.active !== false;
      var days = (t.days && t.days.length && t.days.length < 7) ? t.days.map(function (d) { return DAYNAMES[d]; }).join(' ') : 'Every day';
      var p = x && x.week != null ? Math.round(x.week * 100) + '%' : '–';
      return '<div class="stat-row' + (on ? '' : ' off') + '" style="--c:' + taskColor(t) + '"><div class="stat-head">' +
        '<button class="habit-open" ' + (t.id === lockedId ? 'disabled title="Locked habits cannot be edited"' : 'data-a="editHabit" data-id="' + t.id + '"') + '><span class="emoji sm">' + esc(t.emoji) + '</span><span class="row-main"><b>' + esc(t.title) + '</b><small>' + esc(t.start) + '–' + esc(t.due) + ' · ' + days + ' · ' + LEVELS[t.level || 1].icon + '</small></span></button>' +
        '<span class="stat-num">' + p + '</span>' + (x && x.streak ? '<span class="streak">🔥 ' + x.streak + '</span>' : '') +
        '<button class="switch' + (on ? ' on' : '') + '" data-a="toggleHabit" data-id="' + t.id + '" title="' + (on ? 'Active' : 'Paused') + '"><i></i></button></div>' +
        (x ? '<div class="heat">' + x.cells.map(function (c) { return '<i class="h-' + c.s + '" title="' + c.day + '"></i>'; }).join('') + '</div>' : '') + '</div>';
    }).join('');
    return '<div class="sec-head"><h2>Habits</h2><button class="btn primary sm" data-a="editHabit">＋ Habit</button></div>' +
      '<section class="hero">' + ring(pct == null ? 0 : pct / 100, 110, 11, pctColor(pct), '<b>' + (pct == null ? '–' : pct + '%') + '</b><small>7 days</small>') +
      '<div class="hero-txt"><div class="big">' + (pct == null ? 'No data yet' : pct >= 80 ? 'On target 🎯' : 'Goal: 80%') + '</div>' +
      '<div class="goal">Full = 1 · 🌱 tiny win = ½</div><div class="goal">⛔ Emergency stops this week: <b>' + st.stops + '</b></div></div></section>' +
      '<div class="legend"><span><i class="h-full"></i>done</span><span><i class="h-tiny"></i>tiny</span><span><i class="h-miss"></i>missed</span><span><i class="h-none"></i>off day</span><span class="lg-note">last 4 weeks →</span></div>' +
      (rows || '<p class="empty">No habits yet.</p>') +
      '<h3 class="mt">Templates</h3><div class="tpl-grid">' + TEMPLATES.map(function (t, i) {
        return '<button class="tpl" data-a="template" data-id="' + i + '" style="--c:' + t.color + '"><span>' + t.emoji + '</span>' + esc(t.title) + '<small>' + LEVELS[t.level].icon + ' ' + LEVELS[t.level].name + '</small></button>';
      }).join('') + '</div>';
  }

  // ---------- Notes ----------
  function notesView() {
    var notes = live('notes').sort(function (a, b) { return ((a.active === false) - (b.active === false)) || (a.every || 0) - (b.every || 0); });
    return '<div class="sec-head"><h2>Notes</h2><button class="btn primary sm" data-a="editNote">＋ Note</button></div>' +
      '<p class="muted">Each note pops up on every device at its own rhythm and stays until you tap “Got it”.</p>' +
      (notes.length ? notes.map(function (n) {
        var on = n.active !== false, p = E.notePops(n, now());
        return '<div class="note-row' + (on ? '' : ' off') + '" style="--c:' + taskColor(n) + '"><button class="note-open" data-a="editNote" data-id="' + n.id + '"><span class="note-body md">' + mdHtml(n.text) + '</span>' +
          '<small>🔁 every ' + everyLabel(n.every) + ' · ⏳ ' + (+n.hold || 0) + ' s · 🕗 ' + esc(n.from || '00:00') + '–' + esc(n.to || '24:00') + (n.days && n.days.length && n.days.length < 7 ? ' · ' + n.days.map(function (d) { return DAYNAMES[d]; }).join(' ') : '') + (on && p.next ? ' · next ' + (E.dateKey(p.next) === E.dateKey(now()) ? hm(p.next) : niceDay(E.dateKey(p.next)) + ' ' + hm(p.next)) : '') + '</small></button>' +
          '<button class="switch' + (on ? ' on' : '') + '" data-a="toggleNote" data-id="' + n.id + '"><i></i></button></div>';
      }).join('') : '<p class="empty">No notes yet. Add things you must not forget.</p>');
  }

  // ---------- Settings ----------
  function settingsView() {
    var L = S.local, h = '<div class="sec-head"><h2>Settings</h2></div>';
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
        '<label class="field">Apps closed during “focus” locks (comma-separated)<textarea id="blocklist" rows="3">' + esc((L.blocklist || []).join(', ')) + '</textarea></label>' +
        '<button class="btn ghost sm" data-a="saveBlocklist">Save list</button><p class="muted">WhatsApp is never closed. Emergency stop shortcut: <b>Ctrl+Alt+Shift+K</b> (⌘ on Mac).</p></section>';
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
    h += '<p class="muted center">Scaffold ' + esc(L.version || '') + ' · ' + esc(PLATFORM) + ' · ' + esc(L.deviceId) + '</p>';
    return h;
  }

  // ---------- editors ----------
  function sel(v, cur) { return String(v) === String(cur) ? ' selected' : ''; }
  function emojiField(t) { return '<div class="field">Picture<div class="emoji-grid">' + EMOJIS.map(function (e) { return '<button type="button" class="ep' + (e === t.emoji ? ' on' : '') + '" data-emoji="' + e + '">' + e + '</button>'; }).join('') + '</div></div>'; }
  function colorField(t) { return '<div class="field">Color<div class="color-row">' + COLORS.map(function (c) { return '<button type="button" class="cp' + (c === t.color ? ' on' : '') + '" data-color="' + c + '" style="background:' + c + '"></button>'; }).join('') + '</div></div>'; }
  function levelField(t) {
    return '<div class="field">How hard should Scaffold push?<div class="levels">' + [1, 2, 3, 4].map(function (l) {
      return '<label class="lvl' + ((t.level || 1) === l ? ' on' : '') + '"><input type="radio" name="level" value="' + l + '"' + ((t.level || 1) === l ? ' checked' : '') + '><span class="lvl-ic">' + LEVELS[l].icon + '</span><span><b>' + LEVELS[l].name + '</b><small>' + LEVELS[l].desc + '</small></span></label>';
    }).join('') + '</div></div>';
  }
  function doneFields(t) {
    return '<div class="two"><label class="field">Counts as done when<select name="kind"><option value="check"' + sel('check', t.kind) + '>I tap “I did it”</option><option value="timer"' + sel('timer', t.kind) + '>A timer finishes</option></select></label>' +
      '<label class="field">Timer minutes<input type="number" name="minutes" min="1" max="240" value="' + esc(t.minutes || 20) + '"></label></div>' +
      '<label class="field">🌱 Tiny version <small>(optional: the smallest version that still counts, as a half win)</small><input name="tiny" maxlength="60" value="' + esc(t.tiny || '') + '" placeholder="e.g. Read 1 page"></label>' +
      (function () {
        var cur = +(t.remind || 30), pre = [1, 5, 15, 30, 45, 60, 90, 120], custom = pre.indexOf(cur) < 0;
        return '<div class="two"><label class="field">Remind me every<select name="remind">' + pre.map(function (m) { return '<option value="' + m + '"' + (!custom && cur === m ? ' selected' : '') + '>' + m + (m === 1 ? ' minute' : ' minutes') + '</option>'; }).join('') +
          '<option value="custom"' + (custom ? ' selected' : '') + '>Custom…</option></select></label>' +
          '<label class="field f-remind">Minutes<input type="number" name="remindN" min="1" max="1440" value="' + cur + '"></label></div>';
      })() +
      '<label class="field">On computers, when locked<select name="desktop"><option value="lock"' + sel('lock', t.desktop) + '>Cover the whole screen (for tasks away from the computer)</option><option value="focus"' + sel('focus', t.desktop) + '>Only close distracting apps (for computer tasks)</option><option value="none"' + sel('none', t.desktop) + '>Do nothing on computers</option></select></label>';
  }
  function appsField(t, apps) {
    return apps.length ? '<div class="field">Apps still allowed on the phone during a lock <small>(WhatsApp always is)</small><div class="apps">' + apps.map(function (a) {
      return '<label class="check sm"><input type="checkbox" name="app" value="' + esc(a.pkg) + '"' + ((t.allowApps || []).indexOf(a.pkg) >= 0 ? ' checked' : '') + '> ' + esc(a.label) + '</label>';
    }).join('') + '</div></div>' : '';
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
      if (f.remind && f.querySelector('.f-remind')) f.querySelector('.f-remind').style.display = f.remind.value === 'custom' ? '' : 'none';
      if (e.target.name === 'level') f.querySelectorAll('.lvl').forEach(function (x) { x.classList.toggle('on', x.contains(e.target)); });
      if (onChange) onChange(f, e);
    });
    f.addEventListener('submit', function (e) { e.preventDefault(); onSave(new FormData(f), f); });
    if (f.remind && f.querySelector('.f-remind')) f.querySelector('.f-remind').style.display = f.remind.value === 'custom' ? '' : 'none';
    if (onChange) onChange(f, {});
    return f;
  }
  function readDone(t, fd, apps) {
    t.level = +fd.get('level') || 1; t.kind = fd.get('kind'); t.minutes = Math.max(1, +fd.get('minutes') || 20);
    t.tiny = fd.get('tiny').trim(); t.remind = fd.get('remind') === 'custom' ? Math.min(1440, Math.max(1, Math.round(+fd.get('remindN') || 30))) : +fd.get('remind'); t.desktop = fd.get('desktop');
    if (apps.length) t.allowApps = fd.getAll('app');
  }

  function openHabitEditor(task) {
    var isNew = !task || !task.id;
    var t = Object.assign({ title: '', emoji: '📖', color: COLORS[0], start: '09:00', due: '10:00', days: [], level: 2, kind: 'check', minutes: 20, tiny: '', remind: 30, desktop: 'lock', allowApps: [], active: true }, task || {});
    var apps = listApps();
    $modal.innerHTML = modalShell(isNew ? 'New habit' : 'Edit habit',
      '<label class="field">What?<input name="title" required maxlength="60" value="' + esc(t.title) + '" placeholder="e.g. Read"></label>' + emojiField(t) + colorField(t) +
      '<div class="two"><label class="field">Window opens<input type="time" name="start" value="' + esc(t.start) + '" required></label><label class="field">Deadline<input type="time" name="due" value="' + esc(t.due) + '" required></label></div>' +
      '<div class="field">Days <small>(none selected = every day)</small><div class="day-row">' + DAYS.map(function (d, i) { return '<button type="button" class="dp' + ((t.days || []).indexOf(i) >= 0 ? ' on' : '') + '" data-day="' + i + '">' + d + '</button>'; }).join('') + '</div></div>' +
      '<label class="check"><input type="checkbox" name="active"' + (t.active !== false ? ' checked' : '') + '> Active (turn off to pause this habit)</label>' +
      levelField(t) + doneFields(t) + appsField(t, apps), !isNew);
    wire(t, function (fd) {
      t.title = fd.get('title').trim(); t.start = fd.get('start'); t.due = fd.get('due');
      if (t.due < t.start) return toast('The deadline must be after the window opens');
      t.active = !!fd.get('active'); readDone(t, fd, apps);
      apply(E.opPut('tasks', t, by(), now())); closeModal(); toast(isNew ? '✨ Habit added' : 'Saved');
    }, function () { confirmBox('Delete “' + t.title + '”?', 'Its history stays in the tracker until it ages out.', 'Delete', function () { apply(E.opDel('tasks', t, by(), now())); closeModal(); }); });
  }

  function openTodoEditor(task) {
    var isNew = !task || !task.id;
    var t = Object.assign({ title: '', emoji: '✅', color: COLORS[1], repeat: 'none', date: E.dateKey(now()), start: '', due: '', dueDay: 6, every: 2, level: 1, kind: 'check', minutes: 20, tiny: '', remind: 120, desktop: 'none', allowApps: [] }, task || {});
    if (isNew && task && task.vault && !task.date) t.date = '';
    var apps = listApps(), projects = live('projects');
    var r = t.repeat || 'none';
    $modal.innerHTML = modalShell(isNew ? 'New task' : 'Edit task',
      '<label class="field">What?<input name="title" required maxlength="80" value="' + esc(t.title) + '" placeholder="e.g. Buy batteries"></label>' +
      (t.vault ? '<p class="muted">🗂️ From the vault: “' + esc(cleanItem(t.vault.item)) + '”. Finishing it ticks it in Obsidian.</p>' : '') +
      '<label class="field">Project<select name="project"><option value="">None</option>' + projects.map(function (p) { return '<option value="' + p.id + '"' + sel(p.id, t.project) + '>' + esc((p.emoji || '') + ' ' + p.name) + '</option>'; }).join('') + '</select></label>' +
      '<label class="field">Repeats<select name="repeat"><option value="none"' + sel('none', r) + '>Once</option><option value="week"' + sel('week', r) + '>Every week</option><option value="month"' + sel('month', r) + '>Every month</option><option value="days"' + sel('days', r) + '>Every few days</option><option value="custom"' + sel('custom', r) + '>Custom days</option></select></label>' +
      '<div class="field f-custom">Days <small>(none selected = every day)</small><div class="day-row">' + DAYS.map(function (d, i) { return '<button type="button" class="dp' + ((r === 'custom' ? t.days || [] : []).indexOf(i) >= 0 ? ' on' : '') + '" data-day="' + i + '">' + d + '</button>'; }).join('') + '</div></div>' +
      '<div class="two"><label class="field f-date">Date <small>(empty = someday)</small><input type="date" name="date" value="' + esc(t.date || '') + '"></label>' +
      '<label class="field f-dueday-w">Deadline day<select name="dueDayW">' + WEEKDAYS.map(function (w, i) { return '<option value="' + i + '"' + sel(i, t.dueDay) + '>' + w + '</option>'; }).join('') + '</select></label>' +
      '<label class="field f-dueday-m">Deadline day of month<input type="number" name="dueDayM" min="1" max="31" value="' + esc(r === 'month' ? t.dueDay || 28 : 28) + '"></label>' +
      '<label class="field f-every">Every how many days<input type="number" name="every" min="1" max="365" value="' + esc(t.every || 2) + '"></label></div>' +
      '<label class="check f-monthly"><input type="checkbox" name="monthly"' + (t.monthly ? ' checked' : '') + '> Show in monthly <small>(marks the deadline day in the month view)</small></label>' +
      '<div class="two f-times"><label class="field">Window opens <small class="f-wsmall">(on the deadline day)</small><input type="time" name="start" value="' + esc(t.start || '') + '"></label><label class="field">Deadline<select name="dueMode"><option value="time"' + (t.dueEnd ? '' : ' selected') + '>At a set time</option><option value="end"' + (t.dueEnd ? ' selected' : '') + '>By the end of the day</option></select></label>' +
      '<label class="field f-duetime">Deadline time<input type="time" name="due" value="' + esc(t.dueEnd ? '' : t.due || '') + '"></label></div>' +
      emojiField(t) + colorField(t) + levelField(t) + doneFields(t) + appsField(t, apps), !isNew);
    wire(t, function (fd) {
      t.title = fd.get('title').trim(); t.project = fd.get('project') || ''; t.repeat = fd.get('repeat');
      t.date = fd.get('date') || ''; t.start = fd.get('start') || ''; t.due = fd.get('due') || '';
      t.dueEnd = fd.get('dueMode') === 'end'; if (t.dueEnd) t.due = '23:59'; t.monthly = !!fd.get('monthly');
      if (t.repeat !== 'custom') delete t.days;
      if (t.repeat === 'week') t.dueDay = +fd.get('dueDayW');
      if (t.repeat === 'month') t.dueDay = Math.min(31, Math.max(1, +fd.get('dueDayM') || 28));
      if (t.repeat === 'days') { t.every = Math.max(1, +fd.get('every') || 2); if (!t.date) t.date = E.dateKey(now()); }
      if (t.repeat !== 'none' || t.date) { if (!t.due) t.due = '21:00'; if (!t.start) t.start = t.due < '09:00' ? t.due : '09:00'; }
      if (t.start && t.due && t.due < t.start) return toast('The deadline must be after the window opens');
      readDone(t, fd, apps);
      apply(E.opPut('todos', t, by(), now())); closeModal(); toast(isNew ? '✨ Task added' : 'Saved');
    }, function () { confirmBox('Delete “' + t.title + '”?', 'This removes the task from every device.', 'Delete', function () { apply(E.opDel('todos', t, by(), now())); closeModal(); }); },
    function (f) {
      var rep = f.repeat.value;
      f.querySelector('.f-date').style.display = rep === 'none' || rep === 'days' ? '' : 'none';
      f.querySelector('.f-date small').style.display = rep === 'none' ? '' : 'none';
      f.querySelector('.f-dueday-w').style.display = rep === 'week' ? '' : 'none';
      f.querySelector('.f-dueday-m').style.display = rep === 'month' ? '' : 'none';
      f.querySelector('.f-every').style.display = rep === 'days' ? '' : 'none';
      f.querySelector('.f-custom').style.display = rep === 'custom' ? '' : 'none';
      f.querySelector('.f-wsmall').textContent = rep === 'custom' ? '(each day)' : '(on the deadline day)';
      f.querySelector('.f-duetime').style.display = f.dueMode.value === 'end' ? 'none' : '';
      f.querySelector('.f-times').style.display = rep === 'none' && !f.date.value ? 'none' : '';
      f.querySelector('.f-monthly').style.display = rep === 'none' && !f.date.value ? 'none' : '';
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
  function mdLine(l) {
    var m;
    if ((m = /^## (.*)$/.exec(l))) return { t: 'h2', s: m[1] };
    if ((m = /^# (.*)$/.exec(l))) return { t: 'h1', s: m[1] };
    if ((m = /^- \[([ xX])\](?: (.*))?$/.exec(l))) return { t: 'cl', c: m[1] !== ' ', s: m[2] || '' };
    if ((m = /^[-*] (.*)$/.exec(l))) return { t: 'ul', s: m[1] };
    if ((m = /^\d+\. (.*)$/.exec(l))) return { t: 'ol', s: m[1] };
    return { t: 'p', s: l };
  }
  // tick: note id when checklist lines can be ticked (pop-up).
  function mdHtml(text, tick) {
    return String(text || '').split('\n').map(function (l, i) {
      var b = mdLine(l), inner = mdInline(b.s);
      return '<div data-t="' + b.t + '"' + (b.c ? ' data-c="1"' : '') + (tick && b.t === 'cl' ? ' data-a="tickNote" data-id="' + esc(tick) + '" data-k="' + i + '"' : '') + '>' + (inner || '<br>') + '</div>';
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
    var n = 0, lines = [];
    ed.childNodes.forEach(function (b) {
      if (b.nodeType !== 1) return;
      var t = b.dataset.t || 'p', s = mdFromInline(b);
      n = t === 'ol' ? n + 1 : 0;
      if (t === 'p' && /^(#{1,2} |[-*] |\d+\. )/.test(s)) s = '\\' + s;
      lines.push(({ h1: '# ', h2: '## ', ul: '- ', ol: n + '. ', cl: b.dataset.c === '1' ? '- [x] ' : '- [ ] ' }[t] || '') + s);
    });
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    return lines.join('\n');
  }
  function noteTick(text, line) {
    var ls = String(text || '').split('\n');
    if (ls[line] && /^- \[[ xX]\]/.test(ls[line])) ls[line] = ls[line].replace(/^- \[([ xX])\]/, function (m, c) { return c === ' ' ? '- [x]' : '- [ ]'; });
    return ls.join('\n');
  }

  var IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || '');
  var RTE_TOOLS = [['bold', '<b>B</b>', 'Bold (' + (IS_MAC ? '⌘' : 'Ctrl+') + 'B)'], ['italic', '<i>I</i>', 'Italic (' + (IS_MAC ? '⌘' : 'Ctrl+') + 'I)'], ['underline', '<u>U</u>', 'Underline (' + (IS_MAC ? '⌘' : 'Ctrl+') + 'U)'], ['strikeThrough', '<s>S</s>', 'Strikethrough (' + (IS_MAC ? '⌘⇧X' : 'Alt+Shift+5') + ')'],
    ['|'], ['ul', '•', 'Bullets (' + (IS_MAC ? '⌘⇧8' : 'Ctrl+Shift+8') + ')'], ['ol', '1.', 'Numbered (' + (IS_MAC ? '⌘⇧7' : 'Ctrl+Shift+7') + ')'], ['cl', '☑', 'Checklist (' + (IS_MAC ? '⌘⇧9' : 'Ctrl+Shift+9') + ')'], ['h1', 'H', 'Heading (' + (IS_MAC ? '⌘⌥1' : 'Ctrl+Alt+1') + ')']];
  function rteField(text) {
    return '<div class="field">Note<div class="rte-bar">' + RTE_TOOLS.map(function (t) { return t[0] === '|' ? '<i class="rte-sep"></i>' : '<button type="button" class="rte-b" data-fmt="' + t[0] + '" title="' + esc(t[2]) + '">' + t[1] + '</button>'; }).join('') + '</div>' +
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
      paintBar();
    }
    function fmt(cmd) {
      if (LIST[cmd] || cmd === 'h1' || cmd === 'h2' || cmd === 'p') return block(cmd === 'p' ? 'p' : cmd);
      document.execCommand(cmd, false, null); normalize(); paintBar();
    }
    function enter() {
      var r = sel(); if (!r) return;
      if (!r.collapsed) r.deleteContents();
      normalize(); r = sel(); if (!r) return;
      var b = blockOf(r.startContainer); if (!b) return;
      var t = b.dataset.t || 'p';
      if (LIST[t] && !b.textContent.replace(/\u200B/g, '').trim()) { setType(b, 'p'); paintBar(); return; }   // Enter on an empty list line ends the list
      var x = document.createRange(); x.setStart(r.startContainer, r.startOffset); x.setEnd(b, b.childNodes.length);
      var frag = x.extractContents(), nb = document.createElement('div');
      setType(nb, t === 'h1' || t === 'h2' ? 'p' : t, false);
      nb.appendChild(frag);
      if (!nb.textContent.replace(/\u200B/g, '')) nb.innerHTML = '<br>';
      fill(b); b.parentNode.insertBefore(nb, b.nextSibling);
      var first = nb.firstChild; while (first && first.nodeType === 1 && first.firstChild && first.nodeName !== 'BR') first = first.firstChild;
      caretAt(first && first.nodeType === 3 ? first : nb, 0);
      nb.scrollIntoView({ block: 'nearest' });
      paintBar();
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
        else if (r) try { on = document.queryCommandState(k); } catch (e) {}
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
        if (b && b.dataset.t !== 'p' && !before(r, b).toString().replace(/\u200B/g, '')) { e.preventDefault(); setType(b, 'p'); delete b.dataset.fresh; paintBar(); }
      }
    });
    ed.addEventListener('input', function (e) { normalize(); if (!e.isComposing && /^insert/.test(e.inputType || 'insert') && e.inputType !== 'insertFromPaste') marks(e.data ? e.data.length : 1); });
    ed.addEventListener('compositionend', function (e) { var k = e.data ? e.data.length : 1; setTimeout(function () { marks(k); }, 0); });
    ed.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); enter(); return; }
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
      var text = rte.value(), len = E.plainNote(text).length;
      if (!E.plainNote(text).trim()) return toast('Write the note first');
      if (len > 600) return toast('Too long: ' + len + ' of 600 characters');
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
        return '<label class="check cal-pick"><input type="checkbox" data-cal="' + esc(c.id) + '"' + (calHidden(c.id) ? '' : ' checked') + '><i style="background:' + esc(c.color || EV_COLOR) + '"></i> ' + esc(c.name) + (c.ro ? ' <small>(read-only)</small>' : '') + '</label>';
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
    var orig = JSON.stringify([t.title, t.allDay, t.start, t.end, myCal, t.color || '', desc0, t.rrule || '']);
    var pal = palette(), colorBtns = '<button type="button" class="cp ecp' + (!t.color ? ' on' : '') + '" data-ecolor="" title="Calendar color" style="background:' + esc((gcal(myCal) || {}).color || EV_COLOR) + '"></button>' +
      Object.keys(pal).map(function (k) { return '<button type="button" class="cp ecp' + (t.color === k ? ' on' : '') + '" data-ecolor="' + k + '" title="' + (GCOLOR_NAMES[k] || '') + '" style="background:' + esc(pal[k]) + '"></button>'; }).join('');
    $modal.innerHTML = modalShell(isNew ? 'New event' : ro ? 'Event (read-only calendar)' : 'Edit event',
      (ro ? '<p class="muted">This calendar is read-only. Here you can only choose whether it shows in the month view.</p>' : '') +
      '<label class="field">Title<input name="title" required maxlength="120" value="' + esc(t.title) + '"' + dis + '></label>' +
      (v2 && !ro ? '<label class="field">Calendar<select name="cal">' + cals.map(function (c) { return '<option value="' + esc(c.id) + '"' + (c.id === myCal ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select></label>' : '') +
      '<label class="field">Date<input type="date" name="date" value="' + E.dateKey(t.start) + '" required' + dis + '></label>' +
      '<label class="check"><input type="checkbox" name="allDay"' + (t.allDay ? ' checked' : '') + dis + '> All day</label>' +
      '<div class="two f-times"><label class="field">Starts<input type="time" name="start" value="' + hm(t.start) + '"' + dis + '></label><label class="field">Ends<input type="time" name="end" value="' + hm(t.end) + '"' + dis + '></label></div>' +
      (ro ? '' : '<label class="field">Repeat<select name="rf"' + (canRule ? '' : ' disabled') + '><option value="none"' + sel('none', rf) + '>Does not repeat</option><option value="daily"' + sel('daily', rf) + '>Daily</option><option value="weekly"' + sel('weekly', rf) + '>Weekly</option><option value="monthly"' + sel('monthly', rf) + '>Monthly</option><option value="yearly"' + sel('yearly', rf) + '>Yearly</option>' + (canRule ? '' : '<option value="custom" selected>' + esc(repeatText(t.rrule)) + '</option>') + '</select></label>' +
        '<div class="field f-rdays">On <div class="day-row">' + DAYS.map(function (d, i) { return '<button type="button" class="dp rdp' + (rdays.indexOf(i) >= 0 ? ' on' : '') + '" data-rday="' + i + '">' + d + '</button>'; }).join('') + '</div></div>' +
        '<div class="two f-rend"><label class="field">Ends<select name="rend"><option value="never"' + sel('never', rend) + '>Never</option><option value="until"' + sel('until', rend) + '>On a date</option><option value="count"' + sel('count', rend) + '>After…</option></select></label>' +
        '<label class="field f-runtil">Last day<input type="date" name="runtil" value="' + esc(rule && rule.until || E.dateKey(E.addDays(t.start, 30))) + '"></label><label class="field f-rcount">Times<input type="number" name="rcount" min="1" max="999" value="' + esc(rule && rule.count || 10) + '"></label></div>') +
      (ro ? '' : '<div class="field">Color<div class="color-row">' + colorBtns + '</div></div>') +
      '<label class="field">Description<textarea name="desc" rows="3"' + dis + '>' + esc(desc0) + '</textarea></label>' +
      '<label class="check"><input type="checkbox" name="monthly"' + (was ? ' checked' : '') + '> Show in monthly</label>' +
      (ro ? '' : t.gid ? '<p class="muted">Synced with Google Calendar.</p>' : (S.local.calUrl || (S.local.cal || {}).status ? '' : '<p class="muted">Connect Google Calendar on a computer to sync it there too.</p>')), !isNew && !ro);
    var f = document.getElementById('editor'), color = t.color || '', rd = rdays.slice();
    f.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-ecolor')) { color = b.getAttribute('data-ecolor'); f.querySelectorAll('.ecp').forEach(function (x) { x.classList.toggle('on', x === b); }); }
      if (b.hasAttribute('data-rday')) { var d = +b.getAttribute('data-rday'), i = rd.indexOf(d); if (i >= 0) { if (rd.length > 1) rd.splice(i, 1); } else rd.push(d); f.querySelectorAll('.rdp').forEach(function (x) { x.classList.toggle('on', rd.indexOf(+x.getAttribute('data-rday')) >= 0); }); }
    });
    wire(t, function (fd) {
      var monthly = !!fd.get('monthly');
      if (!ro) {
        var d = E.fromKey(fd.get('date')), c = JSON.parse(JSON.stringify(t));
        c.title = fd.get('title').trim(); c.allDay = !!fd.get('allDay');
        if (c.allDay) { c.start = E.at(d, '00:00'); c.end = E.at(E.addDays(d, 1), '00:00'); }
        else { c.start = E.at(d, fd.get('start') || '10:00'); c.end = E.at(d, fd.get('end') || '11:00'); if (c.end <= c.start) c.end = c.start + 30 * E.MIN; }
        if (v2) { var nc = fd.get('cal') || myCal; if (nc !== myCal) c.oldCal = myCal; c.cal = nc; }
        c.color = color;
        var dsc = (fd.get('desc') || '').trim(); if (dsc !== desc0) c.desc = dsc;
        var nf = fd.get('rf') || rf;
        if (nf !== 'custom') c.rrule = nf === 'none' ? '' : E.buildRule({ freq: nf, days: nf === 'weekly' ? rd : [], count: fd.get('rend') === 'count' ? Math.max(1, +fd.get('rcount') || 1) : 0, until: fd.get('rend') === 'until' ? fd.get('runtil') : '' }, c.allDay);
        var ruleChanged = !sameRule(c.rrule, t.rrule, t.start);
        if (nf === 'custom' || !ruleChanged) { c.rrule = t.rrule || ''; c.keepRule = true; } else delete c.keepRule;
        var changed = isNew || JSON.stringify([c.title, c.allDay, c.start, c.end, c.cal || myCal, c.color || '', c.desc != null ? c.desc : desc0, c.rrule || '']) !== orig;
        var save = function (scope) {
          if (scope) c.scope = scope;
          if (!c.series) { if (!c.rrule) delete c.rrule; delete c.keepRule; }
          var patch = E.opPut('events', c, by(), now()); t.id = Object.keys(patch.events)[0]; apply(patch);
          if (monthly !== was) apply(E.opPut('marks', { id: markKey(c), monthly: monthly }, by(), now()));
          S.calDay = fd.get('date'); closeModal(); toast(isNew ? '📅 Event added' : 'Saved');
        };
        if (changed && t.series) return scopeBox('Edit repeating event', ruleChanged || (c.cal !== myCal), save);
        if (changed) return save();
      }
      if (monthly !== was) apply(E.opPut('marks', { id: markKey(t), monthly: monthly }, by(), now()));
      closeModal(); toast(isNew ? '📅 Event added' : 'Saved');
    }, function () {
      var go = function (scope) { var c = JSON.parse(JSON.stringify(t)); if (scope) c.scope = scope; apply(E.opDel('events', c, by(), now())); closeModal(); };
      if (t.series) return scopeBox('Delete repeating event', false, go, null, true);
      confirmBox('Delete “' + t.title + '”?', t.gid ? 'It is removed from Google Calendar too.' : t.rrule ? 'Every repeat is removed, on every device.' : 'This removes it from every device.', 'Delete', function () { go(''); });
    },
    function (f) {
      f.querySelector('.f-times').style.display = f.allDay.checked ? 'none' : '';
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
    document.querySelectorAll('[data-hold]').forEach(function (el) { if (el.disabled && +el.getAttribute('data-hold') <= n) { el.disabled = false; el.textContent = 'Got it'; } });
  }
  var lastMinute = -1, lastTimerFrac = -1, lastNotes = '';
  setInterval(function () {
    tick();
    if (!S.local) return;
    var m = new Date().getMinutes();
    var timer = S.local.timer;
    var busy = S.modalOpen || S.dragging || document.querySelector('.top-layer') || (document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName));
    if (timer && timer.endsAt > now()) {
      var total = (timer.minutes || 20) * 60000, frac = Math.round((1 - (timer.endsAt - now()) / total) * 400);
      if (frac !== lastTimerFrac && !busy) { lastTimerFrac = frac; render(); }
    } else if (timer && timer.endsAt <= now() && !busy) render();
    var notesNow = E.pendingNotes(S.state, now()).map(function (n) { return n.id + n.since; }).join();
    if (notesNow !== lastNotes) { lastNotes = notesNow; if (!busy) render(); }
    if (m !== lastMinute) { lastMinute = m; if (!busy) render(); }
  }, 1000);

  window.onNative = function () { if (S.dragging) { load(); return; } if (!S.modalOpen) render(); else load(); paintUpd(); };
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
