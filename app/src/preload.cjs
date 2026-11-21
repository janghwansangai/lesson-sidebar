// 화면(렌더러)에 열어 주는 기능은 이것뿐이다. 파일·프로그램 실행은 모두 메인 프로세스가 검사한 뒤 한다.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sidebar', {
  state: () => ipcRenderer.invoke('state'),
  act: (action, arg) => ipcRenderer.invoke('act', action, arg),
  onState: cb => {
    const h = (_e, s) => cb(s);
    ipcRenderer.on('state', h);
    return () => ipcRenderer.removeListener('state', h);
  },
});
