// 수업 사이드바 체험판 — Electron 시작점 (맥·윈도우)
// 사이드바 창(교사 화면 왼쪽)과 수업 준비 창을 띄우고, 수업 진행 로직(Session)·수업 편집(LessonDoc)과 잇는다.
import { app, BrowserWindow, ipcMain, screen, dialog, shell } from 'electron';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Helper } from './core/helper.js';
import { loadLesson } from './core/lesson.js';
import { startFileServer } from './core/fileserver.js';
import { Session } from './core/session.js';
import { LessonDoc } from './core/editor.js';
import { listLessons, suggestRoots, LIB_NAME } from './core/library.js';
import { writeLock, clearLock, otherLock, deviceName } from './core/lock.js';
import * as L from './core/launcher.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(HERE, '..');
const REPO = path.resolve(APP_DIR, '..');
const SIDEBAR_W = 280;
// 자동 숨김으로 접으면 교사 화면 왼쪽 가운데에 노란 막대만 남긴다 (선생님 의견, 2026-11-21)
const BAR_W = 6, BAR_H = 72;
const HOT_W = 16, HOT_MARGIN = 48;   // 막대 옆 이 범위로 마우스를 밀면 펼친다
const DEVICE = deviceName();

// 개발 중에는 설정·로그를 이 폴더 안에 둔다 (패키지로 만들면 운영체제 기본 위치)
// (SIDEBAR_USERDATA를 주면 그 폴더를 쓴다: 선생님이 쓰는 체험판 설정을 건드리지 않고 시험할 때)
if (!app.isPackaged){
  const ud = process.env.SIDEBAR_USERDATA ? path.resolve(process.env.SIDEBAR_USERDATA) : path.join(APP_DIR, '.userdata');
  app.setPath('userData', ud);
  app.setPath('crashDumps', path.join(ud, 'crash'));
  app.setPath('logs', path.join(ud, 'logs'));
}

const IS_WIN = process.platform === 'win32';

/** 창 관리 도우미. 윈도우는 winctl.js를 Electron에 들어 있는 Node로 실행한다 (koffi는 N-API라 그대로 동작). */
function makeHelper(){
  if (IS_WIN){
    const dir = app.isPackaged ? path.join(process.resourcesPath, 'win-helper') : path.join(REPO, 'poc', 'win-helper');
    const script = path.join(dir, 'winctl.js');
    return {
      helper: new Helper(process.execPath, { pre: [script], env: { ELECTRON_RUN_AS_NODE: '1' }, needs: [script, path.join(dir, 'node_modules', 'koffi')] }),
      where: script, fix: 'poc\\win-helper 폴더에서 npm install',
    };
  }
  const bin = app.isPackaged ? path.join(process.resourcesPath, 'winctl') : path.join(REPO, 'poc', 'mac-helper', '.build', 'release', 'winctl');
  return { helper: new Helper(bin), where: bin, fix: 'poc 폴더에서 npm run build:mac' };
}

let win = null, prepWin = null, session = null, helper = null, files = null;
let collapsed = false, outSince = 0, cursorTimer = null;
let doc = null, prepMsg = '', sessionMtime = 0;

// ---------- 설정 ----------
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function readSettings(){ try { return JSON.parse(readFileSync(settingsFile(), 'utf8')); } catch { return {}; } }
function saveSettings(patch){
  const s = { ...readSettings(), ...patch };
  mkdirSync(path.dirname(settingsFile()), { recursive: true });
  writeFileSync(settingsFile(), JSON.stringify(s, null, 2));
}
const mtimeOf = f => { try { return statSync(f).mtimeMs; } catch { return 0; } };

// ---------- 사이드바 창 ----------
function teacherArea(){ return screen.getPrimaryDisplay().workArea; }

function barRect(){
  const wa = teacherArea();
  return { x: wa.x, y: Math.round(wa.y + wa.height / 2 - BAR_H / 2), width: BAR_W, height: BAR_H };
}

// 접으면 창을 막대 크기로 줄인다. 윈도우는 창이 약 32픽셀보다 좁아지지 않아, 창을 투명하게 만들고(transparent) 막대만 그린다.
// (창 모양 setShape는 클릭만 막고 그리기는 막지 못해 회색 띠가 남았다 — docs/poc/windows.md 체험판 6)
// 접힌 동안은 창 전체가 클릭을 아래 창으로 넘긴다. 펼치기는 마우스 위치(watchCursor)로 판단하므로 클릭이 필요 없다.
function placeSidebar(){
  if (!win) return;
  const wa = teacherArea();
  win.setIgnoreMouseEvents(collapsed);
  win.setBounds(collapsed ? barRect() : { x: wa.x, y: wa.y, width: SIDEBAR_W, height: wa.height });
}

