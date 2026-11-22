// 수업 사이드바 체험판 — Electron 시작점 (맥·윈도우)
// 사이드바 창(교사 화면 왼쪽)과 수업 준비 창을 띄우고, 수업 진행 로직(Session)·수업 편집(LessonDoc)과 잇는다.
import { app, BrowserWindow, ipcMain, screen, dialog, shell, net } from 'electron';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, cpSync, createReadStream, statfsSync } from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Helper } from './core/helper.js';
import { loadLesson } from './core/lesson.js';
import { startFileServer } from './core/fileserver.js';
import { Session, TILE_LAYOUTS } from './core/session.js';
import { LessonDoc } from './core/editor.js';
import { listLessons, suggestRoots, LIB_NAME } from './core/library.js';
import { writeLock, clearLock, otherLock, deviceName } from './core/lock.js';
import { exportBundle, inspectBundle, importBundle, findExisting, fmtBytes } from './core/bundle.js';
import { precheck, checkLink, cloudOf } from './core/precheck.js';
import * as L from './core/launcher.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(HERE, '..');
const REPO = path.resolve(APP_DIR, '..');
const SIDEBAR_W = 280;
// 자동 숨김으로 접히면 교사 화면 왼쪽 가운데에 반투명 노란 막대(손잡이)만 남긴다.
// 화면 높이 전체 띠는 다른 프로그램을 가려서 막대만큼으로 줄이고 반투명하게 했다 (선생님 의견, 2026-11-21, 맥·윈도우 모두).
// 반투명 정도는 style.css의 .strip (55%)
const BAR_W = 6, BAR_H = 84;
const EDGE_W = 10;       // 교사 화면 왼쪽 끝 이 폭 안에 마우스를 대면 (높이 어디든) 펼친다
const HOT_MARGIN = 48;   // 막대 높이 위아래 여유: 이 높이에서 왼쪽 모니터로 넘어가도 펼친다
// 펼친 사이드바 배경 투명도 (설정에서 고름). 글씨·단추는 그대로 진하고 배경만 비친다. 70%보다 옅으면 뒤 창 글자와 겹쳐 읽기 어렵다
const OPACITY_STEPS = [100, 90, 80, 70];
const DEVICE = deviceName();

// 개발 중에는 설정·로그를 이 폴더 안에 둔다 (패키지로 만들면 운영체제 기본 위치)
// (SIDEBAR_USERDATA를 주면 그 폴더를 쓴다: 선생님이 쓰는 체험판 설정을 건드리지 않고 시험할 때)
if (!app.isPackaged){
  const ud = process.env.SIDEBAR_USERDATA ? path.resolve(process.env.SIDEBAR_USERDATA) : path.join(APP_DIR, '.userdata');
  app.setPath('userData', ud);
  app.setPath('crashDumps', path.join(ud, 'crash'));
  app.setPath('logs', path.join(ud, 'logs'));
}

// 설치판에서 앱을 두 번 눌러도 사이드바는 하나만 (두 번째는 기존 사이드바를 펼친다)
const firstInstance = app.requestSingleInstanceLock();
if (!firstInstance) app.quit();

const NO_TRUST = "손쉬운 사용 권한이 없어 자료 창을 찾거나 옮길 수 없습니다. 시스템 설정 → 개인정보 보호 및 보안 → 손쉬운 사용에서 '수업 사이드바'를 켜 주세요. 이미 켜져 있으면 −로 지운 뒤 사이드바를 다시 켜서 새로 허용해 주세요 (새로 설치하면 다시 해야 합니다)";

/** 예시 수업 폴더. 설치판은 앱 안(바꾸면 안 되는 곳)에 들어 있으므로 설정 폴더로 한 번 복사해서 쓴다. */
function sampleLesson(){
  if (!app.isPackaged) return path.join(APP_DIR, 'sample-lesson');
  const dst = path.join(app.getPath('userData'), '체험용 수업');
  if (!existsSync(path.join(dst, 'lesson.json'))) cpSync(path.join(process.resourcesPath, 'sample-lesson'), dst, { recursive: true });
  return dst;
}

