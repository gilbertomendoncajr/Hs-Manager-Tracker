const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('__HSoverlay', {
  onDrop: (cb) => ipcRenderer.on('overlay:drop', (_e, drop) => cb(drop)),
})
