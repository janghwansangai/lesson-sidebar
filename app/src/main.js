// 수업 사이드바 체험판 — Electron 시작점 (맥·윈도우)
// 사이드바 창(교사 화면 왼쪽)과 수업 준비 창을 띄우고, 수업 진행 로직(Session)·수업 편집(LessonDoc)과 잇는다.
import { app, BrowserWindow, ipcMain, screen, dialog, shell, net, globalShortcut, desktopCapturer, systemPreferences } from 'electron';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, cpSync, createReadStream, statfsSync, openSync, writeSync, closeSync, renameSync, copyFileSync, unlinkSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Helper } from './core/helper.js';
import { SHORTCUTS, accelerator, keyLabel } from './core/shortcuts.js';
import { loadLesson } from './core/lesson.js';
import { startFileServer } from './core/fileserver.js';
import { Session, TILE_LAYOUTS } from './core/session.js';
import { LessonDoc } from './core/editor.js';
import { listLessons, suggestRoots, LIB_NAME } from './core/library.js';
import { writeLock, clearLock, otherLock, deviceName } from './core/lock.js';
import { exportBundle, inspectBundle, importBundle, findExisting, fmtBytes } from './core/bundle.js';
import { precheck, checkLink, cloudOf } from './core/precheck.js';
import { Chapters, clock } from './core/chapters.js';
import { duplicateLesson, guideHtml, findConflicts, resolveConflict } from './core/reuse.js';
import { Timing, liveView, memoFor, lanAddress } from './core/live.js';
import { LiveServer } from './core/liveserver.js';
import { checkUpdate, isReleaseUrl } from './core/update.js';
import qrcode from 'qrcode-generator';
import { safeName } from './core/types.js';
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
// 고정해 둔 동안 2초마다 살펴 새로 가려진 창도 비킨다 (선생님 요청, docs/poc/mac.md 31). 윈도우도 같은 기대라 켬 (docs/poc/windows.md "맥 기능 윈도우 확인")
const ASIDE_KEEP = ASIDE_OK;
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

const fullState = () => ({ ...session.snapshot(), collapsed, trusted: session.trusted !== false, tools: { pointer: tools.pointer, spot: tools.spot, pen: tools.pen, grab: grab?.mode ?? null, pins: pins.size }, cover: cover.mode, preview: previewOn && screenAccess() === 'granted', rec: rec ? { since: rec.startedAt, mic: !!rec.mic, sys: !!rec.sys, stopping: !!rec.stopping, where: rec.where } : null, prefs: { ...prefs, steps: OPACITY_STEPS, asideAvailable: ASIDE_OK, keys: SHORTCUTS.map(s => ({ key: keyLabel(s), label: s.label })) }, update: update && !update.dismissed ? { version: update.version, notes: update.notes, size: update.size } : null, version: app.getVersion(), presenter: !!presWin, remote: remote ? { url: remote.url, qr: remote.qr, showQr: remote.showQr, phones: liveSrv.clients('lan') } : null });
function push(){ noteChapter(); syncInk(); win?.webContents.send('state', fullState()); syncDivider(); syncPreview(); syncLive(); }