/**
 * 손쉬운 사용 권한을 5초마다 확인한다. 꺼져 있으면 사이드바 위쪽에 안내를 계속 보이고(상태 trusted:false),
 * 켜지면 다시 켤 필요 없이 바로 창 연결·비키기를 시작한다.
 * 맥은 임시 서명 앱을 새로 설치할 때마다 다른 앱으로 보아, 설정에는 켜져 보여도 권한이 풀려 있을 수 있다 (docs/poc/mac.md 33).
 */
let trustTimer = null;
function watchTrust(){
  clearInterval(trustTimer);
  trustTimer = setInterval(async () => {
    let ok = session.trusted;
    try { ok = (await helper.call('trusted')).trusted; } catch { /* 다음에 다시 */ }
    if (ok === session.trusted) return;
    session.trusted = ok;
    push();
    if (ok){
      helper.restartWatch();
      await session.relink();
      syncAsideWatch();
      session.say('손쉬운 사용 권한이 켜졌습니다. 이제 자료 창을 찾고 옮기고 닫을 수 있습니다');
    } else session.say(NO_TRUST);
  }, 5000);
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
// 사이드바 설정. aside: 고정해 둘 때 가려지는 창을 옆으로 비키기 (윈도우만 — 맥은 맥 Claude 확인 뒤)
let prefs = { opacity: 100, aside: false };
const ASIDE_OK = IS_WIN || process.platform === 'darwin';   // 맥도 2026-11-22부터 (docs/poc/mac.md, 기본은 꺼짐)
// 맥: 고정해 둔 동안 2초마다 살펴 새로 가려진 창도 비킨다 (선생님 요청, docs/poc/mac.md 31). 윈도우는 지금처럼 펼치고 접는 순간에만
const ASIDE_KEEP = process.platform === 'darwin';
let asideTimer = null;
function syncAsideWatch(){
  clearInterval(asideTimer); asideTimer = null;
  if (!ASIDE_KEEP || !prefs.aside || session.autoHide) return;
  asideTimer = setInterval(async () => {
    const n = await session.keepAside().catch(() => 0);
    if (n) session.say(`사이드바에 가려진 창 ${n}개를 오른쪽으로 옮겼습니다 · 고정을 풀거나 이 설정을 끄면 돌려놓습니다`);
  }, 2000);
}

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

const fullState = () => ({ ...session.snapshot(), collapsed, trusted: session.trusted !== false, prefs: { ...prefs, steps: OPACITY_STEPS, asideAvailable: ASIDE_OK } });
function push(){ win?.webContents.send('state', fullState()); syncDivider(); }

// ---------- 나란히 보기 조절 바 ----------
// 나란히 놓은 창의 경계에 가는 막대 창을 띄운다: 세로 경계(v) 하나 + 큰 화면+2·4분할이면 가로 경계(h) 하나.
// 끄는 동안에는 막대만 마우스를 따라가고, 놓을 때 창들을 한 번에 옮긴다.
// (PPT·엑셀은 한 번 옮기는 데 0.5초 넘게 걸려, 끄는 동안 계속 옮기면 창이 3초 넘게 늦게 따라왔다 — docs/poc/mac.md 36)
// 도우미 좌표: 맥은 Electron과 같은 포인트, 윈도우는 물리 픽셀 → DIP로 바꿔서 창을 놓는다.
const DIV_W = 16;
const divWins = { v: null, h: null };
let divDrag = null;   // 끄는 중인 막대 'v' | 'h'
const toDipRect = r => IS_WIN ? screen.screenToDipRect(null, r) : r;
const toHelperPt = (x, y) => IS_WIN ? screen.dipToScreenPoint({ x, y }) : { x, y };
function ensureDivider(dir){
  if (divWins[dir]) return divWins[dir];
  const w = new BrowserWindow({
    width: DIV_W, height: DIV_W, frame: false, transparent: true, backgroundColor: '#00000000', resizable: false, movable: false,
    minimizable: false, maximizable: false, fullscreenable: false, focusable: false, hasShadow: false, skipTaskbar: true, show: false,
    alwaysOnTop: true, type: process.platform === 'darwin' ? 'panel' : undefined, thickFrame: false,
    webPreferences: SECURE('divider-preload.cjs'),
  });
  w.setAlwaysOnTop(true, 'screen-saver');
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  lockDown(w);
  w.loadFile(path.join(HERE, 'renderer', 'divider.html'), { query: { dir } });
  w.on('closed', () => { divWins[dir] = null; });
  return (divWins[dir] = w);
}
function placeDivider(d){
  const r = toDipRect(d.dir === 'v'
    ? { x: d.x - Math.round(DIV_W / 2), y: d.y, width: DIV_W, height: d.height }
    : { x: d.x, y: d.y - Math.round(DIV_W / 2), width: d.width, height: DIV_W });
  const w = ensureDivider(d.dir);
  w.setBounds({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) });
  if (!w.isVisible()) w.showInactive();
}
function syncDivider(){
  if (divDrag) return;   // 끄는 동안은 마우스를 따라간다
  const ds = session?.tileDividers() ?? [];
  for (const dir of ['v', 'h']){
    const d = ds.find(x => x.dir === dir);
    if (d) placeDivider(d); else divWins[dir]?.hide();
  }
}
async function dragDivider(dir, x, y, final){
  const d = session.tileDividers().find(z => z.dir === dir); if (!d){ divDrag = null; return; }
  const p = toHelperPt(x, y), a = d.area;
  divDrag = dir;
  let ratio;
  if (dir === 'v'){
    const hx = Math.min(a.x + a.width * 0.85, Math.max(a.x + a.width * 0.15, p.x));
    placeDivider({ ...d, x: hx }); ratio = (hx - a.x) / a.width;
  } else {
    const hy = Math.min(a.y + a.height * 0.85, Math.max(a.y + a.height * 0.15, p.y));
    placeDivider({ ...d, y: hy }); ratio = (hy - a.y) / a.height;
  }
  if (!final) return;
  try { await session.setTileRatio(ratio, dir); }
  finally { divDrag = null; syncDivider(); }
}
const divDir = e => (e.sender === divWins.v?.webContents ? 'v' : e.sender === divWins.h?.webContents ? 'h' : null);
ipcMain.on('divider:move', (e, x, y) => { const dir = divDir(e); if (dir && Number.isFinite(x) && Number.isFinite(y)) dragDivider(dir, x, y, false).catch(() => {}); });
ipcMain.on('divider:end', (e, x, y) => { const dir = divDir(e); if (dir && Number.isFinite(x) && Number.isFinite(y)) dragDivider(dir, x, y, true).catch(() => { divDrag = null; }); });

