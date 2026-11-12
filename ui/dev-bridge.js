/* Browser-only bridge so the UI can be developed and tested without a device.
   Real devices provide window.AndroidBridge (Android) or window.ScaffoldBridge (desktop) with the same methods. */
(function () {
  if (window.AndroidBridge || window.ScaffoldBridge) return;
  var q = new URLSearchParams(location.search);
  var LS = 'scaffold-dev-';
  function load(k, d) { try { return JSON.parse(localStorage.getItem(LS + k)) || d; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch (e) {} }
  var state = load('state', Engine.emptyState());
  var local = load('local', { deviceId: 'web-' + Math.random().toString(36).slice(2, 7), deviceName: 'Browser', syncCode: '', timer: null, blocklist: ['steam', 'discord'], autostart: true });
  save('local', local);
  function changed() { save('state', state); save('local', local); setTimeout(function () { window.onNative && window.onNative(); }, 0); }
  setInterval(function () {
    if (local.timer && Date.now() >= local.timer.endsAt) {
      Engine.merge(state, Engine.opComplete(local.timer.taskId, 'full', local.deviceId, Date.now(), state));
      local.timer = null; changed();
    }
  }, 1000);
  window.DevBridge = {
    platform: function () { return q.get('platform') || 'desktop'; },
    getState: function () { return JSON.stringify(state); },
    getLocal: function () {
      var l = Object.assign({}, local, { sync: { status: local.syncCode ? 'offline (browser preview)' : 'off' } });
      if (q.get('platform') !== 'android') { l.vault = { status: 'browser preview: no vault' }; l.calSecret = 'dev-secret'; }
      if (q.get('platform') === 'android') l.perms = { notifications: true, accessibility: false, exactAlarm: true, fullScreen: false, battery: false, grayscale: false };
      return JSON.stringify(l);
    },
    apply: function (p) { Engine.merge(state, JSON.parse(p)); changed(); },
    startTimer: function (id, min) { local.timer = { taskId: id, endsAt: Date.now() + min * 60000, minutes: min }; changed(); },
    stopTimer: function () { local.timer = null; changed(); },
    setLocal: function (k, v) { local[k] = JSON.parse(v); changed(); },
    openWhatsApp: function () { alert('Would open WhatsApp'); },
    openDialer: function () { alert('Would open the phone app'); },
    openApp: function (p) { alert('Would open ' + p); },
    closeWindow: function () { history.replaceState(null, '', location.pathname); location.reload(); },
    openPermission: function (n) { alert('Would open settings: ' + n); },
    listApps: function () { return JSON.stringify([{ pkg: 'com.amazon.kindle', label: 'Kindle' }, { pkg: 'com.google.android.youtube', label: 'YouTube' }, { pkg: 'md.obsidian', label: 'Obsidian' }]); },
    getLaunch: function () { return JSON.stringify({ mode: q.get('mode') || 'main', task: q.get('task') || '' }); },
    test: function (k) { if (k === 'remind') alert('Test reminder: on devices this shows a notification and a pop-up.'); }
  };
})();