// ---------- 나란히 보기 조절 바 ----------
// 나란히 놓은 창의 경계에 가는 막대 창을 띄운다: 세로 경계(v) 하나 + 큰 화면+2·4분할이면 가로 경계(h) 하나.
// 끄는 동안에는 막대만 마우스를 따라가고, 놓을 때 창들을 한 번에 옮긴다.
// (PPT·엑셀은 한 번 옮기는 데 0.5초 넘게 걸려, 끄는 동안 계속 옮기면 창이 3초 넘게 늦게 따라왔다 — docs/poc/mac.md 36)
// 도우미 좌표: 맥은 Electron과 같은 포인트, 윈도우는 물리 픽셀 → DIP로 바꿔서 창을 놓는다.
const DIV_W = 16;
const divWins = { v: null, v2: null, h: null };
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
  w.loadFile(path.join(HERE, 'renderer', 'divider.html'), { query: { dir: dir === 'v2' ? 'v' : dir } });   // v2(3분할 두 번째)도 세로 막대
  w.on('closed', () => { divWins[dir] = null; });
  return (divWins[dir] = w);
}
function placeDivider(d){
  const r = toDipRect(d.dir !== 'h'
    ? { x: d.x - Math.round(DIV_W / 2), y: d.y, width: DIV_W, height: d.height }
    : { x: d.x, y: d.y - Math.round(DIV_W / 2), width: d.width, height: DIV_W });
  const w = ensureDivider(d.dir);
  const want = { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  w.setBounds(want);
  // 윈도우는 창이 32픽셀보다 좁아지지 않는다 (docs/poc/windows.md 체험판 6). 넓어졌으면 경계에 가운데를 맞추고,
  // 누르는 자리는 가운데 DIV_W만 남긴다 (바깥은 그리지 않는 투명 부분이라 창 모양으로 잘라도 보이는 것은 같다)
  const got = w.getBounds();
  if (got.width > want.width || got.height > want.height){
    const dx = Math.round((got.width - want.width) / 2), dy = Math.round((got.height - want.height) / 2);
    w.setBounds({ x: want.x - dx, y: want.y - dy, width: got.width, height: got.height });
    if (IS_WIN) w.setShape([{ x: dx, y: dy, width: want.width, height: want.height }]);
  }
  if (!w.isVisible()) w.showInactive();
}
function syncDivider(){
  if (divDrag) return;   // 끄는 동안은 마우스를 따라간다
  const ds = session?.tileDividers() ?? [];
  for (const dir of ['v', 'v2', 'h']){
    const d = ds.find(x => x.dir === dir);
    if (d) placeDivider(d); else divWins[dir]?.hide();
  }
}
async function dragDivider(dir, x, y, final){
  const d = session.tileDividers().find(z => z.dir === dir); if (!d){ divDrag = null; return; }
  const p = toHelperPt(x, y), a = d.area;
  divDrag = dir;
  let ratio;
  if (dir !== 'h'){
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
const divDir = e => ['v', 'v2', 'h'].find(k => divWins[k] && !divWins[k].isDestroyed() && e.sender === divWins[k].webContents) ?? null;
ipcMain.on('divider:move', (e, x, y) => { const dir = divDir(e); if (dir && Number.isFinite(x) && Number.isFinite(y)) dragDivider(dir, x, y, false).catch(() => {}); });
ipcMain.on('divider:end', (e, x, y) => { const dir = divDir(e); if (dir && Number.isFinite(x) && Number.isFinite(y)) dragDivider(dir, x, y, true).catch(() => { divDrag = null; }); });

// ---------- 발표 도구: 포인터 강조·스포트라이트 (docs/PLAN.md 7) ----------
// 화면마다 화면 전체를 덮는 투명 겹침 창 하나. 슬라이드 쇼·전체 화면 위에도 보이게 'screen-saver' 높이 (기술 검증 항목 4).
// 사이드바는 그보다 한 칸 위에 두어 도구를 켠 채로도 사이드바를 누를 수 있다.
// - 포인터: 겹침 창이 마우스를 통과시켜 클릭은 아래 프로그램으로 간다
// - 스포트라이트: 겹침 창이 마우스를 받아 휠로 크기를 바꾼다. Esc(이때만 등록)·두 번 누르기·사이드바 단추로 끈다
// - 판서 펜: 겹침 창이 마우스(·터치·펜)를 받아 그린다. 색·굵기·형광펜·지우개는 겹침 창 아래 도구 막대에서. 끄면(Esc·✕·사이드바) 지워진다
// - 클릭 물결: 포인터 강조를 켠 동안 도우미 'clicks'로 누른 자리를 받아 물결을 그린다 (클릭은 원래대로 아래 프로그램에)
const tools = { pointer: false, spot: false, pen: false, r: 150, ink: { color: '#e5484d', size: 4, mode: 'pen' } };
let inkFor = null;   // 판서를 그린 자료 — 사이드바에서 다른 자료로 넘어가면 판서를 지운다
const overlays = new Map();   // display.id → BrowserWindow
let toolTimer = null, lastCur = null;
function overlayFor(d){
  let w = overlays.get(d.id);
  if (!w || w.isDestroyed()){
    w = new BrowserWindow({
      ...d.bounds, frame: false, transparent: true, backgroundColor: '#00000000', resizable: false, movable: false,
      minimizable: false, maximizable: false, fullscreenable: false, focusable: false, hasShadow: false, skipTaskbar: true, show: false,
      alwaysOnTop: true, type: process.platform === 'darwin' ? 'panel' : undefined, thickFrame: false, enableLargerThanScreen: true,
      webPreferences: SECURE('overlay-preload.cjs'),
    });
    w.setAlwaysOnTop(true, 'screen-saver');
    w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    lockDown(w);
    w.loadFile(path.join(HERE, 'renderer', 'overlay.html'));
    // 다 읽히면 상태를 보내고, 커서도 다시 보낸다 (읽히기 전에 보낸 위치는 버려져서, 마우스를 움직이기 전까지 원이 안 보였다)
    w.webContents.on('did-finish-load', () => {
      w.webContents.send('overlay:state', { ...tools, grab: grab && grab.display.id === d.id ? grab.payload : null });
      lastCur = null;
    });
    overlays.set(d.id, w);
  }
  w.setBounds(d.bounds);
  return w;
}
function syncTools(){
  const on = tools.pointer || tools.spot || tools.pen;
  const grabsMouse = tools.spot || tools.pen;
  clearInterval(toolTimer); toolTimer = null;
  syncClicks();
  if (!on){
    for (const w of overlays.values()) if (!w.isDestroyed()){ w.webContents.send('overlay:state', tools); w.hide(); }   // 끈 것을 알려 판서도 지운다
    globalShortcut.unregister('Escape');
    push();
    return;
  }
  for (const d of screen.getAllDisplays()){
    const w = overlayFor(d);
    w.setIgnoreMouseEvents(!grabsMouse, { forward: true });   // 스포트라이트(휠)·판서 펜만 마우스를 받는다
    w.webContents.send('overlay:state', tools);
    if (!w.isVisible()) w.showInactive();
  }
  // 사이드바·조절 바는 겹침 창보다 위에
  win?.setAlwaysOnTop(true, 'screen-saver', 1);
  for (const dw of Object.values(divWins)) dw?.setAlwaysOnTop(true, 'screen-saver', 1);
  if (grabsMouse && !globalShortcut.isRegistered('Escape')) globalShortcut.register('Escape', () => setTool(tools.pen ? 'pen' : 'spot', false));
  if (!grabsMouse) globalShortcut.unregister('Escape');
  if (tools.pen && inkFor === null) inkFor = session.highlight ?? '';
  if (!tools.pen) inkFor = null;
  lastCur = null;
  toolTimer = setInterval(sendCursor, 16);
  push();
}
function sendCursor(){
  const p = screen.getCursorScreenPoint();
  if (lastCur && lastCur.x === p.x && lastCur.y === p.y) return;
  lastCur = p;
  for (const d of screen.getAllDisplays()){
    const w = overlays.get(d.id); if (!w || w.isDestroyed()) continue;
    const b = d.bounds, inside = p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
    w.webContents.send('overlay:cursor', { x: p.x - b.x, y: p.y - b.y, in: inside });
  }
}
const ONE_OF = ['pointer', 'spot', 'pen'];   // 셋 중 하나만
function setTool(name, v){
  if (!ONE_OF.includes(name)) return;
  tools[name] = !!v;
  if (tools[name]) for (const o of ONE_OF) if (o !== name) tools[o] = false;
  syncTools();
  session.say(tools.spot ? '스포트라이트: 커서 주변만 밝게 · 휠로 크기 · Esc나 두 번 눌러 끕니다'
    : tools.pointer ? '포인터 강조: 커서 주변에 노란 원, 누르면 물결 · 클릭은 그대로 아래 프로그램에 갑니다'
    : tools.pen ? '판서 펜: 화면 위에 그립니다 · 아래 막대에서 색·형광펜·지우개 · Esc나 ✕로 끄면 지워집니다 (저장은 막대의 "저장")'
    : '발표 도구를 껐습니다');
}
// 클릭 물결: 포인터 강조를 켠 동안만 도우미가 클릭 자리를 알린다 (도우미가 'clicks'를 모르면 물결 없이 원만)
function syncClicks(){
  if (!helper) return;
  if (!tools.pointer) return helper.stopClicks();
  helper.startClicks(m => {
    const p = IS_WIN ? screen.screenToDipPoint({ x: m.x, y: m.y }) : { x: m.x, y: m.y };   // 윈도우 도우미는 물리 픽셀
    for (const d of screen.getAllDisplays()){
      const b = d.bounds;
      if (p.x < b.x || p.x >= b.x + b.width || p.y < b.y || p.y >= b.y + b.height) continue;
      const w = overlays.get(d.id);
      if (w && !w.isDestroyed()) w.webContents.send('overlay:click', { x: p.x - b.x, y: p.y - b.y, button: m.button === 'right' ? 'right' : 'left' });
    }
  });
}
// 사이드바에서 다른 자료로 넘어가면 판서를 지운다 (지난 자료 위에 그린 것이 새 자료에 남지 않게)
function syncInk(){
  if (!tools.pen) return;
  const now = session.highlight ?? '';
  if (inkFor === now) return;
  inkFor = now;
  for (const w of overlays.values()) if (!w.isDestroyed()) w.webContents.send('overlay:clear');
}
ipcMain.on('overlay:ink', (e, ink) => {
  if (!fromOverlay(e) || !ink || typeof ink !== 'object') return;
  const color = /^#[0-9a-f]{6}$/i.test(ink.color) ? ink.color : tools.ink.color;
  const size = [2, 4, 8].includes(Number(ink.size)) ? Number(ink.size) : tools.ink.size;
  const mode = ['pen', 'marker', 'eraser'].includes(ink.mode) ? ink.mode : tools.ink.mode;
  tools.ink = { color, size, mode };
  for (const w of overlays.values()) if (!w.isDestroyed()) w.webContents.send('overlay:state', { ink: tools.ink });
});
ipcMain.on('overlay:off', e => { if (fromOverlay(e)) setTool('pen', false); });
// 판서 저장: 겹침 창이 도구 막대를 감춘 뒤 부르면, 판서가 보이는 그대로 그 화면을 찍어 수업 폴더 _캡처/에 저장
ipcMain.on('overlay:save', async e => {
  if (!fromOverlay(e)) return;
  const id = [...overlays].find(([, w]) => !w.isDestroyed() && w.webContents === e.sender)?.[0];
  const d = screen.getAllDisplays().find(x => x.id === id);
  let name = null;
  if (d && screenAccess() === 'granted'){
    const img = await captureDisplay(d).catch(() => null);
    if (img && !img.isEmpty()) name = savePin(img, '판서');
  }
  if (!e.sender.isDestroyed()) e.sender.send('overlay:saved', !!name);
  if (screenAccess() !== 'granted') session.say(SCREEN_PERM, { act: 'screenSettings', label: '화면 기록 설정 열기' });
  else session.say(name ? `판서를 저장했습니다 · 수업 폴더 _캡처/${name}` : '판서를 저장하지 못했습니다');
});
// ---------- 확대·캡처 핀 (화면을 찍어서 쓰는 도구 — 맥은 "화면 기록" 권한 필요) ----------
// 커서가 있는 화면을 찍어 그 화면의 겹침 창에 멈춘 그림으로 보여 준다.
// - 확대: 커서 둘레를 2배(휠로 1.5~4배)로, 클릭·Esc로 끝
// - 캡처 핀: 끌어서 영역을 고르면 그 부분을 항상 위 작은 창(핀)으로 고정하고 수업 폴더 _캡처/에 저장
let grab = null;   // { mode: 'zoom'|'pick', display, image }
const pins = new Set();
const screenAccess = () => process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') : 'granted';
const SCREEN_PERM = "화면 기록 권한이 필요합니다. 시스템 설정 → 개인정보 보호 및 보안 → 화면 및 시스템 오디오 기록에서 '수업 사이드바'를 켠 뒤, 사이드바를 끝내고 다시 켜 주세요";
async function captureDisplay(d){
  const sf = d.scaleFactor || 1;
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(d.bounds.width * sf), height: Math.round(d.bounds.height * sf) } });
  return (sources.find(x => String(x.display_id) === String(d.id)) ?? sources[0])?.thumbnail ?? null;
}
async function startGrab(mode){
  if (grab) return endGrab();
  if (screenAccess() !== 'granted'){
    try { await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } }); } catch { /* 맥이 권한을 묻게 한 번 불러 본다 */ }
    session.say(SCREEN_PERM, { act: 'screenSettings', label: '화면 기록 설정 열기' });
    return;
  }
  tools.pointer = false; tools.spot = false; tools.pen = false; syncTools();
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  for (const w of overlays.values()) if (!w.isDestroyed()) w.hide();
  await new Promise(r => setTimeout(r, 120));   // 겹침 창이 사라진 뒤에 찍는다
  const image = await captureDisplay(d).catch(() => null);
  if (!image || image.isEmpty()) return session.say('화면을 찍지 못했습니다');
  grab = { mode, display: d, image, payload: { mode, src: image.toDataURL() } };
  const w = overlayFor(d);   // 처음 만드는 겹침 창이면 다 읽힌 뒤(did-finish-load) 그림을 다시 보낸다
  w.setIgnoreMouseEvents(false);
  w.webContents.send('overlay:state', { pointer: false, spot: false, pen: false, grab: grab.payload });
  w.showInactive();
  win?.setAlwaysOnTop(true, 'screen-saver', 1);
  if (!globalShortcut.isRegistered('Escape')) globalShortcut.register('Escape', () => endGrab());
  push();
  session.say(mode === 'zoom' ? '확대: 마우스로 옮기고 휠로 배율(1.5~4배) · 클릭이나 Esc로 끝' : '캡처 핀: 끌어서 영역을 고르세요 · Esc로 취소');
}
function endGrab(){
  if (!grab) return;
  const w = overlays.get(grab.display.id);
  grab = null;
  if (w && !w.isDestroyed()){ w.webContents.send('overlay:state', { grab: null }); w.hide(); }
  globalShortcut.unregister('Escape');
  syncTools();
}
function savePin(img, prefix = ''){
  const root = session.lesson?.root ?? app.getPath('userData');
  const dir = path.join(root, '_캡처');
  const t = new Date(), p2 = n => String(n).padStart(2, '0');
  const name = `${prefix ? `${prefix}_` : ''}${t.getFullYear()}-${p2(t.getMonth() + 1)}-${p2(t.getDate())}_${p2(t.getHours())}${p2(t.getMinutes())}${p2(t.getSeconds())}.png`;
  try { mkdirSync(dir, { recursive: true }); writeFileSync(path.join(dir, name), img.toPNG()); return name; } catch { return null; }
}
function makePin(img, r){
  const pin = new BrowserWindow({
    x: Math.round(r.x), y: Math.round(r.y), width: Math.max(80, Math.round(r.width)), height: Math.max(60, Math.round(r.height)),
    frame: false, resizable: true, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, show: false,
    alwaysOnTop: true, hasShadow: true, backgroundColor: '#1b2f2a', type: process.platform === 'darwin' ? 'panel' : undefined,
    webPreferences: SECURE('pin-preload.cjs'),
  });
  pin.setAlwaysOnTop(true, 'screen-saver');
  pin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  pin.setAspectRatio(r.width / r.height);
  lockDown(pin);
  pin.loadFile(path.join(HERE, 'renderer', 'pin.html'));
  pin.webContents.on('did-finish-load', () => { pin.webContents.send('pin:image', img.toDataURL()); pin.showInactive(); });
  pin.on('closed', () => { pins.delete(pin); push(); });
  pins.add(pin);
  push();
}
ipcMain.on('overlay:pick', (e, rect) => {
  if (!fromOverlay(e) || grab?.mode !== 'pick' || !rect) return;
  const { display: d, image } = grab;
  const sf = image.getSize().width / d.bounds.width;
  const r = { x: Math.max(0, Number(rect.x)), y: Math.max(0, Number(rect.y)), width: Number(rect.width), height: Number(rect.height) };
  endGrab();
  if (!(r.width >= 8 && r.height >= 8)) return session.say('캡처를 취소했습니다');
  const img = image.crop({ x: Math.round(r.x * sf), y: Math.round(r.y * sf), width: Math.round(r.width * sf), height: Math.round(r.height * sf) });
  makePin(img, { x: d.bounds.x + r.x, y: d.bounds.y + r.y, width: r.width, height: r.height });
  const saved = savePin(img);
  session.say(`캡처를 화면에 고정했습니다 · 끌어서 옮기고 ✕로 닫습니다${saved ? ` · 수업 폴더 _캡처/${saved}에 저장` : ''}`);
});
ipcMain.on('overlay:end', e => { if (fromOverlay(e)) endGrab(); });
ipcMain.on('pin:close', e => { for (const p of pins) if (p.webContents === e.sender) p.close(); });