// ---------- 배치 저장 (lesson.json layouts) ----------
function editLayouts(root, fn){
  const d = new LessonDoc(root).load();
  d.data.layouts = fn(Array.isArray(d.data.layouts) ? d.data.layouts : []);
  d.save();
  if (doc?.root === root) doc.load();   // 준비 화면이 이 수업을 열고 있으면 바로 다시 읽어, 나중에 저장할 때 배치를 지우지 않게
  refreshSessionIfSame(root);
  prepPush();
}

// ---------- 자동 숨김 ----------
async function setAutoHide(v){
  session.autoHide = !!v;
  saveSettings({ autoHide: session.autoHide });
  // 자동 숨김과 "가려지는 창 비키기"는 함께 쓸 수 없다 → 자동 숨김을 켜면 비키기를 끈다 (선생님 요청, 2026-11-22).
  // 계속 비키기 타이머도 먼저 멈춰서, 돌려놓는 동안 창을 다시 옮기지 않게 한다
  const asideOff = session.autoHide && prefs.aside;
  if (asideOff){ prefs.aside = false; saveSettings({ aside: false }); }
  syncAsideWatch();
  clearInterval(cursorTimer);
  collapsed = session.autoHide;
  placeSidebar();
  if (session.autoHide) cursorTimer = setInterval(watchCursor, 120);
  if (session.autoHide){
    // 고정을 풀면 옆으로 옮겼던 창을 돌려놓는다 (자동 숨김 중에는 펼칠 때마다 창이 들썩이지 않게 옮기지 않음)
    const n = await session.restoreAside();
    session.say(`자동 숨김: 화면 왼쪽 끝에 마우스를 대면 나타납니다 (왼쪽 가운데 노란 막대)${asideOff ? " · '가려지는 창 비키기'를 껐습니다" : ''}${n ? ` · 옮겼던 창 ${n}개를 돌려놓았습니다` : ''}`);
  } else {
    const n = prefs.aside ? await session.stepAside() : 0;
    session.say(`사이드바를 화면 왼쪽에 고정했습니다${n ? ` · 가려지던 창 ${n}개를 오른쪽으로 옮겼습니다` : ''}`);
  }
  syncAsideWatch();
}

