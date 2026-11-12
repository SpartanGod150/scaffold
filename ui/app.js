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
    dismissNote: function (id) { apply(E.opAck(id, by(), now())); delete S.noteSeen[id]; if (S.mode === 'note' && !E.pendingNotes(S.state, now()).filter(function (n) { return n.id !== id; }).length) B.closeWindow(); },
    calPrev: function () { var m = S.calMonth; S.calMonth = new Date(m.getFullYear(), m.getMonth() - 1, 1); render(); },
    calNext: function () { var m = S.calMonth; S.calMonth = new Date(m.getFullYear(), m.getMonth() + 1, 1); render(); },
    calToday: function () { S.calMonth = null; S.calDay = null; render(); },
    calPick: function (key) { S.calDay = key; render(); },
    editEvent: function (id) {
      var all = E.eventsFor(S.state), e = id && all[id] ? JSON.parse(JSON.stringify(all[id])) : null;
      if (e) { delete e.synced; delete e.gupd; }
      if (e && e.ro) return toast('Repeating Google events can only be edited in Google Calendar');
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
      } else { if (k === 'update') { toast('⬆️ Checking for updates…'); S.updClick = now(); } B.test(k); }
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
  function paint(html) { $app.innerHTML = html; tick(); }

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
      (S.r.notes.length && PLATFORM !== 'android' ? '<div class="banner noteb">📌 ' + S.r.notes.length + ' note' + (S.r.notes.length > 1 ? 's' : '') + ' waiting: ' + esc(S.r.notes[0].note.text.split('\n')[0].slice(0, 60)) + '</div>' : '') +
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
      '<div class="note-text">' + esc(n.text).replace(/\n/g, '<br>') + '</div>' +
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
  function calendarView() {
    var today = E.dateKey(now());
    if (!S.calMonth) { var n = new Date(); S.calMonth = new Date(n.getFullYear(), n.getMonth(), 1); }
    var m = S.calMonth, sel = S.calDay || today;
    var first = new Date(m.getFullYear(), m.getMonth(), 1), offset = (first.getDay() + 6) % 7;
    var daysIn = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
    var cells = '';
    for (var i = 0; i < offset; i++) cells += '<i class="cal-blank"></i>';
    for (var d = 1; d <= daysIn; d++) {
      var t = new Date(m.getFullYear(), m.getMonth(), d, 12).getTime(), key = E.dateKey(t), ag = E.dayAgenda(S.state, t);
      var dots = { event: 0, todo: 0 };
      ag.forEach(function (a) { if (a.kind !== 'habit') dots[a.kind]++; });
      cells += '<button class="cal-day' + (key === today ? ' today' : '') + (key === sel ? ' sel' : '') + '" data-a="calPick" data-id="' + key + '"><b>' + d + '</b><span class="dots">' +
        (dots.event ? '<i class="d-ev"></i>' : '') + (dots.todo ? '<i class="d-td"></i>' : '') + '</span></button>';
    }
    var agenda = E.dayAgenda(S.state, E.fromKey(sel)).map(function (a) {
      var r = a.rec;
      if (a.kind === 'event') return '<button class="ag-row ev" data-a="editEvent" data-id="' + a.id + '"><span class="ag-t">' + (r.allDay ? 'all day' : hm(r.start) + '–' + hm(r.end)) + '</span><span class="ag-x">' + (r.gid ? '<i class="gtag">G</i>' : '📅') + ' ' + esc(r.title) + (r.ro ? ' <small>(repeating)</small>' : '') + '</span></button>';
      if (a.kind === 'todo') return '<button class="ag-row td' + (a.done ? ' dn' : '') + '" data-a="editTodo" data-id="' + a.id + '" style="--c:' + taskColor(r) + '"><span class="ag-t">' + esc(r.start || '') + (r.due ? '–' + esc(r.due) : '') + '</span><span class="ag-x">' + (a.done ? '✓ ' : '') + esc(r.emoji || '✅') + ' ' + esc(r.title) + '</span></button>';
      return '<div class="ag-row hb' + (a.done ? ' dn' : '') + '" style="--c:' + taskColor(r) + '"><span class="ag-t">' + esc(r.start || '') + '</span><span class="ag-x">' + (a.done ? '✓ ' : '') + '🔁 ' + esc(r.title) + '</span></div>';
    }).join('');
    var cal = S.local.cal || {};
    return '<div class="sec-head"><h2>' + MONTHS[m.getMonth()] + ' ' + m.getFullYear() + '</h2><div class="row-btns"><button class="btn ghost sm" data-a="calPrev">‹</button><button class="btn ghost sm" data-a="calToday">Today</button><button class="btn ghost sm" data-a="calNext">›</button></div></div>' +
      '<div class="cal-head">' + WEEKDAYS.map(function (w) { return '<i>' + w[0] + '</i>'; }).join('') + '</div><div class="cal-grid">' + cells + '</div>' +
      '<div class="legend"><span><i class="d-ev"></i>event</span><span><i class="d-td"></i>task due</span>' + (cal.status ? '<span class="lg-note">Google: ' + esc(cal.status) + '</span>' : '<span class="lg-note">Google Calendar: not connected (Settings)</span>') + '</div>' +
      '<div class="sec-head"><h3>' + niceDay(sel).replace(/^./, function (c) { return c.toUpperCase(); }) + '</h3><button class="btn primary sm" data-a="editEvent">＋ Event</button></div>' +
      '<section class="agenda">' + (agenda || '<p class="empty">Nothing on this day.</p>') + '</section>';
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
        return '<div class="note-row' + (on ? '' : ' off') + '" style="--c:' + taskColor(n) + '"><button class="note-open" data-a="editNote" data-id="' + n.id + '"><span class="note-body">' + esc(n.text).replace(/\n/g, '<br>') + '</span>' +
          '<small>🔁 every ' + everyLabel(n.every) + ' · ⏳ ' + (+n.hold || 0) + ' s · 🕗 ' + esc(n.from || '00:00') + '–' + esc(n.to || '24:00') + (on && p.next ? ' · next ' + (E.dateKey(p.next) === E.dateKey(now()) ? hm(p.next) : niceDay(E.dateKey(p.next)) + ' ' + hm(p.next)) : '') + '</small></button>' +
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
        '<button class="btn ghost sm" data-a="leaveSync">Disconnect</button>';
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
        ? (L.scriptOld ? '<div class="callout"><p>⚠️ <b>Your Google script needs an update</b> (it adds a backup route for syncing, for networks that block the normal one). About 1 minute:</p><ol class="steps">' +
            '<li><button class="btn sm" data-a="copyScript">Copy new script</button></li>' +
            '<li>Open <b>script.google.com</b> → your Scaffold project. Select all the code, delete it, paste.</li>' +
            '<li><b>Deploy → Manage deployments</b> → ✏️ (edit) → Version: <b>New version</b> → <b>Deploy</b>. The URL stays the same.</li></ol></div>' : '') +
          '<p class="muted">Status: <span class="dot ' + (/ok|synced/.test(C.status || '') ? 'ok' : '') + '"></span>' + esc(C.status || 'connecting…') + '</p><label class="field">Bridge URL<input id="cal-url" value="' + esc(L.calUrl) + '"></label><button class="btn ghost sm" data-a="saveCal">Save</button>'
        : '<p>Events you add or change on either side show up on the other. One-time setup, about 5 minutes:</p><ol class="steps">' +
          '<li>Open <b>script.google.com</b> → <b>New project</b>.</li>' +
          '<li>Delete what is there and paste the bridge script: <button class="btn sm" data-a="copyScript">Copy script</button></li>' +
          '<li><b>Deploy → New deployment</b> → type <b>Web app</b>. Execute as <b>Me</b>, access <b>Anyone</b>. Deploy, then allow access to your calendar.</li>' +
          '<li>Copy the <b>Web app URL</b> and paste it here:</li></ol>' +
          '<div class="join"><input id="cal-url" placeholder="https://script.google.com/macros/s/…/exec"><button class="btn" data-a="saveCal">Connect</button></div>' +
          '<p class="muted">Do this on one computer only. The script only works with the secret key built into it.</p>') + '</section>';
    } else {
      h += '<section class="panel"><h3>📅 Google Calendar · 🗂️ Obsidian</h3><p class="muted">These connect from a computer (Settings there). Everything they bring in shows up here too.</p></section>';
    }
    h += '<section class="panel"><h3>🧪 Try it</h3><p>Check that everything works before you rely on it.</p><div class="row-btns"><button class="btn" data-a="test" data-id="remind">Test reminder (all devices)</button><button class="btn" data-a="test" data-id="lock">Test lock (all devices)</button></div></section>';
    h += '<section class="panel"><h3>🧯 Removing Scaffold</h3><p class="muted">Emergency stop frees every device instantly. To remove it completely:<br>' +
      '<b>Android:</b> Settings → Apps → Scaffold → Uninstall.<br><b>Mac:</b> menu bar icon → Quit, then delete the app.<br><b>Windows:</b> tray icon → Quit, then delete the folder.<br>If anything ever gets stuck: <b>Android</b> Settings → Accessibility → Scaffold → Off; <b>computers</b> Force Quit / Task Manager.</p></section>';
    var U = L.update || {};
    h += '<section class="panel"><h3>⬆️ Updates</h3><p>Version <b>' + esc(L.version || '?') + '</b>. ' + (PLATFORM === 'android' ? 'New versions download by themselves; Android may ask you to tap Install.' : 'New versions install by themselves, never during a lock.') + '</p>' +
      (U.status ? '<p class="muted">Last check: ' + esc(U.status) + (U.checked ? ' (' + new Date(U.checked).toLocaleString() + ')' : '') + '</p>' : '') +
      '<div class="row-btns"><button class="btn" data-a="test" data-id="update">Check for updates now</button></div></section>';
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
      '<div class="two f-times"><label class="field">Window opens <small class="f-wsmall">(on the deadline day)</small><input type="time" name="start" value="' + esc(t.start || '') + '"></label><label class="field">Deadline<select name="dueMode"><option value="time"' + (t.dueEnd ? '' : ' selected') + '>At a set time</option><option value="end"' + (t.dueEnd ? ' selected' : '') + '>By the end of the day</option></select></label>' +
      '<label class="field f-duetime">Deadline time<input type="time" name="due" value="' + esc(t.dueEnd ? '' : t.due || '') + '"></label></div>' +
      emojiField(t) + colorField(t) + levelField(t) + doneFields(t) + appsField(t, apps), !isNew);
    wire(t, function (fd) {
      t.title = fd.get('title').trim(); t.project = fd.get('project') || ''; t.repeat = fd.get('repeat');
      t.date = fd.get('date') || ''; t.start = fd.get('start') || ''; t.due = fd.get('due') || '';
      t.dueEnd = fd.get('dueMode') === 'end'; if (t.dueEnd) t.due = '23:59';
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

  function openNoteEditor(n) {
    var isNew = !n || !n.id;
    var t = Object.assign({ text: '', every: 60, hold: 5, from: '08:00', to: '23:00', color: COLORS[6], active: true }, n || {});
    var unit = t.every % 1440 === 0 ? 1440 : t.every % 60 === 0 ? 60 : 1;
    $modal.innerHTML = modalShell(isNew ? 'New note' : 'Edit note',
      '<label class="field">Note<textarea name="text" rows="4" required maxlength="600" placeholder="e.g. Reply to João about Saturday">' + esc(t.text) + '</textarea></label>' +
      '<div class="two"><label class="field">Pop up every<input type="number" name="n" min="1" max="999" value="' + (t.every / unit) + '"></label><label class="field">&nbsp;<select name="unit"><option value="1"' + sel(1, unit) + '>minutes</option><option value="60"' + sel(60, unit) + '>hours</option><option value="1440"' + sel(1440, unit) + '>days</option></select></label></div>' +
      '<label class="field">Can\'t dismiss for the first (seconds)<input type="number" name="hold" min="0" max="600" value="' + esc(t.hold) + '"></label>' +
      '<div class="two"><label class="field">Only between<input type="time" name="from" value="' + esc(t.from) + '"></label><label class="field">and<input type="time" name="to" value="' + esc(t.to) + '"></label></div>' +
      '<label class="check"><input type="checkbox" name="active"' + (t.active !== false ? ' checked' : '') + '> Active</label>' + colorField(t), !isNew);
    wire(t, function (fd) {
      var every = Math.max(1, (+fd.get('n') || 1) * (+fd.get('unit') || 1));
      if (every !== t.every || isNew || (fd.get('active') && t.active === false)) t.anchor = now();
      t.text = fd.get('text').trim(); t.every = every; t.hold = Math.max(0, +fd.get('hold') || 0);
      t.from = fd.get('from') || '00:00'; t.to = fd.get('to') || '24:00'; t.active = !!fd.get('active');
      apply(E.opPut('notes', t, by(), now())); closeModal(); toast(isNew ? '📌 Note added' : 'Saved');
    }, function () { confirmBox('Delete this note?', 'It stops popping up on every device.', 'Delete', function () { apply(E.opDel('notes', t, by(), now())); closeModal(); }); });
  }

  function openEventEditor(ev) {
    var isNew = !ev || !ev.id, day = S.calDay || E.dateKey(now());
    var t = Object.assign({ title: '', allDay: false, start: E.at(E.fromKey(day), '10:00'), end: E.at(E.fromKey(day), '11:00') }, ev || {});
    $modal.innerHTML = modalShell(isNew ? 'New event' : 'Edit event',
      '<label class="field">Title<input name="title" required maxlength="120" value="' + esc(t.title) + '"></label>' +
      '<label class="field">Date<input type="date" name="date" value="' + E.dateKey(t.start) + '" required></label>' +
      '<label class="check"><input type="checkbox" name="allDay"' + (t.allDay ? ' checked' : '') + '> All day</label>' +
      '<div class="two f-times"><label class="field">Starts<input type="time" name="start" value="' + hm(t.start) + '"></label><label class="field">Ends<input type="time" name="end" value="' + hm(t.end) + '"></label></div>' +
      (t.gid ? '<p class="muted">Synced with Google Calendar.</p>' : (S.local.calUrl || (S.local.cal || {}).status ? '' : '<p class="muted">Connect Google Calendar on a computer to sync it there too.</p>')), !isNew);
    wire(t, function (fd) {
      var d = E.fromKey(fd.get('date'));
      t.title = fd.get('title').trim(); t.allDay = !!fd.get('allDay');
      if (t.allDay) { t.start = E.at(d, '00:00'); t.end = E.at(E.addDays(d, 1), '00:00'); }
      else { t.start = E.at(d, fd.get('start') || '10:00'); t.end = E.at(d, fd.get('end') || '11:00'); if (t.end <= t.start) t.end = t.start + 30 * E.MIN; }
      apply(E.opPut('events', t, by(), now())); S.calDay = fd.get('date'); closeModal(); toast(isNew ? '📅 Event added' : 'Saved');
    }, function () { confirmBox('Delete “' + t.title + '”?', t.gid ? 'It is removed from Google Calendar too.' : 'This removes it from every device.', 'Delete', function () { apply(E.opDel('events', t, by(), now())); closeModal(); }); },
    function (f) { f.querySelector('.f-times').style.display = f.allDay.checked ? 'none' : ''; });
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
    var busy = S.modalOpen || document.querySelector('.top-layer') || (document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName));
    if (timer && timer.endsAt > now()) {
      var total = (timer.minutes || 20) * 60000, frac = Math.round((1 - (timer.endsAt - now()) / total) * 400);
      if (frac !== lastTimerFrac && !busy) { lastTimerFrac = frac; render(); }
    } else if (timer && timer.endsAt <= now() && !busy) render();
    var notesNow = E.pendingNotes(S.state, now()).map(function (n) { return n.id + n.since; }).join();
    if (notesNow !== lastNotes) { lastNotes = notesNow; if (!busy) render(); }
    if (m !== lastMinute) { lastMinute = m; if (!busy) render(); }
  }, 1000);

  window.onNative = function () { if (!S.modalOpen) render(); else load(); updateFeedback(); };
  // After "Check for updates now": say how it ended, so the button never looks dead.
  function updateFeedback() {
    var U = (S.local && S.local.update) || {}, st = U.status || '';
    if (!S.updClick || (U.checked || 0) < S.updClick - 2000 || /checking/.test(st)) return;
    if (/^downloading/.test(st)) { if (!S.updDl) { S.updDl = 1; toast('⬆️ Update found: ' + st.replace(/: \d+%$/, '') + '…'); } return; }
    S.updClick = 0; S.updDl = 0;
    if (/up to date/.test(st)) toast('✅ No updates found: version ' + (S.local.version || '') + ' is the latest');
    else if (/downloaded|installing|ready/.test(st)) toast('⬆️ ' + st.charAt(0).toUpperCase() + st.slice(1));
    else toast('⚠️ Update check failed: ' + st.replace(/^error:\s*/, ''));
  }
  window.setMode = function (mode, task) { S.mode = mode || 'main'; S.modeTask = task || ''; if (!S.modalOpen) render(); };
  render();
})();
