// 녹화 창(보이지 않음): 메인이 시작·끝을 알리고, 녹화 조각(2초마다)을 메인에 보낸다.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('rec', {
  onStart: cb => ipcRenderer.on('rec:start', (_e, o) => cb(o)),
  onStop: cb => ipcRenderer.on('rec:stop', () => cb()),
  chunk: buf => ipcRenderer.send('rec:chunk', buf),
  started: info => ipcRenderer.send('rec:started', info),
  stopped: () => ipcRenderer.send('rec:stopped'),
  error: msg => ipcRenderer.send('rec:error', String(msg)),
});