// ---------- 설정 ----------
function setOpacity(v){
  const n = Number(v);
  if (!OPACITY_STEPS.includes(n)) return;
  prefs.opacity = n;
  saveSettings({ opacity: n });
  push();
}

async function setAside(v){
  prefs.aside = ASIDE_OK && !!v;
  saveSettings({ aside: prefs.aside });
  syncAsideWatch();
  if (!prefs.aside){
    const n = await session.restoreAside();
    return session.say(`고정해 두어도 다른 창을 옮기지 않습니다${n ? ` · 옮겼던 창 ${n}개를 돌려놓았습니다` : ''}`);
  }
  if (session.autoHide){
    // 비키기는 고정해 둘 때만 동작하므로, 자동 숨김 중에 켜면 사이드바를 고정한다 (자동 숨김을 켜면 비키기가 꺼지는 것과 짝)
    await setAutoHide(false);
    return session.say("'가려지는 창 비키기'를 켜서 사이드바를 고정했습니다 (자동 숨김 끔) · 가려지는 창을 오른쪽으로 옮깁니다");
  }
  const n = await session.stepAside();
  const later = ASIDE_KEEP ? '고정해 둔 동안 새로 가려지는 창도 옮깁니다' : '고정해 둔 동안 새로 연 창은 옮기지 않습니다';
  session.say(n ? `가려지던 창 ${n}개를 사이드바 오른쪽으로 옮겼습니다 · 고정을 풀거나 이 설정을 끄면 돌려놓습니다` : `사이드바에 가려진 창이 없습니다 · ${later}`);
}

