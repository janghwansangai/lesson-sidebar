// 발표 도구 겹침 창: 메인이 보내는 커서 위치·도구 상태를 받고, 스포트라이트 크기 바꾸기(휠)를 알린다.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('overlay', {
  onState: cb => ipcRenderer.on('overlay:state', (_e, s) => cb(s)),
  onCursor: cb => ipcRenderer.on('overlay:cursor', (_e, p) => cb(p)),
  wheel: dy => ipcRenderer.send('overlay:wheel', Number(dy)),
  close: () => ipcRenderer.send('overlay:close'),
  pick: r => ipcRenderer.send('overlay:pick', r),
  end: () => ipcRenderer.send('overlay:end'),
  onClick: cb => ipcRenderer.on('overlay:click', (_e, c) => cb(c)),
  onClear: cb => ipcRenderer.on('overlay:clear', () => cb()),
  onSaved: cb => ipcRenderer.on('overlay:saved', (_e, ok) => cb(!!ok)),
  ink: s => ipcRenderer.send('overlay:ink', { color: String(s.color), size: Number(s.size), mode: String(s.mode) }),
  save: () => ipcRenderer.send('overlay:save'),
  off: () => ipcRenderer.send('overlay:off'),
});
