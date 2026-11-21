// 수업 사이드바 체험판 — Electron 시작점 (맥)
// 사이드바 창을 교사 화면 왼쪽에 붙이고, 수업 진행 로직(Session)과 화면을 잇는다.
import { app, BrowserWindow, ipcMain, screen, dialog } from 'electron';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Helper } from './core/helper.js';
import { loadLesson } from './core/lesson.js';
import { startFileServer } from './core/fileserver.js';
import { Session } from './core/session.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(HERE, '..');
const REPO = path.resolve(APP_DIR, '..');
const SIDEBAR_W = 280;
const STRIP_W = 10;

// 개발 중에는 설정·로그를 이 폴더 안에 둔다 (패키지로 만들면 운영체제 기본 위치)
if (!app.isPackaged){
  const ud = path.join(APP_DIR, '.userdata');
  app.setPath('userData', ud);
  app.setPath('crashDumps', path.join(ud, 'crash'));
  app.setPath('logs', path.join(ud, 'logs'));
}

const helperPath = () => app.isPackaged
  ? path.join(process.resourcesPath, 'winctl')
  : path.join(REPO, 'poc', 'mac-helper', '.build', 'release', 'winctl');

let win = null, session = null, helper = null, files = null;
let collapsed = false, outSince = 0, cursorTimer = null;

// ---------- 설정 ----------
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function readSettings(){ try { return JSON.parse(readFileSync(settingsFile(), 'utf8')); } catch { return {}; } }
function saveSettings(patch){
  const s = { ...readSettings(), ...patch };
  mkdirSync(path.dirname(settingsFile()), { recursive: true });
  writeFileSync(settingsFile(), JSON.stringify(s, null, 2));
}

// ---------- 사이드바 창 ----------
function teacherArea(){ return screen.getPrimaryDisplay().workArea; }

function placeSidebar(){
  if (!win) return;
  const wa = teacherArea();
  win.setBounds({ x: wa.x, y: wa.y, width: collapsed ? STRIP_W : SIDEBAR_W, height: wa.height });
}

