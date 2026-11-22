// 녹화 창(보이지 않음): 메인이 시작·끝·나누기를 알리고, 녹화 조각(2초마다, 몇 부인지와 함께)을 메인에 보낸다.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('rec', {
  onStart: cb => ipcRenderer.on('rec:start', (_e, o) => cb(o)),
  onStop: cb => ipcRenderer.on('rec:stop', () => cb()),
  onSplit: cb => ipcRenderer.on('rec:split', (_e, n) => cb(Number(n))),
  onCover: cb => ipcRenderer.on('rec:cover', (_e, c) => cb(c ?? null)),
  chunk: (buf, n) => ipcRenderer.send('rec:chunk', buf, Number(n) || 1),
  partDone: n => ipcRenderer.send('rec:partDone', Number(n)),
  started: info => ipcRenderer.send('rec:started', info),
  stopped: () => ipcRenderer.send('rec:stopped'),
  error: msg => ipcRenderer.send('rec:error', String(msg)),
  waiting: () => ipcRenderer.send('rec:waiting'),
});
