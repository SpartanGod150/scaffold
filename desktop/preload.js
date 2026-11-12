const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ScaffoldBridge', {
  platform: () => 'desktop',
  getState: () => ipcRenderer.sendSync('get-state'),
  getLocal: () => ipcRenderer.sendSync('get-local'),
  getLaunch: () => ipcRenderer.sendSync('get-launch'),
  apply: (p) => ipcRenderer.send('apply', p),
  startTimer: (id, min) => ipcRenderer.send('start-timer', id, min),
  stopTimer: () => ipcRenderer.send('stop-timer'),
  setLocal: (k, v) => ipcRenderer.send('set-local', k, v),
  openWhatsApp: () => ipcRenderer.send('open-whatsapp'),
  closeWindow: () => ipcRenderer.send('close-window'),
  openPermission: () => {},
  listApps: () => '[]',
  test: (k) => ipcRenderer.send('test', k)
});

ipcRenderer.on('native', () => { if (window.onNative) window.onNative(); });