function createSidebar(){
  const wa = teacherArea();
  win = new BrowserWindow({
    x: wa.x, y: wa.y, width: SIDEBAR_W, height: wa.height,
    frame: false, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
    alwaysOnTop: true, skipTaskbar: true, show: false, backgroundColor: '#1b2f2a',
    title: '수업 사이드바',
    type: process.platform === 'darwin' ? 'panel' : undefined,
    webPreferences: { preload: path.join(HERE, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  // PPT 전체 화면 슬라이드 쇼 위에서도 보이게 (기술 검증 항목 4)
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.loadFile(path.join(HERE, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; });
}

function push(){ win?.webContents.send('state', { ...session.snapshot(), collapsed }); }

// ---------- 자동 숨김 ----------
function setAutoHide(v){
  session.autoHide = !!v;
  saveSettings({ autoHide: session.autoHide });
  clearInterval(cursorTimer);
  collapsed = session.autoHide;
  placeSidebar();
  if (session.autoHide) cursorTimer = setInterval(watchCursor, 120);
  session.say(session.autoHide ? '자동 숨김: 화면 왼쪽 끝에 마우스를 대면 나타납니다' : '사이드바를 화면 왼쪽에 고정했습니다');
}

function watchCursor(){
  if (!win) return;
  const p = screen.getCursorScreenPoint();
  const b = win.getBounds();
  const inY = p.y >= b.y && p.y <= b.y + b.height;
  if (collapsed){
    if (inY && p.x <= b.x + STRIP_W){ collapsed = false; placeSidebar(); push(); }
  } else if (inY && p.x >= b.x && p.x <= b.x + b.width + 16){
    outSince = 0;
  } else {
    outSince ||= Date.now();
    if (Date.now() - outSince > 700){ collapsed = true; outSince = 0; placeSidebar(); push(); }
  }
}

// ---------- 수업 폴더 ----------
function openLesson(folder){
  try {
    session.load(loadLesson(folder));
    saveSettings({ lastFolder: folder });
    return true;
  } catch (e){
    session.say(e.message);
    return false;
  }
}

async function chooseFolder(){
  const r = await dialog.showOpenDialog({ title: '수업 폴더 고르기 (lesson.json이 있는 폴더)', properties: ['openDirectory'] });
  if (!r.canceled && r.filePaths[0]) openLesson(r.filePaths[0]);
}

// ---------- 화면에서 오는 요청 ----------
const ACTIONS = {
  activate: id => session.activate(id),
  move: id => session.move(id),
  close: id => session.close(id),
  toggleSel: id => session.toggleSel(id),
  split: () => session.split(),
  untile: () => session.untile(),
  openAll: () => session.openAll(),
  next: () => session.next(),
  hideOthers: () => session.hideOthers(),
  openTo: v => session.setOpenTo(v),
  autoHide: v => setAutoHide(v === true || v === 'true'),
  chooseFolder: () => chooseFolder(),
  quit: () => app.quit(),
};

async function act(action, arg){
  const fn = Object.hasOwn(ACTIONS, action) ? ACTIONS[action] : null;
  if (!fn) return false;
  if (arg !== undefined && typeof arg !== 'string' && typeof arg !== 'boolean') return false;
  await fn(arg);
  return true;
}

ipcMain.handle('state', () => ({ ...session.snapshot(), collapsed }));
ipcMain.handle('act', (e, action, arg) => {
  if (e.sender !== win?.webContents) return false;
  act(action, arg).catch(err => session.say(err.message));
  return true;
});

// 개발용 원격 조작 (SIDEBAR_DEBUG=1일 때만): 맥·윈도우 Claude가 화면을 누르지 않고 동작을 시험한다
async function startDebugServer(){
  const token = randomBytes(12).toString('hex');
  const srv = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    const [t, cmd] = u.pathname.split('/').filter(Boolean);
    if (t !== token){ res.writeHead(404); res.end(); return; }
    if (cmd === 'act') await act(u.searchParams.get('do'), u.searchParams.get('arg') ?? undefined).catch(e => session.say(e.message));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ...session.snapshot(), collapsed }));
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const info = { url: `http://127.0.0.1:${srv.address().port}/${token}` };
  writeFileSync(path.join(app.getPath('userData'), 'debug.json'), JSON.stringify(info));
  console.log('[debug]', info.url);
}

// ---------- 시작 ----------
app.whenReady().then(async () => {
  if (process.platform === 'darwin') app.dock?.hide();
  helper = new Helper(helperPath());
  if (!helper.available()){
    dialog.showErrorBox('수업 사이드바', `창 관리 도우미를 찾지 못했습니다.\n${helperPath()}\n(poc 폴더에서 npm run build:mac)`);
    app.quit();
    return;
  }
  files = await startFileServer(() => session?.lesson?.root);
  session = new Session({ helper, files, ownPid: process.pid, sidebarWidth: SIDEBAR_W });
  session.on('change', push);
  await session.refreshDisplays();

  const settings = readSettings();
  createSidebar();
  if (!(settings.lastFolder && openLesson(settings.lastFolder))) openLesson(path.join(APP_DIR, 'sample-lesson'));
  if (settings.autoHide) setAutoHide(true);

  const trusted = (await helper.call('trusted')).trusted;
  if (trusted) await session.relink();
  else session.say('손쉬운 사용 권한이 없어 다른 프로그램 창을 옮길 수 없습니다. 시스템 설정 → 개인정보 보호 및 보안 → 손쉬운 사용에서 켜 주세요');
  helper.startWatch();

  let t = null;
  const onDisplays = () => { clearTimeout(t); t = setTimeout(async () => { await session.onDisplaysChanged(); placeSidebar(); }, 800); };
  screen.on('display-added', onDisplays);
  screen.on('display-removed', onDisplays);
  screen.on('display-metrics-changed', onDisplays);

  if (process.env.SIDEBAR_DEBUG === '1') await startDebugServer();
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { helper?.stop(); files?.close(); clearInterval(cursorTimer); });
