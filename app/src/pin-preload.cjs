// 캡처 핀 창: 고정할 그림을 받고, ✕를 누르면 닫기를 알린다.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('pin', {
  onImage: cb => ipcRenderer.on('pin:image', (_e, src) => cb(src)),
  close: () => ipcRenderer.send('pin:close'),
});
