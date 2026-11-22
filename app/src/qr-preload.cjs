// 링크 QR 창: 메인이 보낼 QR 그림·제목·주소를 받고, 누르거나 Esc면 닫기를 알린다.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('qr', {
  onShow: cb => ipcRenderer.on('qr:show', (_e, d) => cb(d)),
  close: () => ipcRenderer.send('qr:close'),
});
