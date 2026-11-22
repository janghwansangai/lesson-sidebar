// 발표 도구 겹침 창: 메인이 보내는 커서 위치·도구 상태를 받고, 스포트라이트 크기 바꾸기(휠)를 알린다.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('overlay', {
  onState: cb => ipcRenderer.on('overlay:state', (_e, s) => cb(s)),
  onCursor: cb => ipcRenderer.on('overlay:cursor', (_e, p) => cb(p)),
  wheel: dy => ipcRenderer.send('overlay:wheel', Number(dy)),
  close: () => ipcRenderer.send('overlay:close'),
  pick: r => ipcRenderer.send('overlay:pick', r),
  end: () => ipcRenderer.send('overlay:end'),
});
