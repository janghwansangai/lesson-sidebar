// 학생 화면 가림 창: 정지(멈춘 그림)·가리기 상태를 받는다.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('cover', { onState: cb => ipcRenderer.on('cover:state', (_e, s) => cb(s)) });
