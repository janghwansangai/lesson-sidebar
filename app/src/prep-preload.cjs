// 수업 준비 창에 열어 주는 기능. 끌어다 놓은 파일의 경로는 webUtils로만 얻는다.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('prep', {
  state: () => ipcRenderer.invoke('prep:state'),
  act: (action, payload) => ipcRenderer.invoke('prep:act', action, payload ?? {}),
  onState: cb => {
    const h = (_e, s) => cb(s);
    ipcRenderer.on('prep:state', h);
    return () => ipcRenderer.removeListener('prep:state', h);
  },
  pathsOf: files => Array.from(files ?? []).map(f => { try { return webUtils.getPathForFile(f); } catch { return ''; } }).filter(Boolean),
});