// ---------- 학생 화면 관리: 미리보기·정지·가리기 (docs/PLAN.md 6.3) ----------
// 가림 창은 학생 화면 전체를 덮는다 (모니터 한 대면 그 화면 — 가리기만). 화면 찍기에서 빠지게(setContentProtection) 해서
// 미리보기·확대·캡처 핀에는 가림 창 뒤의 실제 화면이 보인다 ("정지 중에도 미리보기에는 실제 상태").
// 미리보기는 듀얼일 때 0.5초마다 작게 찍어 사이드바에 보낸다 (저장하지 않음).
const cover = { mode: null };   // 'freeze' | 'blank' | null
let coverWin = null, previewTimer = null, previewOn = true;
function studentElectronDisplay(){
  const st = session?.student;
  if (!st) return null;
  return screen.getDisplayMatching(toDipRect({ x: st.x, y: st.y, width: st.width, height: st.height }));
}
function coverDisplay(){ return studentElectronDisplay() ?? screen.getPrimaryDisplay(); }
function ensureCover(d){
  if (!coverWin || coverWin.isDestroyed()){
    coverWin = new BrowserWindow({
      ...d.bounds, frame: false, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
      focusable: false, hasShadow: false, skipTaskbar: true, show: false, backgroundColor: '#000000', enableLargerThanScreen: true,
      alwaysOnTop: true, type: process.platform === 'darwin' ? 'panel' : undefined, thickFrame: false,
      webPreferences: SECURE('cover-preload.cjs'),
    });
    coverWin.setAlwaysOnTop(true, 'screen-saver');
    coverWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    coverWin.setContentProtection(true);   // 화면 찍기(미리보기·확대·핀·녹화)에서 빠진다
    lockDown(coverWin);
    coverWin.loadFile(path.join(HERE, 'renderer', 'cover.html'));
    coverWin.webContents.on('did-finish-load', () => coverWin?.webContents.send('cover:state', cover.payload ?? null));
  }
  coverWin.setBounds(d.bounds);
  return coverWin;
}
async function setCover(mode){
  if (!mode || cover.mode === mode){
    cover.mode = null; cover.payload = null;
    coverWin?.hide();
    session.say(session.dual ? '학생 화면을 다시 보여 줍니다' : '화면을 다시 보여 줍니다');
    return push();
  }
  if (mode === 'freeze'){
    if (!session.dual) return session.say('정지는 학생 화면(두 번째 모니터)이 있을 때 씁니다');
    if (screenAccess() !== 'granted') return session.say(SCREEN_PERM, { act: 'screenSettings', label: '화면 기록 설정 열기' });
    const d = coverDisplay();
    const img = await captureDisplay(d).catch(() => null);
    if (!img || img.isEmpty()) return session.say('학생 화면을 찍지 못했습니다');
    cover.payload = { mode, src: img.toJPEG(90).toString('base64') };
  } else cover.payload = { mode };
  cover.mode = mode;
  const w = ensureCover(coverDisplay());
  w.webContents.send('cover:state', cover.payload);
  w.showInactive();
  // 사이드바·조절 바·발표 도구는 가림 창보다 위
  win?.setAlwaysOnTop(true, 'screen-saver', 1);
  for (const o of overlays.values()) if (!o.isDestroyed() && o.isVisible()) o.moveTop();
  session.say(mode === 'freeze' ? '학생 화면을 지금 장면으로 멈췄습니다 · 그동안 창을 정리해도 학생에게는 보이지 않습니다 · 다시 누르면 풀립니다'
    : session.dual ? "학생 화면을 가렸습니다 ('잠시 후 계속합니다') · 다시 누르면 보입니다" : "화면을 가렸습니다 ('잠시 후 계속합니다') · 사이드바의 '화면 가리기'를 다시 누르면 보입니다");
  push();
}
async function composeStudent(bg){
  const st = session.student;
  let wins = [];
  try { wins = (await helper.call('list')).windows; } catch { return bg; }
  wins = wins.filter(w => w.display === st.index && !w.minimized && w.pid !== process.pid).sort((a, b) => (b.z ?? 0) - (a.z ?? 0));   // 뒤에서 앞으로
  if (!wins.length) return { bg, w: st.width, h: st.height, wins: [] };
  const srcs = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 480, height: 480 } });
  const byWid = new Map(srcs.map(x => [Number(String(x.id).split(':')[1]), x]));
  return { bg, w: st.width, h: st.height, wins: wins.map(w => ({ x: w.x - st.x, y: w.y - st.y, width: w.width, height: w.height, src: byWid.get(w.wid)?.thumbnail.toDataURL() })).filter(x => x.src) };
}
function syncPreview(){
  const want = previewOn && session?.dual && screenAccess() === 'granted' && !!win;
  if (!want){ clearInterval(previewTimer); previewTimer = null; win?.webContents.send('preview', null); return; }
  if (previewTimer) return;
  let busy = false;
  previewTimer = setInterval(async () => {
    if (busy || collapsed) return;
    busy = true;
    try {
      const d = studentElectronDisplay(); if (!d) return;
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 264, height: Math.round(264 * d.bounds.height / d.bounds.width) } });
      const src = sources.find(x => String(x.display_id) === String(d.id));
      if (!src) return;
      if (cover.mode === 'freeze' && process.platform === 'darwin'){
        // 맥은 가림 창 아래 창들이 화면 찍기에서 빠진다(가려진 것으로 봄). 창을 하나씩 찍어 앞뒤 순서대로 쌓아 실제 상태를 보인다 (mac.md 41)
        return win?.webContents.send('preview', await composeStudent(src.thumbnail.toDataURL()));
      }
      win?.webContents.send('preview', src.thumbnail.toDataURL());
    } catch { /* 다음에 다시 */ } finally { busy = false; }
  }, 500);
}