const SECURE = file => ({ preload: path.join(HERE, file), contextIsolation: true, sandbox: true, nodeIntegration: false });

function lockDown(w){
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('will-navigate', e => e.preventDefault());
}

function createSidebar(){
  const wa = teacherArea();
  win = new BrowserWindow({
    x: wa.x, y: wa.y, width: SIDEBAR_W, height: wa.height,
    frame: false, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
    alwaysOnTop: true, skipTaskbar: true, show: false, title: '수업 사이드바',
    // 접은 막대 주변이 비쳐 보이도록 투명 창. 펼쳤을 때는 화면(body)의 칠판색 배경이 창을 채운다
    transparent: true, backgroundColor: '#00000000',
    type: process.platform === 'darwin' ? 'panel' : undefined,
    // 윈도우: 보이지 않는 크기 조절 테두리(8픽셀)를 없애 창이 화면 왼쪽 끝(x=0)에 정확히 붙게 한다 (투명 창에도 필요)
    thickFrame: false,
    webPreferences: SECURE('preload.cjs'),
  });
  // PPT 전체 화면 슬라이드 쇼 위에서도 보이게 (기술 검증 항목 4)
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  lockDown(win);
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
  session.say(session.autoHide ? '자동 숨김: 화면 왼쪽 가운데 노란 막대 옆으로 마우스를 밀면 나타납니다' : '사이드바를 화면 왼쪽에 고정했습니다');
}

let lastCursor = null;
function watchCursor(){
  if (!win) return;
  const p = screen.getCursorScreenPoint();
  const prev = lastCursor;
  lastCursor = p;
  if (collapsed){
    const edge = teacherArea().x, bar = barRect();
    const inBand = pt => pt.y >= bar.y - HOT_MARGIN && pt.y <= bar.y + bar.height + HOT_MARGIN;
    // 막대 옆(교사 화면 왼쪽 끝 HOT_W 안)에 마우스가 오면 펼친다. 왼쪽 끝을 넘어간 다른 모니터(학생 화면)는 제외
    const atBar = inBand(p) && p.x >= edge && p.x <= edge + HOT_W;
    // 학생 화면이 왼쪽에 있으면 마우스가 끝에서 멈추지 않고 넘어가므로, 막대 높이에서 왼쪽으로 넘어간 것도 "밀었다"로 본다
    // (넘어간 뒤의 높이는 보지 않는다: 배율이 다른 화면에서는 같은 높이도 화면 단위 값이 달라진다)
    const pushedPast = prev && inBand(prev) && prev.x >= edge && p.x < edge;
    if (atBar || pushedPast){ collapsed = false; outSince = 0; placeSidebar(); push(); }
    return;
  }
  const b = win.getBounds();
  if (p.y >= b.y && p.y <= b.y + b.height && p.x >= b.x && p.x <= b.x + b.width + 16){
    outSince = 0;
  } else {
    outSince ||= Date.now();
    if (Date.now() - outSince > 700){ collapsed = true; outSince = 0; placeSidebar(); push(); }
  }
}

// ---------- 사이드바에서 진행할 수업 ----------
function runLesson(folder){
  try {
    const lesson = loadLesson(folder);
    const prev = session.lesson?.root;
    if (prev && prev !== lesson.root && prev !== doc?.root) clearLock(prev, DEVICE);
    if (prev === lesson.root) session.reload(lesson); else session.load(lesson);
    sessionMtime = mtimeOf(path.join(lesson.root, 'lesson.json'));
    writeLock(lesson.root, DEVICE);
    saveSettings({ lastFolder: lesson.root });
    return true;
  } catch (e){
    session.say(e.message);
    return false;
  }
}

/** 편집한 수업이 사이드바에서 진행 중이면 바로 반영 */
function refreshSessionIfSame(root){
  if (session.lesson?.root !== root) return;
  try { session.reload(loadLesson(root)); sessionMtime = mtimeOf(path.join(root, 'lesson.json')); }
  catch (e){ session.say(e.message); }
}