let lastCursor = null;
function watchCursor(){
  if (!win) return;
  const p = screen.getCursorScreenPoint();
  const prev = lastCursor;
  lastCursor = p;
  if (collapsed){
    const wa = teacherArea(), bar = barRect();
    // 손잡이는 작아도 교사 화면 왼쪽 끝 어디에 대든 나온다. 왼쪽에 다른 모니터(학생 화면)가 있으면 그 화면은 빼고
    const atEdge = p.y >= wa.y && p.y <= wa.y + wa.height && p.x >= wa.x && p.x <= wa.x + EDGE_W;
    // 학생 화면이 왼쪽에 있으면 마우스가 끝에서 멈추지 않고 넘어가므로, 막대 높이에서 왼쪽으로 넘어간 것도 "밀었다"로 본다
    // (넘어간 뒤의 높이는 보지 않는다: 배율이 다른 화면에서는 같은 높이도 화면 단위 값이 달라진다)
    const inBand = pt => pt.y >= bar.y - HOT_MARGIN && pt.y <= bar.y + bar.height + HOT_MARGIN;
    const pushedPast = prev && inBand(prev) && prev.x >= wa.x && p.x < wa.x;
    if (atEdge || pushedPast){ collapsed = false; outSince = 0; placeSidebar(); push(); }
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
    check: doc && lastCheck?.root === doc.root ? lastCheck : null,
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

// ---------- 사전 점검 (core/precheck.js가 판단, 여기서는 실제 확인 방법을 넣어 준다) ----------
let lastCheck = null;   // { root, at, rows, counts, summary }
async function readThrough(abs){
  // 끝까지 한 번 읽는다: 구글 드라이브 스트리밍 폴더면 이때 이 PC로 내려받아 수업 중에 바로 열린다
  const t0 = Date.now(); let bytes = 0;
  for await (const chunk of createReadStream(abs, { highWaterMark: 1 << 20 })) bytes += chunk.length;
  return { bytes, ms: Date.now() - t0 };
}
async function runCheck(root, { quiet = false } = {}){
  const lesson = loadLesson(root);
  await session.refreshDisplays();
  let trusted = true;
  try { trusted = (await helper.call('trusted')).trusted; } catch { trusted = false; }
  let freeBytes = null;
  try { const f = statfsSync(root); freeBytes = f.bavail * f.bsize; } catch { /* 모름 */ }
  const st = session.student;
  if (!quiet) note('사전 점검 중… 링크와 파일을 확인합니다');
  const r = await precheck(lesson, {
    apps: L.APPS, browser: L.pickBrowser(), appInstalled: L.appInstalled, readThrough,
    checkLink: (url, type) => checkLink(url, type, { fetchFn: (u, o) => net.fetch(u, o) }),
    screens: { count: session.displays?.length ?? 1, student: st ? { name: st.name, width: Math.round(st.width), height: Math.round(st.height) } : null },
    trusted, freeBytes, lockedBy: otherLock(root, DEVICE)?.device ?? null, cloud: cloudOf(root),
    onProgress: quiet ? undefined : (phase, n, total) => note(`사전 점검 중… ${phase} ${n}/${total}`),
  });
  lastCheck = { root, at: Date.now(), ...r };
  if (!quiet) note(`사전 점검: ${r.summary}`);
  return r;
}

const DEBUG = process.env.SIDEBAR_DEBUG === '1';   // 시험용 원격 조작: 꾸러미 저장·열기 창 대신 경로를 받는다
let busy = false;
/** 꾸러미처럼 오래 걸리는 일은 하나씩 (두 번 눌러도 겹치지 않게) */
async function oneAtATime(fn){
  if (busy) throw new Error('앞의 작업이 끝날 때까지 기다려 주세요');
  busy = true;
  try { return await fn(); } finally { busy = false; }
}

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
  // ---------- 사전 점검 ----------
  async precheck(){
    const d = needDoc();
    return oneAtATime(() => runCheck(d.root));
  },
  closeCheck(){ lastCheck = null; },

  // ---------- 수업 꾸러미(.zip) ----------
  async exportBundle(p){
    const d = needDoc();
    return oneAtATime(async () => {
      // 보내기 전에 "정리하기" (사이드바에서 열린 파일은 건너뜀)
      const open = new Set(session.lesson?.root === d.root ? [...session.state].filter(([, st]) => st.wid).map(([id]) => id) : []);
      const t = d.tidy(open); d.save(); refreshSessionIfSame(d.root);
      let file = DEBUG ? absPath(p.file) : null;
      if (!file){
        const r = await dialog.showSaveDialog(prepWin, { title: '수업 꾸러미 저장', defaultPath: path.join(app.getPath('desktop'), `${path.basename(d.root)}.zip`),
          filters: [{ name: '수업 꾸러미', extensions: ['zip'] }] });
        if (r.canceled || !r.filePath) return;
        file = /\.zip$/i.test(r.filePath) ? r.filePath : `${r.filePath}.zip`;
      }
      if (path.resolve(file).startsWith(d.root + path.sep)) throw new Error('꾸러미는 수업 폴더 밖에 저장해 주세요');
      note('꾸러미를 만드는 중…');
      const r = await exportBundle(d.root, file, { appVersion: app.getVersion() });
      note(`꾸러미를 만들었습니다: ${path.basename(file)} (파일 ${r.count}개, ${fmtBytes(r.bytes)})`
        + (t.skipped.length ? ` · 열린 파일 ${t.skipped.length}개는 이름 정리를 건너뜀` : '')
        + (r.needAccess.length ? ` · 구글 문서·캔바 링크 ${r.needAccess.length}개는 받는 분 계정에 열람 권한이 있어야 열립니다` : ''));
      if (!DEBUG) shell.showItemInFolder(file);
    });
  },
  async importBundle(p){
    const lib = libraryRoot(); if (!lib) throw new Error('먼저 수업 보관함 위치를 정해 주세요');
    return oneAtATime(async () => {
      let file = DEBUG ? absPath(p.file) : null;
      if (!file){
        const r = await dialog.showOpenDialog(prepWin, { title: '가져올 수업 꾸러미(.zip) 고르기', properties: ['openFile'], filters: [{ name: '수업 꾸러미', extensions: ['zip'] }] });
        if (r.canceled || !r.filePaths[0]) return;
        file = r.filePaths[0];
      }
      note('꾸러미를 살펴보는 중…');
      const info = await inspectBundle(file);
      const existing = findExisting(info, lib);
      let mode = 'copy';
      if (existing){
        const running = session.lesson?.root === existing;
        const lock = otherLock(existing, DEVICE);
        const modes = running ? ['copy', 'cancel'] : ['copy', 'overwrite', 'cancel'];
        const pick = DEBUG && modes.includes(p.mode) ? p.mode : modes[(await dialog.showMessageBox(prepWin, {
          type: 'question', title: '같은 수업이 있습니다', message: `'${info.lesson.title}' 수업이 보관함에 이미 있습니다.`,
          detail: [
            `가져올 꾸러미: ${path.basename(file)} · 파일 ${info.plan.length}개`,
            '사본으로 가져오면 따로 고치는 새 수업이 하나 더 생깁니다.',
            running ? '지금 사이드바에서 진행 중인 수업이라 덮어쓸 수 없습니다.' : '덮어쓰면 지금 수업 폴더는 보관함의 .sidebar/덮어쓰기 전 폴더로 옮겨 둡니다.',
            lock ? `주의: ${lock.device}에서 이 수업을 열고 있습니다.` : '',
          ].filter(Boolean).join('\n'),
          buttons: running ? ['사본으로 가져오기', '취소'] : ['사본으로 가져오기', '덮어쓰기', '취소'], defaultId: 0, cancelId: modes.length - 1,
        })).response];
        if (pick === 'cancel'){ note('꾸러미 가져오기를 취소했습니다'); return; }
        mode = pick;
      }
      note(`꾸러미를 푸는 중… (${fmtBytes(info.totalBytes)})`);
      if (mode === 'overwrite' && doc?.root === existing){ clearLock(existing, DEVICE); doc = null; }   // 푸는 동안 이 창이 저장하지 않게
      const r = await importBundle(info, lib, { mode, existing });
      openDoc(r.root);
      const c = await runCheck(r.root, { quiet: true });   // 가져오면 이 PC에 맞는지 바로 한 번 점검 (docs/PLAN.md 9.4)
      note(`'${info.lesson.title}' 수업을 가져왔습니다 (파일 ${r.count}개) · 사전 점검: ${c.summary}`
        + (r.backup ? ' · 예전 수업은 .sidebar/덮어쓰기 전에 있습니다' : '')
        + (r.skipped.length ? ` · ${r.skipped.length}개 뺌 (${r.skipped.map(x => `${x.name}: ${x.reason}`).join(', ')})` : '')
        + (r.damaged.length ? ` · 손상된 파일 ${r.damaged.length}개는 가져오지 못했습니다 (${r.damaged.join(', ')})` : ''));
    });
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
  closeTab: id => session.closeTab(id),
  toggleSel: id => session.toggleSel(id),
  split: v => session.split(v),
  relayout: v => session.relayout(v),
  applyLayout: v => session.applyLayout(v),
  saveLayout: () => {
    const t = session.tile, root = session.lesson?.root;
    if (!t || !root) return;
    const label = TILE_LAYOUTS[t.ids.length]?.find(l => l.id === t.layout)?.label ?? t.layout;
    const titles = t.ids.map(id => session.item(id)?.title ?? '').filter(Boolean);
    const round = a => a.map(v => Math.round(v * 1000) / 1000);
    const entry = { id: `lay_${randomBytes(4).toString('hex')}`, name: `${titles.join(' + ')} (${label})`.slice(0, 80), layout: t.layout, items: [...t.ids], c: round(t.c), r: round(t.r) };
    const same = l => l.layout === entry.layout && String(l.items) === String(entry.items);
    editLayouts(root, ls => [...ls.filter(l => !same(l)), entry].slice(-12));
    session.say(`이 배치를 수업에 저장했습니다: ${entry.name} · 아래 '저장한 배치'에서 한 번에 다시 놓을 수 있습니다`);
  },
  removeLayout: v => {
    const root = session.lesson?.root; if (!root) return;
    editLayouts(root, ls => ls.filter(l => l.id !== v));
    session.say('저장한 배치를 지웠습니다');
  },
  untile: () => session.untile(),
  openAll: () => session.openAll(),
  next: () => session.next(),
  hideOthers: () => session.hideOthers(),
  // 손쉬운 사용 설정 화면만 열어 준다 (켜는 것은 선생님이 직접)
  axSettings: () => shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'),
  closeAll: () => session.closeAll(),
  openTo: v => session.setOpenTo(v),
  autoHide: v => setAutoHide(v === true || v === 'true'),
  opacity: v => setOpacity(v),
  aside: v => setAside(v === true || v === 'true'),
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

ipcMain.handle('state', () => fullState());
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
      out = fullState();
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
app.on('second-instance', () => { if (!win) return; collapsed = false; placeSidebar(); win.showInactive(); push(); });

app.whenReady().then(async () => {
  if (!firstInstance) return;
  if (process.platform === 'darwin') app.dock?.hide();
  const h = makeHelper();
  helper = h.helper;
  if (!helper.available()){
    dialog.showErrorBox('수업 사이드바', app.isPackaged
      ? '창 관리 도우미가 앱 안에 없습니다. 수업 사이드바를 다시 설치해 주세요.'
      : `창 관리 도우미를 찾지 못했습니다.\n${h.where}\n(${h.fix})`);
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
  prefs = { opacity: OPACITY_STEPS.includes(settings.opacity) ? settings.opacity : 100, aside: ASIDE_OK && !!settings.aside };
  createSidebar();
  if (!(settings.lastFolder && existsSync(settings.lastFolder) && runLesson(settings.lastFolder))) runLesson(sampleLesson());
  if (settings.lastPrepFolder && existsSync(path.join(settings.lastPrepFolder, 'lesson.json'))){
    try { openDoc(settings.lastPrepFolder); } catch { doc = null; }
  }
  if (settings.autoHide) setAutoHide(true);

  // 설치판은 권한이 없으면 macOS의 권한 요청 창을 띄운다 (켜는 것은 선생님이 직접)
  const trusted = (await helper.call('trusted', ...(app.isPackaged ? ['--prompt'] : []))).trusted;
  if (trusted) await session.relink();
  else session.say(NO_TRUST);
  session.trusted = trusted;
  watchTrust();
  helper.startWatch();
  // 고정한 채로 켜면 가려지는 창을 옆으로 (설정을 켰을 때만)
  if (trusted && prefs.aside && !session.autoHide){
    const n = await session.stepAside();
    if (n) session.say(`가려지던 창 ${n}개를 사이드바 오른쪽으로 옮겼습니다 · 끝내거나 자동 숨김으로 바꾸면 돌려놓습니다`);
  }
  if (trusted) syncAsideWatch();

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
let restoringOnQuit = false;
app.on('before-quit', e => {
  clearInterval(asideTimer);
  // 끝낼 때 옆으로 옮겼던 창을 먼저 돌려놓는다 (오래 걸려도 5초까지만 기다림)
  if (session?.aside?.length && !restoringOnQuit){
    e.preventDefault();
    restoringOnQuit = true;
    Promise.race([session.restoreAside(), new Promise(r => setTimeout(r, 5000))]).finally(() => app.quit());
    return;
  }
  for (const root of new Set([doc?.root, session?.lesson?.root].filter(Boolean))) clearLock(root, DEVICE);
  helper?.stop(); files?.close(); clearInterval(cursorTimer);
});
