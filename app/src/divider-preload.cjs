// 나란히 보기 조절 바 창에 열어 주는 기능: 끄는 동안 마우스 x(화면 좌표)를 보내고, 놓으면 끝을 알린다.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('divider', {
  move: x => ipcRenderer.send('divider:move', Number(x)),
  end: x => ipcRenderer.send('divider:end', Number(x)),
});
