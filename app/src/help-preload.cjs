// 도움말 창: 버전·OS·단축키를 받고, 업데이트 확인·오류 신고·다있쌤 툴즈 열기를 메인에 부탁한다.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('help', {
  info: () => ipcRenderer.invoke('help:info'),
  act: what => ipcRenderer.send('help:act', String(what)),
  onUpdate: cb => ipcRenderer.on('help:update', (_e, d) => cb(d)),
});
