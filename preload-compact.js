const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('__compact', {
  onLog:          (cb) => ipcRenderer.on('log:entry',          (_e, d) => cb(d)),
  onDropPending:  (cb) => ipcRenderer.on('drop:pending',       (_e, d) => cb(d)),
  onDropCollected:(cb) => ipcRenderer.on('drop:collected',     (_e, d) => cb(d)),
  onStateChange:  (cb) => ipcRenderer.on('monitor:stateChange',(_e, d) => cb(d)),
  closeCompact:   ()   => ipcRenderer.send('compact:close'),
})