// ---------- 수업 준비 창 ----------
function openPrep(){
  if (prepWin){ prepWin.show(); prepWin.focus(); return; }
  const wa = teacherArea();
  const w = Math.min(1200, wa.width - SIDEBAR_W - 40), h = Math.min(820, wa.height - 20);
  prepWin = new BrowserWindow({
    x: Math.round(wa.x + SIDEBAR_W + Math.max(20, (wa.width - SIDEBAR_W - w) / 2)), y: Math.round(wa.y + Math.max(10, (wa.height - h) / 2)),
    width: w, height: h, minWidth: 760, minHeight: 520, title: '수업 준비 — 수업 사이드바', backgroundColor: '#f2f4f1', show: false,
    webPreferences: SECURE('prep-preload.cjs'),
  });
  lockDown(prepWin);
  prepWin.loadFile(path.join(HERE, 'renderer', 'prep.html'));
  prepWin.once('ready-to-show', () => { prepWin.show(); app.focus({ steal: true }); });
  prepWin.on('closed', () => { prepWin = null; });
}

const libraryRoot = () => readSettings().libraryRoot ?? null;

function prepSnapshot(){
  const root = libraryRoot();
  const openIds = doc && session.lesson?.root === doc.root
    ? [...session.state].filter(([, st]) => st.wid).map(([id]) => id) : [];
  let lockedBy = null;
  if (doc){ lockedBy = otherLock(doc.root, DEVICE)?.device ?? null; }
  return {
    library: { root, lessons: root ? listLessons(root) : [], suggestions: root ? [] : suggestRoots(), libName: LIB_NAME },
    doc: doc ? { ...doc.snapshot(), lockedBy } : null,
    running: session.lesson?.root ?? null, openIds, device: DEVICE, msg: prepMsg, platform: process.platform,
  };
}
function prepPush(){ prepWin?.webContents.send('prep:state', prepSnapshot()); }
function note(msg){ prepMsg = msg; prepPush(); }

function openDoc(folder){
  const next = new LessonDoc(folder).load();
  if (doc && doc.root !== next.root && doc.root !== session.lesson?.root) clearLock(doc.root, DEVICE);
  const other = otherLock(next.root, DEVICE);
  doc = next;
  writeLock(doc.root, DEVICE);
  saveSettings({ lastPrepFolder: doc.root });
  note(other ? `주의: '${other.device}'에서 이 수업을 ${Math.max(1, Math.round((Date.now() - other.at) / 60000))}분 전까지 열고 있었습니다. 동시에 고치면 내용이 부딪힐 수 있습니다`
             : `'${doc.data.title}' 수업을 열었습니다`);
}

function needDoc(){ if (!doc) throw new Error('먼저 왼쪽에서 수업을 고르거나 새로 만드세요'); return doc; }
function afterEdit(msg){
  doc.save();
  refreshSessionIfSame(doc.root);
  note(msg ?? '저장했습니다');
}

const str = (v, max = 500) => typeof v === 'string' ? v.slice(0, max) : undefined;
const absPath = v => { const s = str(v, 4096); return s && path.isAbsolute(s) ? s : null; };