// ---------- 화면 녹화 + 목차 (docs/PLAN.md 8) ----------
// 녹화 창(보이지 않음)이 학생 화면(없으면 이 화면)을 MP4로 2초마다 조각내 보내고, 메인이 이 PC 임시 폴더에 바로 이어 쓴다.
// 끝내면 수업 폴더 _녹화/로 옮기고 목차(.txt)를 함께 둔다. 앱이 갑자기 꺼지면 다음에 켤 때 임시 파일을 _녹화/로 옮긴다(복구).
// 앞에 띄운 자료가 바뀔 때마다 목차에 남긴다. 남은 공간이 2GB 아래면 시작하지 않고, 녹화 중 1GB 아래로 내려가면 멈춘다.
let rec = null;   // { fd, file, meta, recWin, startedAt, chapters, lastHi, spaceTimer, stopping }
const recDir = () => path.join(app.getPath('userData'), 'recording');
const freeAt = p => { try { const f = statfsSync(p); return f.bavail * f.bsize; } catch { return null; } };
const stamp = (d = new Date()) => { const p2 = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}`; };
function recordTarget(){
  const root = session.lesson?.root ?? null;
  return { root, title: session.lesson?.title ?? '녹화' };
}
async function startRecording(){
  if (rec) return stopRecording();
  if (screenAccess() !== 'granted') return session.say(SCREEN_PERM, { act: 'screenSettings', label: '화면 기록 설정 열기' });
  const { root, title } = recordTarget();
  const free = freeAt(root ?? app.getPath('userData'));
  if (free != null && free < 2 * 1024 ** 3) return session.say(`남은 공간이 ${fmtBytes(free)}뿐이라 녹화를 시작하지 않았습니다 (2GB 이상 필요 · 1시간에 약 1.5GB)`);
  // 녹화할 화면: 학생 화면(기본, 모니터 한 대면 이 화면) 또는 교사 화면(사이드바가 있는 화면 — 진행 과정을 남길 때)
  const teacherDisp = win && !win.isDestroyed() ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay();
  const d = prefs.recScreen === 'teacher' ? teacherDisp : (studentElectronDisplay() ?? screen.getPrimaryDisplay());
  const src = (await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } })).find(x => String(x.display_id) === String(d.id));
  if (!src) return session.say('녹화할 화면을 찾지 못했습니다');
  mkdirSync(recDir(), { recursive: true });
  const name = `${stamp()}_${safeName(title, 40)}`;
  const file = path.join(recDir(), `${name}.mp4`);
  const meta = path.join(recDir(), `${name}.json`);
  const startedAt = Date.now();
  rec = { fd: openSync(file, 'w'), file, meta, name, root, title, startedAt, chapters: new Chapters(startedAt), lastHi: null, where: !session.dual ? '이 화면' : prefs.recScreen === 'teacher' ? '교사 화면' : '학생 화면' };
  writeFileSync(meta, JSON.stringify({ root, title, name, chapters: rec.chapters }));
  noteChapter();
  rec.recWin = new BrowserWindow({ show: false, webPreferences: SECURE('recorder-preload.cjs') });
  lockDown(rec.recWin);
  await rec.recWin.loadFile(path.join(HERE, 'renderer', 'recorder.html'));
  // 컴퓨터 소리: 녹화 창이 getDisplayMedia로 소리만 받는다 (이 창의 요청에만 같은 화면 + 'loopback'을 준다)
  const recWc = rec.recWin.webContents;
  recWc.session.setDisplayMediaRequestHandler((req, cb) => {
    if (!rec?.recWin || rec.recWin.isDestroyed() || req.frame?.top !== rec.recWin.webContents.mainFrame) return cb({});
    cb({ video: src, audio: 'loopback' });
  });
  recWc.send('rec:start', { sourceId: src.id, mic: prefs.recMic !== false, sys: prefs.recSys !== false, light: !!prefs.recLight });
  rec.spaceTimer = setInterval(() => {
    const f = freeAt(recDir());
    if (f != null && f < 1024 ** 3){ session.say(`남은 공간이 ${fmtBytes(f)}라 녹화를 멈춥니다`); stopRecording(); }
  }, 60000);
  push();
}
/** 앞에 띄운 자료가 바뀌면 목차에 남긴다 (session 'change'마다 불림) */
function noteChapter(){
  if (!rec) return;
  const id = session.highlight;
  if (!id || id === rec.lastHi) return;
  rec.lastHi = id;
  rec.chapters.add(session.item(id)?.title, Date.now());
  try { writeFileSync(rec.meta, JSON.stringify({ root: rec.root, title: rec.title, name: rec.name, chapters: rec.chapters })); } catch { /* 다음에 */ }
}
function stopRecording(){
  if (!rec || rec.stopping) return;
  rec.stopping = true;
  clearInterval(rec.spaceTimer);
  session.say('녹화를 마무리하는 중…');
  rec.recWin?.webContents.send('rec:stop');
  setTimeout(() => { if (rec?.stopping) finishRecording(); }, 8000);   // 녹화 창이 답하지 않아도 마무리
}
/** 임시 파일을 수업 폴더 _녹화/로 옮기고 목차를 쓴다. 복구할 때도 쓴다 */
function moveRecording(file, meta, recovered = false){
  let m = {};
  try { m = JSON.parse(readFileSync(meta, 'utf8')); } catch { /* 목차 없이 */ }
  const root = m.root && existsSync(m.root) ? m.root : app.getPath('desktop');
  const dir = path.join(root, '_녹화');
  mkdirSync(dir, { recursive: true });
  const base = `${m.name ?? path.basename(file, '.mp4')}${recovered ? '_복구' : ''}`;
  let dest = path.join(dir, `${base}.mp4`);
  for (let i = 2; existsSync(dest); i++) dest = path.join(dir, `${base}_${i}.mp4`);
  try { renameSync(file, dest); } catch { copyFileSync(file, dest); unlinkSync(file); }
  const ch = Chapters.from(m.chapters);
  if (ch.list.length) writeFileSync(dest.replace(/\.mp4$/, '_목차.txt'), ch.text(`${m.title ?? ''} 녹화 목차`));
  try { unlinkSync(meta); } catch { /* 없음 */ }
  return dest;
}
function finishRecording(){
  if (!rec) return;
  const r = rec; rec = null;
  try { closeSync(r.fd); } catch { /* 이미 닫힘 */ }
  r.recWin?.destroy();
  let dest = null;
  try { dest = statSync(r.file).size > 0 ? moveRecording(r.file, r.meta) : null; } catch (e){ session.say(`녹화 파일을 옮기지 못했습니다 (${e.message}) · ${r.file}`); }
  if (!dest){ try { unlinkSync(r.file); unlinkSync(r.meta); } catch { /* 없음 */ } }
  const len = clock(Date.now() - r.startedAt);
  if (dest) session.say(`녹화를 저장했습니다 (${len} · ${fmtBytes(statSync(dest).size)}) · ${r.root ? '수업 폴더' : '바탕화면'} _녹화/${path.basename(dest)}${r.chapters.list.length ? ' · 목차 함께' : ''}`, { act: 'revealRec', id: dest, label: '녹화 폴더 열기' });
  else session.say('녹화된 내용이 없어 저장하지 않았습니다');
  push();
}
/** 앱이 갑자기 꺼져 남은 녹화를 다음에 켤 때 _녹화/로 옮긴다 */
function recoverRecordings(){
  let names = [];
  try { names = readdirSync(recDir()).filter(n => n.endsWith('.mp4')); } catch { return; }
  for (const n of names){
    const file = path.join(recDir(), n), meta = file.replace(/\.mp4$/, '.json');
    try {
      if (statSync(file).size === 0){ unlinkSync(file); try { unlinkSync(meta); } catch {} continue; }
      const dest = moveRecording(file, meta, true);
      session.say(`지난번에 끝내지 못한 녹화를 복구했습니다 · _녹화/${path.basename(dest)}`);
    } catch { /* 다음에 다시 */ }
  }
}
const fromRec = e => rec?.recWin && !rec.recWin.isDestroyed() && e.sender === rec.recWin.webContents;
ipcMain.on('rec:chunk', (e, buf) => { if (fromRec(e)) try { writeSync(rec.fd, Buffer.from(buf)); } catch { /* 디스크 문제 */ } });
ipcMain.on('rec:started', (e, info) => {
  if (!fromRec(e)) return;
  rec.mic = !!info?.mic;
  rec.sys = !!info?.sys;
  const sysMiss = prefs.recSys !== false && !rec.sys
    ? ` · 컴퓨터 소리는 담지 못했습니다${process.platform === 'darwin' ? " (시스템 설정 → 개인정보 보호 및 보안 → 화면 및 시스템 오디오 기록에서 '수업 사이드바' 확인)" : ''}` : '';
  session.say(`녹화를 시작했습니다 · ${rec.where}${rec.sys ? ' + 컴퓨터 소리' : ''}${rec.mic ? ' + 마이크' : ''}${sysMiss} · 학생 얼굴·목소리·이름이 담길 수 있으니 공유하기 전에 확인하세요`);
  push();
});
ipcMain.on('rec:stopped', e => { if (fromRec(e)) finishRecording(); });
ipcMain.on('rec:error', (e, msg) => { if (!fromRec(e)) return; session.say(`녹화하지 못했습니다: ${msg}`); if (rec){ rec.stopping = true; finishRecording(); } });

const fromOverlay = e => [...overlays.values()].some(w => !w.isDestroyed() && w.webContents === e.sender);
ipcMain.on('overlay:wheel', (e, dy) => {
  if (!fromOverlay(e) || !Number.isFinite(dy)) return;
  tools.r = Math.max(60, Math.min(500, Math.round(tools.r - dy * 0.4)));
  for (const w of overlays.values()) if (!w.isDestroyed()) w.webContents.send('overlay:state', { r: tools.r });
});
ipcMain.on('overlay:close', e => { if (fromOverlay(e)) setTool('spot', false); });

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

// ---------- 발표자 화면 · 휴대폰 리모컨 (docs/PLAN.md 13 "4단계 확장") ----------
// 두 화면은 같은 웹 페이지(renderer/live.*)를 LiveServer에서 받는다. 발표자 화면은 이 PC 안(127.0.0.1) 창,
// 휴대폰은 같은 와이파이에서 QR 주소로. 휴대폰 주소의 열쇠는 리모컨을 켤 때마다 새로 만든다.
const timing = new Timing();
let presWin = null, remote = null, nextThumb = null, thumbTimer = null;
const memoCache = new Map();   // 메모 파일 → { m: 고친 시각, text }
function memoText(abs){
  try {
    const m = statSync(abs).mtimeMs, c = memoCache.get(abs);
    if (c?.m === m) return c.text;
    let text = readFileSync(abs, 'utf8');
    if (text.length > 20000) text = `${text.slice(0, 20000)}\n…`;
    memoCache.set(abs, { m, text });
    return text;
  } catch { return ''; }
}
function liveState(){
  const snap = session.snapshot();
  const v = liveView(snap.lesson, snap.highlight, timing);
  // 지난 시간은 화면이 since로 스스로 센다 (같은 내용이면 다시 보내지 않도록 시간이 흐르는 값은 뺀다)
  if (v){ delete v.lesson.elapsed; if (v.section){ delete v.section.elapsed; delete v.section.over; } }
  return {
    live: v,
    memo: memoFor(session.lesson, snap.highlight).map(m => ({ title: m.title, text: memoText(m.abs) })).filter(m => m.text.trim()),
    thumb: nextThumb && nextThumb.id === v?.next?.id ? nextThumb.v : null,
    cover: cover.mode, dual: snap.dual, rec: rec ? { since: rec.startedAt } : null, msg: snap.msg,
  };
}
async function liveAct(action, arg){
  if (!session.lesson && action !== 'blank') return;
  try {
    if (action === 'next') await session.next({ skipMemo: true });
    else if (action === 'prev') await session.prev();
    else if (action === 'activate'){ if (typeof arg === 'string' && session.item(arg)) await session.activate(arg); }
    else if (action === 'freeze' || action === 'blank') await setCover(action);
    else if (action === 'hideOthers') await session.hideOthers();
    else if (action === 'restartClock'){ timing.restart(); session.say('수업·구간 시계를 지금부터 다시 잽니다'); }
  } catch (e){ session.say(e.message); }
}
const liveSrv = new LiveServer({
  dir: path.join(HERE, 'renderer'), getState: liveState, onAct: liveAct,
  getThumb: () => nextThumb?.buf ?? null,
  // 휴대폰이 처음 붙으면 QR을 접는다 (모니터 한 대일 때 학생이 찍지 않게)
  onClients: () => { if (remote && liveSrv.clients('lan') > 0) remote.showQr = false; push(); },
});
function syncLive(){
  timing.update(session.lesson, session.highlight);
  liveSrv.broadcast();
  const want = !!presWin || liveSrv.clients('lan') > 0;
  if (want && !thumbTimer){ thumbTimer = setInterval(refreshThumb, 3000); refreshThumb(); }
  else if (!want && thumbTimer){ clearInterval(thumbTimer); thumbTimer = null; nextThumb = null; }
}
/** 다음 자료 창이 미리 열려 있으면 작게 찍어 둔다 (화면 기록 권한이 있을 때만). 다음 자료가 바뀌면 바로, 그대로면 10초마다 */
let thumbBusy = false;
async function refreshThumb(){
  if (thumbBusy || screenAccess() !== 'granted' || !session.lesson) return;
  const nx = liveView(session.snapshot().lesson, session.highlight, timing)?.next;
  const wid = nx ? session.state.get(nx.id)?.wid : null;
  if (!wid){ if (nextThumb){ nextThumb = null; liveSrv.broadcast(); } return; }
  if (nextThumb?.id === nx.id && Date.now() - nextThumb.at < 10000) return;
  thumbBusy = true;
  try {
    const srcs = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 480, height: 300 } });
    const src = srcs.find(x => Number(String(x.id).split(':')[1]) === Number(wid));
    nextThumb = src && !src.thumbnail.isEmpty() ? { id: nx.id, wid, buf: src.thumbnail.toJPEG(75), v: `${nx.id}-${Date.now()}`, at: Date.now() } : null;
    liveSrv.broadcast();
  } catch { /* 다음에 다시 */ } finally { thumbBusy = false; }
}

async function setPresenter(on){
  if (!on){ presWin?.close(); return; }
  if (presWin){ presWin.show(); presWin.focus(); return; }
  await liveSrv.listen('local', '127.0.0.1');
  const wa = teacherArea();
  const w = Math.min(1100, wa.width - SIDEBAR_W - 40), h = Math.min(720, wa.height - 20);
  presWin = new BrowserWindow({
    x: Math.round(wa.x + SIDEBAR_W + Math.max(20, (wa.width - SIDEBAR_W - w) / 2)), y: Math.round(wa.y + Math.max(10, (wa.height - h) / 2)),
    width: w, height: h, minWidth: 360, minHeight: 420, title: '발표자 화면 — 수업 사이드바', backgroundColor: '#1b2f2a', show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  lockDown(presWin);
  presWin.loadURL(liveSrv.url('local'));
  presWin.once('ready-to-show', () => presWin?.show());
  presWin.on('closed', () => { presWin = null; liveSrv.close('local'); push(); });
  session.say(session.dual ? '발표자 화면을 교사 화면에 열었습니다 · 진행 메모, 구간 시계, 다음 자료 · 키보드 → 다음, ← 이전'
    : '발표자 화면을 열었습니다 · 모니터가 한 대라 학생에게도 보입니다');
  push();
}

async function setRemote(on){
  liveSrv.close('lan');
  if (!on){
    if (remote){ remote = null; session.say('휴대폰 리모컨을 껐습니다 · 연결했던 휴대폰은 더 이상 조작할 수 없습니다'); }
    return push();
  }
  const a = lanAddress(os.networkInterfaces());
  if (!a){ remote = null; session.say('와이파이(또는 유선 인터넷)에 연결되어 있지 않아 휴대폰 리모컨을 켤 수 없습니다'); return push(); }
  try { await liveSrv.listen('lan', a.address); }
  catch (e){ remote = null; session.say(`휴대폰 리모컨을 켜지 못했습니다 (${e.code ?? e.message})`); return push(); }
  const url = liveSrv.url('lan');
  const q = qrcode(0, 'M'); q.addData(url); q.make();
  remote = { url, qr: q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }), showQr: true };
  session.say(`휴대폰 카메라로 QR을 찍어 주세요 (이 PC와 같은 와이파이) · 처음이면 '들어오는 연결 허용'을 물을 수 있습니다${session.dual ? '' : ' · 모니터가 한 대라 QR이 학생에게도 보입니다. 연결한 뒤 QR을 닫아 주세요'}`);
  push();
}

// ---------- 새 버전 알림 (docs/PLAN.md 13 "서명·자동 업데이트") ----------
// 하루 한 번 GitHub Releases의 최신 버전을 보고, 새 버전이면 사이드바에 "내려받기"를 보인다. 깔기는 선생님이 직접 (update.js 맨 위 이유)
let update = null;   // { version, url, page, notes, size, dismissed }
async function runUpdateCheck({ manual = false } = {}){
  try {
    const u = process.env.SIDEBAR_DEBUG === '1' && process.env.SIDEBAR_FAKE_UPDATE
      ? { version: process.env.SIDEBAR_FAKE_UPDATE, url: 'https://github.com/janghwansangai/lesson-sidebar/releases', notes: '시험용 새 버전', size: null }
      : await checkUpdate(app.getVersion(), { fetchFn: net.fetch });
    saveSettings({ lastUpdateCheck: Date.now() });
    update = u;
    if (manual) session.say(u ? `새 버전 ${u.version}이 있습니다 · 위쪽 '내려받기'를 눌러 주세요` : `지금 버전(${app.getVersion()})이 가장 새 버전입니다`);
    push();
  } catch (e){
    if (manual) session.say(`새 버전을 확인하지 못했습니다 (인터넷 연결 확인 · ${e.message})`);
  }
}
function scheduleUpdateCheck(){
  // 개발 중(npx electron .)에는 확인하지 않는다. 시험할 때는 SIDEBAR_FAKE_UPDATE=0.2.0
  if (!app.isPackaged && !process.env.SIDEBAR_FAKE_UPDATE) return;
  const due = () => prefs.updateCheck && Date.now() - (readSettings().lastUpdateCheck ?? 0) > 20 * 3600e3;
  setTimeout(() => { if (due()) runUpdateCheck(); }, 15000);
  setInterval(() => { if (due()) runUpdateCheck(); }, 3600e3);
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
    conflicts: doc ? findConflicts(doc.root) : [],
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
    trusted, freeBytes, lockedBy: otherLock(root, DEVICE)?.device ?? null, cloud: cloudOf(root), screenRec: screenAccess(),
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
  // ---------- 정리와 재사용 ----------
  duplicate(p){
    const d = needDoc(); const lib = libraryRoot(); if (!lib) throw new Error('먼저 수업 보관함 위치를 정해 주세요');
    d.save();
    const dest = duplicateLesson(d.root, lib, { title: str(p.title, 120), date: str(p.date, 10) });
    openDoc(dest);
    note(`'${path.basename(dest)}' 수업을 만들었습니다 · 자료·순서·메모를 그대로 복사했고, 녹화·캡처는 빼고 복사했습니다`);
  },
  guide(){
    const d = needDoc();
    const file = path.join(d.root, '수업안내.html');
    writeFileSync(file, guideHtml(d.data));
    if (!DEBUG) shell.openPath(file);
    note('수업 폴더에 수업안내.html을 만들었습니다 · 참여자에게 나눠 주면 순서와 링크를 볼 수 있습니다 (진행 메모는 빠짐)');
  },
  resolveConflict(p){
    const d = needDoc();
    const pick = str(p.file, 200);
    resolveConflict(d.root, pick);
    d.load();
    refreshSessionIfSame(d.root);
    note(`${pick === 'lesson.json' ? '이 PC의 내용을' : `'${pick}' 내용을`} 쓰기로 했습니다 · 다른 사본은 .sidebar/backup에 남겼습니다`);
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
  info(p){ needDoc().setInfo({ title: str(p.title, 120), date: str(p.date, 10), review: str(p.review, 4000) }); afterEdit(); },
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
      const wasOpen = mode === 'overwrite' && doc?.root === existing;
      if (wasOpen){ clearLock(existing, DEVICE); doc = null; }   // 푸는 동안 이 창이 저장하지 않게
      let r;
      try { r = await importBundle(info, lib, { mode, existing }); }
      catch (e){ if (wasOpen) openDoc(existing); throw e; }      // 못 덮어썼으면 보던 수업을 다시 연다 (수업은 그대로)
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
  prev: () => session.prev(),
  presenter: v => setPresenter(v === true || v === 'true'),
  remote: v => setRemote(v === true || v === 'true'),
  remoteNew: () => setRemote(true),
  getUpdate: () => { if (update && isReleaseUrl(update.url)){ shell.openExternal(update.url); session.say(`새 버전 ${update.version}을 내려받습니다 · 다 받으면 열어서 설치해 주세요 (사이드바를 끝낸 뒤 덮어 설치)`); } },
  dismissUpdate: () => { if (update){ update.dismissed = true; push(); } },
  updateCheck: v => { prefs.updateCheck = v === true || v === 'true'; saveSettings({ updateCheck: prefs.updateCheck }); push(); },
  checkUpdateNow: () => runUpdateCheck({ manual: true }),
  remoteQr: v => { if (remote){ remote.showQr = v === true || v === 'true'; push(); } },
  hideOthers: () => session.hideOthers(),
  // 손쉬운 사용 설정 화면만 열어 준다 (켜는 것은 선생님이 직접)
  axSettings: () => shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'),
  closeAll: () => session.closeAll(),
  openTo: v => session.setOpenTo(v),
  record: () => startRecording(),
  recMic: v => { prefs.recMic = v === true || v === 'true'; saveSettings({ recMic: prefs.recMic }); push(); },
  recScreen: v => { prefs.recScreen = v === 'teacher' ? 'teacher' : 'student'; saveSettings({ recScreen: prefs.recScreen }); push(); },
  recSys: v => { prefs.recSys = v === true || v === 'true'; saveSettings({ recSys: prefs.recSys }); push(); },
  recLight: v => { prefs.recLight = v === true || v === 'true'; saveSettings({ recLight: prefs.recLight }); push(); },
  revealRec: v => { if (typeof v === 'string' && /_녹화[\\/]/.test(v) && existsSync(v)) shell.showItemInFolder(v); },
  freeze: () => setCover('freeze'),
  blank: () => setCover('blank'),
  preview: v => { previewOn = v === true || v === 'true'; syncPreview(); push(); },
  autoHide: v => setAutoHide(v === true || v === 'true'),
  opacity: v => setOpacity(v),
  aside: v => setAside(v === true || v === 'true'),
  prep: () => openPrep(),
  pointer: v => setTool('pointer', v === true || v === 'true'),
  spot: v => setTool('spot', v === true || v === 'true'),
  pen: v => setTool('pen', v === true || v === 'true'),
  zoom: () => startGrab('zoom'),
  pin: () => startGrab('pick'),
  closePins: () => { for (const p of [...pins]) p.close(); },
  screenSettings: () => shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'),
  quit: () => app.quit(),
  shortcuts: v => { prefs.shortcuts = v === true || v === 'true'; saveSettings({ shortcuts: prefs.shortcuts }); syncShortcuts(true); push(); },
};

// ---------- 단축키 (core/shortcuts.js) ----------
// 켜 두면 어느 프로그램이 앞에 있어도 Ctrl+Alt(맥 ⌃⌥)+글자로 사이드바 기능을 부른다. 다른 프로그램이 이미 쓰는 조합은 건너뛰고 알린다
let shortcutsOn = false;
function syncShortcuts(announce = false){
  for (const s of SHORTCUTS) globalShortcut.unregister(accelerator(s));
  shortcutsOn = false;
  if (prefs.shortcuts === false){ if (announce) session.say('단축키를 껐습니다'); return; }
  const taken = [];
  for (const s of SHORTCUTS){
    const fn = s.act === 'pen' || s.act === 'pointer' || s.act === 'spot' ? () => setTool(s.act, !tools[s.act]) : () => act(s.act);
    let ok = false;
    try { ok = globalShortcut.register(accelerator(s), () => { Promise.resolve(fn()).catch(e => session.say(e.message)); }); } catch { ok = false; }
    if (!ok) taken.push(keyLabel(s));
  }
  shortcutsOn = true;
  if (taken.length) session.say(`단축키 ${taken.join(', ')}는 다른 프로그램이 쓰고 있어 건너뛰었습니다`);
  else if (announce) session.say(`단축키를 켰습니다 · ${keyLabel(SHORTCUTS[0])} 다음 자료, ${keyLabel(SHORTCUTS[1])} 이전 자료 (목록은 ⚙)`);
}

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
  prefs = { opacity: OPACITY_STEPS.includes(settings.opacity) ? settings.opacity : 100, aside: ASIDE_OK && !!settings.aside, recMic: settings.recMic !== false, recSys: settings.recSys !== false, recScreen: settings.recScreen === 'teacher' ? 'teacher' : 'student', recLight: !!settings.recLight, updateCheck: settings.updateCheck !== false, shortcuts: settings.shortcuts !== false };
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
  syncShortcuts();
  // 고정한 채로 켜면 가려지는 창을 옆으로 (설정을 켰을 때만)
  if (trusted && prefs.aside && !session.autoHide){
    const n = await session.stepAside();
    if (n) session.say(`가려지던 창 ${n}개를 사이드바 오른쪽으로 옮겼습니다 · 끝내거나 자동 숨김으로 바꾸면 돌려놓습니다`);
  }
  if (trusted) syncAsideWatch();

  let t = null;
  const onDisplays = () => { clearTimeout(t); t = setTimeout(async () => { await session.onDisplaysChanged(); placeSidebar(); for (const [id, w] of overlays){ if (!screen.getAllDisplays().some(d => d.id === id)){ w.destroy(); overlays.delete(id); } } syncTools(); if (cover.mode === 'freeze' && !session.dual) setCover(null); else if (cover.mode) ensureCover(coverDisplay()); syncPreview(); }, 800); };
  screen.on('display-added', onDisplays);
  screen.on('display-removed', onDisplays);
  screen.on('display-metrics-changed', onDisplays);

  recoverRecordings();
  scheduleUpdateCheck();
  setInterval(watchOutside, 3000);
  setInterval(heartbeat, 30000);

  if (process.env.SIDEBAR_DEBUG === '1') await startDebugServer();
});

app.on('window-all-closed', () => app.quit());
let restoringOnQuit = false;
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('before-quit', e => {
  clearInterval(asideTimer);
  if (rec) finishRecording();   // 끝낼 때 녹화 중이면 그때까지 저장 (마지막 2초 조각은 빠질 수 있음)
  // 끝낼 때 옆으로 옮겼던 창을 먼저 돌려놓는다 (오래 걸려도 5초까지만 기다림)
  if (session?.aside?.length && !restoringOnQuit){
    e.preventDefault();
    restoringOnQuit = true;
    Promise.race([session.restoreAside(), new Promise(r => setTimeout(r, 5000))]).finally(() => app.quit());
    return;
  }
  for (const root of new Set([doc?.root, session?.lesson?.root].filter(Boolean))) clearLock(root, DEVICE);
  helper?.stop(); files?.close(); liveSrv.closeAll(); clearInterval(cursorTimer); clearInterval(thumbTimer);
});