const PREP_ACTIONS = {
  async chooseLibrary(){
    const r = await dialog.showOpenDialog(prepWin, { title: '수업 보관함으로 쓸 폴더 고르기', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return;
    saveSettings({ libraryRoot: r.filePaths[0] });
    note(`수업 보관함: ${r.filePaths[0]}`);
  },
  setLibrary(p){
    const dir = absPath(p.path); if (!dir) throw new Error('보관함 위치가 올바르지 않습니다');
    mkdirSync(dir, { recursive: true });
    saveSettings({ libraryRoot: dir });
    note(`수업 보관함을 만들었습니다: ${dir}`);
  },
  newLesson(p){
    const root = libraryRoot(); if (!root) throw new Error('먼저 수업 보관함 위치를 정해 주세요');
    const d = LessonDoc.create(root, { title: str(p.title, 120), date: str(p.date, 10) });
    openDoc(d.root);
    note(`새 수업을 만들었습니다: ${path.basename(d.root)}`);
  },
  openLesson(p){
    const dir = absPath(p.folder); if (!dir || !existsSync(path.join(dir, 'lesson.json'))) throw new Error('수업 폴더가 아닙니다 (lesson.json 없음)');
    openDoc(dir);
  },
  async openOther(){
    const r = await dialog.showOpenDialog(prepWin, { title: '수업 폴더 고르기 (lesson.json이 있는 폴더)', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return;
    PREP_ACTIONS.openLesson({ folder: r.filePaths[0] });
  },
  info(p){ needDoc().setInfo({ title: str(p.title, 120), date: str(p.date, 10) }); afterEdit(); },
  addSection(){ needDoc().addSection(); afterEdit('구간을 넣었습니다'); },
  updateSection(p){ needDoc().updateSection(str(p.id, 60), { title: str(p.title, 40), minutes: p.minutes }); afterEdit(); },
  removeSection(p){ needDoc().removeSection(str(p.id, 60)); afterEdit('구간을 지웠습니다'); },
  async addFiles(p){
    const paths = Array.isArray(p.paths) ? p.paths.map(absPath).filter(Boolean).slice(0, 200) : [];
    if (!paths.length) throw new Error('넣을 파일이 없습니다');
    note(`파일 ${paths.length}개를 수업 폴더로 복사하는 중…`);
    const r = await needDoc().addFiles(paths, str(p.sec, 60));
    const skip = r.skipped.length ? ` · 넣지 않음 ${r.skipped.length}개 (${r.skipped.map(s => `${s.name}: ${s.reason}`).join(', ')})` : '';
    afterEdit(`${r.added.length}개 파일을 수업 폴더로 복사했습니다 (원본은 그대로)${skip}`);
  },
  async pickFiles(p){
    const r = await dialog.showOpenDialog(prepWin, { title: '넣을 자료 고르기', properties: ['openFile', 'multiSelections'] });
    if (r.canceled || !r.filePaths.length) return;
    await PREP_ACTIONS.addFiles({ paths: r.filePaths, sec: p.sec });
  },
  addLink(p){ const it = needDoc().addLink(str(p.url, 2000), str(p.sec, 60), str(p.title, 80)); afterEdit(`'${it.title}' 링크를 넣었습니다`); },
  addMemo(p){ const it = needDoc().addMemo(str(p.sec, 60)); afterEdit(`'${it.title}'를 만들었습니다 · "편집"을 누르면 메모를 고칠 수 있습니다`); },
  updateItem(p){ needDoc().updateItem(str(p.id, 60), { title: str(p.title, 80), start: str(p.start, 20), screen: p.screen === null ? null : str(p.screen, 10) }); afterEdit(); },
  removeItem(p){ const it = needDoc().removeItem(str(p.id, 60)); afterEdit(it ? `'${it.title}'을(를) 흐름에서 뺐습니다${it.file ? ' · 파일은 .sidebar/휴지통에 있습니다' : ''}` : undefined); },
  moveItem(p){ needDoc().moveItem(str(p.id, 60), str(p.sec, 60), str(p.before, 60) ?? null); afterEdit('순서를 바꿨습니다 · 파일 이름 순번은 "정리하기"에서 맞춥니다'); },
  tidy(){
    const d = needDoc();
    const open = new Set(session.lesson?.root === d.root ? [...session.state].filter(([, st]) => st.wid).map(([id]) => id) : []);
    const r = d.tidy(open);
    afterEdit(r.renamed.length || r.skipped.length
      ? `파일 ${r.renamed.length}개 이름을 순서에 맞췄습니다${r.skipped.length ? ` · ${r.skipped.length}개는 건너뜀 (${r.skipped.map(s => `${s.title}: ${s.reason}`).join(', ')})` : ''}`
      : '이미 순서대로 정리되어 있습니다');
  },
  editMemo(p){
    const loc = needDoc().locate(str(p.id, 60));
    if (!loc?.item.file) return;
    // 윈도우는 .md에 연결된 프로그램이 없는 PC가 많아 메모장으로 연다
    if (IS_WIN) return L.openWithApp(L.APPS.text, doc.abs(loc.item.file));
    shell.openPath(doc.abs(loc.item.file));
  },
  reveal(){ shell.openPath(needDoc().root); },
  run(){
    const d = needDoc();
    if (runLesson(d.root)){ note(`사이드바에서 '${d.data.title}' 수업을 진행합니다`); prepWin?.hide(); }
  },
};

async function prepAct(action, payload){
  const fn = Object.hasOwn(PREP_ACTIONS, action) ? PREP_ACTIONS[action] : null;
  if (!fn) return false;
  const p = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  try { await fn(p); }
  catch (e){ note(e.message); }
  prepPush();
  return true;
}

// ---------- 사이드바 화면에서 오는 요청 ----------
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
  prep: () => openPrep(),
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
ipcMain.handle('prep:state', e => (e.sender === prepWin?.webContents ? prepSnapshot() : null));
ipcMain.handle('prep:act', (e, action, payload) => (e.sender === prepWin?.webContents ? prepAct(action, payload) : false));
// 준비 창이 닫히는 순간 입력 중이던 글자를 놓치지 않도록, 글자 칸 고치기만 동기로 받아 바로 저장한다
const SYNC_EDITS = new Set(['info', 'updateSection', 'updateItem']);
ipcMain.on('prep:act-sync', (e, action, payload) => {
  let ok = false;
  if (e.sender === prepWin?.webContents && SYNC_EDITS.has(action) && payload && typeof payload === 'object' && !Array.isArray(payload)){
    try { PREP_ACTIONS[action](payload); ok = true; } catch (err){ prepMsg = err.message; }
  }
  e.returnValue = ok;
});

// ---------- 다른 PC·프로그램이 바꾼 내용 알아채기 (클라우드 동기화) ----------
function watchOutside(){
  if (doc?.changedOutside()){
    try { doc.load(); note('다른 곳(다른 PC 등)에서 바뀐 내용을 불러왔습니다'); refreshSessionIfSame(doc.root); }
    catch { /* 동기화 중 반쯤 쓰인 파일일 수 있어 다음에 다시 */ }
  }
  const sroot = session.lesson?.root;
  if (sroot && sroot !== doc?.root){
    const m = mtimeOf(path.join(sroot, 'lesson.json'));
    if (m && m !== sessionMtime){
      try { session.reload(loadLesson(sroot)); sessionMtime = m; session.say('다른 곳에서 바뀐 수업 내용을 불러왔습니다'); }
      catch { /* 다음에 다시 */ }
    }
  }
}

function heartbeat(){
  for (const root of new Set([doc?.root, session.lesson?.root].filter(Boolean))) writeLock(root, DEVICE);
}

// 개발용 원격 조작 (SIDEBAR_DEBUG=1일 때만): 맥·윈도우 Claude가 화면을 누르지 않고 동작을 시험한다
async function startDebugServer(){
  const token = randomBytes(12).toString('hex');
  const srv = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    const [t, cmd] = u.pathname.split('/').filter(Boolean);
    if (t !== token){ res.writeHead(404); res.end(); return; }
    let out;
    if (cmd === 'prep'){
      if (u.searchParams.get('do') === 'open') openPrep();
      else await prepAct(u.searchParams.get('do'), JSON.parse(u.searchParams.get('p') ?? '{}'));
      out = prepSnapshot();
    } else {
      if (cmd === 'act') await act(u.searchParams.get('do'), u.searchParams.get('arg') ?? undefined).catch(e => session.say(e.message));
      out = { ...session.snapshot(), collapsed };
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(out));
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const info = { url: `http://127.0.0.1:${srv.address().port}/${token}` };
  writeFileSync(path.join(app.getPath('userData'), 'debug.json'), JSON.stringify(info));
  console.log('[debug]', info.url);
}

// ---------- 시작 ----------
app.whenReady().then(async () => {
  if (process.platform === 'darwin') app.dock?.hide();
  const h = makeHelper();
  helper = h.helper;
  if (!helper.available()){
    dialog.showErrorBox('수업 사이드바', `창 관리 도우미를 찾지 못했습니다.\n${h.where}\n(${h.fix})`);
    app.quit();
    return;
  }
  // 윈도우: 문서는 Electron의 shell.openPath(ShellExecute)로 연다 — cmd를 거치지 않아 파일 이름의 특수 문자도 안전
  if (IS_WIN) L.setFileOpener(async p => { const err = await shell.openPath(p); if (err) throw new Error(err); });
  files = await startFileServer(() => session?.lesson?.root);
  session = new Session({ helper, files, ownPid: process.pid, sidebarWidth: SIDEBAR_W, physicalPixels: IS_WIN });
  session.on('change', push);
  await session.refreshDisplays();

  const settings = readSettings();
  createSidebar();
  if (!(settings.lastFolder && existsSync(settings.lastFolder) && runLesson(settings.lastFolder))) runLesson(path.join(APP_DIR, 'sample-lesson'));
  if (settings.lastPrepFolder && existsSync(path.join(settings.lastPrepFolder, 'lesson.json'))){
    try { openDoc(settings.lastPrepFolder); } catch { doc = null; }
  }
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

  setInterval(watchOutside, 3000);
  setInterval(heartbeat, 30000);

  if (process.env.SIDEBAR_DEBUG === '1') await startDebugServer();
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  for (const root of new Set([doc?.root, session?.lesson?.root].filter(Boolean))) clearLock(root, DEVICE);
  helper?.stop(); files?.close(); clearInterval(cursorTimer);
});
