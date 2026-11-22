#!/usr/bin/env node
// 수업 사이드바 — 윈도우 창 관리 도우미 (0단계 기술 검증)
// 규격: docs/poc/helper-protocol.md. 맥 도우미(poc/mac-helper)와 같은 명령, 같은 JSON 출력을 지킨다.
//
//   node winctl.js trusted | displays | list [--app <이름 일부>] | front
//   node winctl.js raise <wid> | move <wid> <x> <y> <width> <height> | minimize <wid> | close <wid>
//   node winctl.js maximize <wid> | closetab <wid> <파일 이름> | findtab <wid> <파일 이름>   (윈도우에만 있는 추가 명령)
//   node winctl.js watch          (계속 실행하며 바뀐 것만 한 줄씩 알림)
//   node winctl.js clicks         (계속 실행하며 마우스를 누를 때마다 한 줄 — 포인터 강조의 클릭 물결)
//
// 출력: 표준 출력 마지막 줄에 JSON 하나. 실패하면 {"ok":false,"error":"…"} + 종료 코드 1.
// 좌표: 물리 픽셀, 주 모니터 왼쪽 위가 (0, 0). 이 프로세스를 Per-Monitor DPI Aware V2로 설정해
//       배율이 다른 모니터에서도 좌표가 어긋나지 않게 한다. 창 위치는 그림자를 뺀 실제 테두리 기준.
// 안전: 닫기는 WM_CLOSE(정상 종료 요청)만 보낸다. 강제 종료하지 않는다.

import { spawnSync } from 'node:child_process';

class Fail extends Error {}
const emit = o => process.stdout.write(JSON.stringify(o) + '\n');
const fail = msg => { throw new Fail(msg); };

if (process.platform !== 'win32'){ emit({ ok: false, error: '윈도우 전용 도우미입니다' }); process.exit(1); }

let koffi;
try { koffi = (await import('koffi')).default; }
catch { emit({ ok: false, error: 'koffi가 설치되어 있지 않습니다. poc/win-helper 폴더에서 npm install 을 먼저 실행하세요' }); process.exit(1); }

// ---------- 윈도우 API ----------
const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');
const dwmapi = koffi.load('dwmapi.dll');
const shcore = koffi.load('shcore.dll');

koffi.proto('int __stdcall WNDENUMPROC(intptr_t hwnd, intptr_t lParam)');
koffi.proto('int __stdcall MONITORENUMPROC(intptr_t hmon, intptr_t hdc, void *rect, intptr_t lParam)');

const fn = (lib, decl) => lib.func(decl);
const W = {
  SetProcessDpiAwarenessContext: fn(user32, 'int __stdcall SetProcessDpiAwarenessContext(intptr_t value)'),
  EnumDisplayMonitors: fn(user32, 'int __stdcall EnumDisplayMonitors(intptr_t hdc, void *clip, MONITORENUMPROC *cb, intptr_t lParam)'),
  GetMonitorInfoW:     fn(user32, 'int __stdcall GetMonitorInfoW(intptr_t hmon, void *info)'),
  GetDisplayConfigBufferSizes: fn(user32, 'int32_t __stdcall GetDisplayConfigBufferSizes(uint32_t flags, _Out_ uint32_t *numPaths, _Out_ uint32_t *numModes)'),
  QueryDisplayConfig:  fn(user32, 'int32_t __stdcall QueryDisplayConfig(uint32_t flags, _Inout_ uint32_t *numPaths, void *paths, _Inout_ uint32_t *numModes, void *modes, void *topology)'),
  DisplayConfigGetDeviceInfo: fn(user32, 'int32_t __stdcall DisplayConfigGetDeviceInfo(void *packet)'),
  EnumWindows:         fn(user32, 'int __stdcall EnumWindows(WNDENUMPROC *cb, intptr_t lParam)'),
  IsWindow:            fn(user32, 'int __stdcall IsWindow(intptr_t hwnd)'),
  IsWindowVisible:     fn(user32, 'int __stdcall IsWindowVisible(intptr_t hwnd)'),
  IsWindowEnabled:     fn(user32, 'int __stdcall IsWindowEnabled(intptr_t hwnd)'),
  GetLastActivePopup:  fn(user32, 'intptr_t __stdcall GetLastActivePopup(intptr_t hwnd)'),
  IsIconic:            fn(user32, 'int __stdcall IsIconic(intptr_t hwnd)'),
  IsZoomed:            fn(user32, 'int __stdcall IsZoomed(intptr_t hwnd)'),
  GetWindow:           fn(user32, 'intptr_t __stdcall GetWindow(intptr_t hwnd, uint32_t cmd)'),
  GetAncestor:         fn(user32, 'intptr_t __stdcall GetAncestor(intptr_t hwnd, uint32_t flags)'),
  GetWindowLongPtrW:   fn(user32, 'intptr_t __stdcall GetWindowLongPtrW(intptr_t hwnd, int index)'),
  GetWindowTextLengthW: fn(user32, 'int __stdcall GetWindowTextLengthW(intptr_t hwnd)'),
  GetWindowTextW:      fn(user32, 'int __stdcall GetWindowTextW(intptr_t hwnd, void *buf, int max)'),
  GetClassNameW:       fn(user32, 'int __stdcall GetClassNameW(intptr_t hwnd, void *buf, int max)'),
  GetWindowThreadProcessId: fn(user32, 'uint32_t __stdcall GetWindowThreadProcessId(intptr_t hwnd, _Out_ uint32_t *pid)'),
  GetWindowRect:       fn(user32, 'int __stdcall GetWindowRect(intptr_t hwnd, void *rect)'),
  GetWindowPlacement:  fn(user32, 'int __stdcall GetWindowPlacement(intptr_t hwnd, void *placement)'),
  GetForegroundWindow: fn(user32, 'intptr_t __stdcall GetForegroundWindow()'),
  SetForegroundWindow: fn(user32, 'int __stdcall SetForegroundWindow(intptr_t hwnd)'),
  BringWindowToTop:    fn(user32, 'int __stdcall BringWindowToTop(intptr_t hwnd)'),
  ShowWindowAsync:     fn(user32, 'int __stdcall ShowWindowAsync(intptr_t hwnd, int cmd)'),
  SetWindowPos:        fn(user32, 'int __stdcall SetWindowPos(intptr_t hwnd, intptr_t after, int x, int y, int cx, int cy, uint32_t flags)'),
  PostMessageW:        fn(user32, 'int __stdcall PostMessageW(intptr_t hwnd, uint32_t msg, uintptr_t wParam, intptr_t lParam)'),
  SendInput:           fn(user32, 'uint32_t __stdcall SendInput(uint32_t count, void *inputs, int size)'),
  AttachThreadInput:   fn(user32, 'int __stdcall AttachThreadInput(uint32_t from, uint32_t to, int attach)'),
  GetCurrentThreadId:  fn(kernel32, 'uint32_t __stdcall GetCurrentThreadId()'),
  GetLastError:        fn(kernel32, 'uint32_t __stdcall GetLastError()'),
  OpenProcess:         fn(kernel32, 'intptr_t __stdcall OpenProcess(uint32_t access, int inherit, uint32_t pid)'),
  CloseHandle:         fn(kernel32, 'int __stdcall CloseHandle(intptr_t h)'),
  QueryFullProcessImageNameW: fn(kernel32, 'int __stdcall QueryFullProcessImageNameW(intptr_t h, uint32_t flags, void *buf, _Inout_ uint32_t *size)'),
  DwmGetWindowAttribute: fn(dwmapi, 'int32_t __stdcall DwmGetWindowAttribute(intptr_t hwnd, uint32_t attr, void *value, uint32_t size)'),
  GetDpiForMonitor:    fn(shcore, 'int32_t __stdcall GetDpiForMonitor(intptr_t hmon, int type, _Out_ uint32_t *dpiX, _Out_ uint32_t *dpiY)'),
  SetProcessDpiAwareness: fn(shcore, 'int32_t __stdcall SetProcessDpiAwareness(int value)'),
  GetAsyncKeyState:    fn(user32, 'int16_t __stdcall GetAsyncKeyState(int vKey)'),
  GetCursorPos:        fn(user32, 'int __stdcall GetCursorPos(_Out_ int32_t *pt)'),
  GetSystemMetrics:    fn(user32, 'int __stdcall GetSystemMetrics(int index)'),
};

const GW_OWNER = 4, GW_ENABLEDPOPUP = 6, GA_ROOT = 2, GWL_EXSTYLE = -20;
const WS_EX_TOOLWINDOW = 0x80, WS_EX_APPWINDOW = 0x40000;
const DWMWA_EXTENDED_FRAME_BOUNDS = 9, DWMWA_CLOAKED = 14;
const SW_RESTORE = 9, SW_MINIMIZE = 6, SW_MAXIMIZE = 3;
const SWP_NOZORDER = 0x4, SWP_NOACTIVATE = 0x10, SWP_NOOWNERZORDER = 0x200;
const WM_CLOSE = 0x10;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const SKIP_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd']);

// koffi 3은 64비트 정수를 number 또는 BigInt로 돌려준다. 창 번호 비교를 위해 number로 맞춘다 (HWND는 32비트 안에 들어간다).
const num = v => typeof v === 'bigint' ? Number(v) : v;

// 가장 먼저: 모니터마다 배율이 달라도 물리 픽셀로 좌표를 주고받는다
if (!W.SetProcessDpiAwarenessContext(-4)) { try { W.SetProcessDpiAwareness(2); } catch {} }

// ---------- 작은 도구 ----------
const SLEEPER = new Int32Array(new SharedArrayBuffer(4));
const sleepSync = ms => { Atomics.wait(SLEEPER, 0, 0, ms); };
function waitUntil(cond, timeout, every = 50){
  const t0 = Date.now();
  for (;;){
    if (cond()) return true;
    if (Date.now() - t0 >= timeout) return false;
    sleepSync(every);
  }
}
const wstr = (b, off, maxChars) => {
  let end = off; const lim = off + maxChars * 2;
  while (end < lim && b.readUInt16LE(end) !== 0) end += 2;
  return b.toString('utf16le', off, end);
};
const readRect = (b, o = 0) => ({ left: b.readInt32LE(o), top: b.readInt32LE(o + 4), right: b.readInt32LE(o + 8), bottom: b.readInt32LE(o + 12) });
const xywh = r => ({ x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top });

// ---------- 모니터 ----------
// 모니터 이름과 내장 여부는 QueryDisplayConfig로 읽는다 (\\.\DISPLAY1 → "LG HDR 4K", 노트북 화면이면 내장).
function displayNames(){
  const map = new Map();
  try {
    const np = [0], nm = [0];
    if (W.GetDisplayConfigBufferSizes(2 /* QDC_ONLY_ACTIVE_PATHS */, np, nm) !== 0) return map;
    const paths = Buffer.alloc(72 * np[0]), modes = Buffer.alloc(64 * nm[0]);
    if (W.QueryDisplayConfig(2, np, paths, nm, modes, null) !== 0) return map;
    for (let i = 0; i < np[0]; i++){
      const o = 72 * i;
      const src = Buffer.alloc(84);                       // DISPLAYCONFIG_SOURCE_DEVICE_NAME
      src.writeUInt32LE(1, 0); src.writeUInt32LE(84, 4);
      paths.copy(src, 8, o, o + 8);                       // sourceInfo.adapterId
      src.writeUInt32LE(paths.readUInt32LE(o + 8), 16);   // sourceInfo.id
      if (W.DisplayConfigGetDeviceInfo(src) !== 0) continue;
      const gdi = wstr(src, 20, 32);
      const tgt = Buffer.alloc(420);                      // DISPLAYCONFIG_TARGET_DEVICE_NAME
      tgt.writeUInt32LE(2, 0); tgt.writeUInt32LE(420, 4);
      paths.copy(tgt, 8, o + 20, o + 28);                 // targetInfo.adapterId
      tgt.writeUInt32LE(paths.readUInt32LE(o + 28), 16);  // targetInfo.id
      let tech = paths.readUInt32LE(o + 36), name = '';
      if (W.DisplayConfigGetDeviceInfo(tgt) === 0){ tech = tgt.readUInt32LE(24); name = wstr(tgt, 36, 64); }
      // 내장 화면: INTERNAL(0x80000000), DISPLAYPORT_EMBEDDED(11), UDI_EMBEDDED(13)
      const builtin = tech === 0x80000000 || tech === 11 || tech === 13;
      if (!map.has(gdi)) map.set(gdi, { name: name || (builtin ? '내장 화면' : ''), builtin });
    }
  } catch {}
  return map;
}

function displayList(){
  const mons = [];
  W.EnumDisplayMonitors(0, null, h => { mons.push(num(h)); return 1; }, 0);
  const names = displayNames();
  const ds = mons.map(h => {
    const b = Buffer.alloc(104);                          // MONITORINFOEXW
    b.writeUInt32LE(104, 0);
    W.GetMonitorInfoW(h, b);
    const dev = wstr(b, 40, 32);
    const dx = [0], dy = [0];
    const scale = W.GetDpiForMonitor(h, 0 /* MDT_EFFECTIVE_DPI */, dx, dy) === 0 ? Math.round(dx[0] / 96 * 100) / 100 : 1;
    const info = names.get(dev) ?? {};
    return { id: Number(dev.match(/(\d+)$/)?.[1] ?? 0), name: info.name || dev.replace(/^\\\\\.\\/, ''),
      primary: (b.readUInt32LE(36) & 1) === 1, builtin: !!info.builtin, scale,
      ...xywh(readRect(b, 4)), visible: xywh(readRect(b, 20)) };
  });
  // 주 모니터를 먼저, 나머지는 왼쪽부터
  ds.sort((a, b) => (b.primary - a.primary) || (a.x - b.x) || (a.y - b.y));
  return ds.map((d, index) => ({ index, ...d }));
}

function displayIndex(r, ds){
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  const d = ds.find(d => cx >= d.x && cx < d.x + d.width && cy >= d.y && cy < d.y + d.height);
  return d ? d.index : -1;
}

// ---------- 창 ----------
function title(h){
  const n = W.GetWindowTextLengthW(h);
  if (n <= 0) return '';
  const b = Buffer.alloc((n + 1) * 2);
  const got = W.GetWindowTextW(h, b, n + 1);
  return b.toString('utf16le', 0, got * 2);
}
function className(h){
  const b = Buffer.alloc(512);
  const n = W.GetClassNameW(h, b, 256);
  return b.toString('utf16le', 0, n * 2);
}
function pidOf(h){ const p = [0]; W.GetWindowThreadProcessId(h, p); return p[0]; }

const exeCache = new Map();
/** 프로그램 실행 파일의 전체 경로 */
function exePath(pid){
  if (exeCache.has(pid)) return exeCache.get(pid);
  let full = '';
  const hp = num(W.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid));
  if (hp){
    const b = Buffer.alloc(2048), size = [1024];
    if (W.QueryFullProcessImageNameW(hp, 0, b, size)) full = b.toString('utf16le', 0, size[0] * 2);
    W.CloseHandle(hp);
  }
  exeCache.set(pid, full);
  return full;
}
function exeName(pid){ return exePath(pid).split('\\').pop(); }

function windowRect(h){ const b = Buffer.alloc(16); W.GetWindowRect(h, b); return readRect(b); }
/** 그림자를 뺀 실제 테두리 (윈도우 10·11은 창 둘레에 보이지 않는 7~8픽셀 그림자 테두리가 있다). */
function frameRect(h){
  const b = Buffer.alloc(16);
  return W.DwmGetWindowAttribute(h, DWMWA_EXTENDED_FRAME_BOUNDS, b, 16) === 0 ? readRect(b) : windowRect(h);
}
function cloaked(h){
  const b = Buffer.alloc(4);
  return W.DwmGetWindowAttribute(h, DWMWA_CLOAKED, b, 4) === 0 && b.readUInt32LE(0) !== 0;
}

/** 최소화된 창은 화면 밖(-32000)에 있으므로, 복원했을 때의 위치를 돌려준다. */
function restoredRect(h, ds){
  const b = Buffer.alloc(44); b.writeUInt32LE(44, 0);
  if (!W.GetWindowPlacement(h, b)) return xywh(frameRect(h));
  // rcNormalPosition은 작업 영역 기준 좌표 → 주 모니터 작업 영역만큼 보정
  const p = ds.find(d => d.primary) ?? ds[0];
  const r = xywh(readRect(b, 28));
  return p ? { ...r, x: r.x + p.visible.x - p.x, y: r.y + p.visible.y - p.y } : r;
}

/** 작업 표시줄에 나오는 일반 창인지 (보이고, 제목 있고, 도구 창·소유된 창·숨겨진 UWP 창이 아님). */
function isAppWindow(h){
  if (!W.IsWindowVisible(h)) return false;
  const ex = num(W.GetWindowLongPtrW(h, GWL_EXSTYLE));
  const owned = num(W.GetWindow(h, GW_OWNER)) !== 0;
  if (!(ex & WS_EX_APPWINDOW) && (owned || (ex & WS_EX_TOOLWINDOW))) return false;
  if (cloaked(h)) return false;
  if (!title(h)) return false;
  return !SKIP_CLASSES.has(className(h));
}

function topWindows(){
  const out = [];
  W.EnumWindows(h => { out.push(num(h)); return 1; }, 0);   // 앞(맨 위) 창부터
  return out;
}

function allWindows(appFilter){
  const f = appFilter?.toLowerCase();
  return topWindows().filter(isAppWindow).filter(h => !f || exeName(pidOf(h)).toLowerCase().includes(f));
}

/**
 * 답을 기다리는 창(저장 여부·확인·로그인 등 모달 대화 상자)이 떠 있으면 그 창. 없으면 null.
 * 모달 대화 상자가 뜨면 바탕 창은 "사용 안 함" 상태가 된다. 맨 앞이 아니어도 알 수 있다.
 */
function waitingFor(h){
  if (W.IsWindowEnabled(h)) return null;
  let p = num(W.GetWindow(h, GW_ENABLEDPOPUP));
  if (!p || p === h) p = num(W.GetLastActivePopup(h));
  return p && p !== h ? { wid: p, title: title(p) } : { wid: null, title: '' };
}

function winJSON(h, ds){
  const minimized = !!W.IsIconic(h), maximized = !!W.IsZoomed(h);
  const r = minimized ? restoredRect(h, ds) : xywh(frameRect(h));
  const pid = pidOf(h);
  const mon = ds[displayIndex(r, ds)];
  // 윈도우에는 맥 같은 "전체 화면" 상태가 따로 없다. 최대화가 아니면서 모니터 전체를 덮으면 전체 화면으로 본다 (슬라이드 쇼, F11).
  const fullscreen = !minimized && !maximized && !!mon && r.x <= mon.x && r.y <= mon.y && r.x + r.width >= mon.x + mon.width && r.y + r.height >= mon.y + mon.height;
  return { wid: h, pid, app: exeName(pid), title: title(h), ...r, minimized, maximized, fullscreen, display: displayIndex(r, ds), waiting: waitingFor(h) };
}

/** 대화 상자(소유된 창)가 앞에 있으면, 목록에 나오는 바탕 창까지 거슬러 올라간다. */
function ownerRoot(h){
  let w = h;
  for (let i = 0; i < 20; i++){
    const o = num(W.GetWindow(w, GW_OWNER));
    if (!o || !W.IsWindowVisible(o)) break;
    w = o;
  }
  return w;
}

function frontInfo(){
  const fg = num(W.GetForegroundWindow());
  if (!fg) return {};
  const root = ownerRoot(fg);
  const pid = pidOf(root);
  const info = { wid: root, pid, app: exeName(pid), title: title(root) };
  // 답을 기다리는 창(저장 여부, 로그인 등)이 앞에 있으면 함께 알린다
  if (root !== fg) info.dialog = { wid: fg, title: title(fg) };
  return info;
}

function findWin(arg){
  const h = Number(arg);
  if (!arg || !Number.isInteger(h) || h <= 0) fail('창 번호(wid)가 필요합니다');
  if (!W.IsWindow(h) || num(W.GetAncestor(h, GA_ROOT)) !== h) fail(`창 ${h}을(를) 찾지 못했습니다`);
  return h;
}

function restore(h){
  if (!W.IsIconic(h) && !W.IsZoomed(h)) return false;
  W.ShowWindowAsync(h, SW_RESTORE);
  waitUntil(() => !W.IsIconic(h) && !W.IsZoomed(h), 1500);
  sleepSync(150);   // 복원 애니메이션
  return true;
}

// ---------- 명령 ----------
function raise(h){
  const t0 = Date.now();
  const detail = { restored: false, tried: [] };
  const isFront = () => ownerRoot(num(W.GetForegroundWindow())) === h;
  if (W.IsIconic(h)){ W.ShowWindowAsync(h, SW_RESTORE); waitUntil(() => !W.IsIconic(h), 1500); detail.restored = true; }

  // 윈도우는 맨 앞이 아닌 프로그램이 다른 창을 앞으로 가져오는 것을 막는다 (포커스 가로채기 방지).
  // 어느 방법이 통하는지 기록하려고 순서대로 시도한다.
  const attempts = [
    ['direct', () => W.SetForegroundWindow(h)],
    // 빈 마우스 입력(움직임 없음) 하나를 보내 "마지막 입력을 받은 프로세스"가 된 뒤 다시 시도
    ['dummyInput', () => { W.SendInput(1, Buffer.alloc(40) /* INPUT_MOUSE, 모두 0 */, 40); return W.SetForegroundWindow(h); }],
    // 지금 맨 앞 창의 입력 큐에 잠시 붙어서 시도
    ['attachThreadInput', () => {
      const fgT = W.GetWindowThreadProcessId(num(W.GetForegroundWindow()), null);
      const me = W.GetCurrentThreadId();
      const att = fgT && fgT !== me ? W.AttachThreadInput(me, fgT, 1) : 0;
      W.BringWindowToTop(h);
      const r = W.SetForegroundWindow(h);
      if (att) W.AttachThreadInput(me, fgT, 0);
      return r;
    }],
  ];
  let method = isFront() ? 'already' : null;
  for (const [name, run] of attempts){
    if (method) break;
    const ret = !!run();
    const front = waitUntil(isFront, 400);
    detail.tried.push({ method: name, returned: ret, front });
    if (front) method = name;
  }
  const ok = method ? true : waitUntil(isFront, 1000);
  detail.method = ok ? (method ?? 'late') : null;
  detail.waiting = waitingFor(h);   // 답을 기다리는 창이 있으면 윈도우가 그 창을 앞으로 가져온다
  return { ok, front: frontInfo(), ms: Date.now() - t0, detail };
}

function move(h, req){
  const restored = restore(h);
  // 그림자 테두리만큼 바깥으로 넓혀서, 보이는 테두리가 요청한 위치에 오게 한다
  const place = () => {
    const wr = windowRect(h), fr = frameRect(h);
    const L = fr.left - wr.left, T = fr.top - wr.top, R = wr.right - fr.right, B = wr.bottom - fr.bottom;
    return !!W.SetWindowPos(h, 0, req.x - L, req.y - T, req.width + L + R, req.height + T + B, SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOOWNERZORDER);
  };
  let ok = place();
  const err = ok ? 0 : W.GetLastError();
  sleepSync(120);
  let actual = xywh(frameRect(h));
  let passes = 1;
  // 배율이 다른 모니터로 넘어가면 창이 스스로 크기를 바꾸고(WM_DPICHANGED) 그림자 폭도 바뀐다 → 한 번 더 맞춘다
  const off = a => ['x', 'y', 'width', 'height'].some(k => Math.abs(a[k] - req[k]) > 2);
  if (ok && off(actual)){ place(); sleepSync(120); actual = xywh(frameRect(h)); passes = 2; }
  const res = { ok, requested: req, actual, detail: { restored, passes } };
  if (!ok) res.error = `창을 옮기지 못했습니다 (오류 ${err}${err === 5 ? ': 관리자 권한으로 실행된 창일 수 있음' : ''})`;
  return res;
}

function minimize(h){
  W.ShowWindowAsync(h, SW_MINIMIZE);
  return { ok: waitUntil(() => !!W.IsIconic(h), 1500) };
}

function maximize(h){
  W.ShowWindowAsync(h, SW_MAXIMIZE);
  return { ok: waitUntil(() => !!W.IsZoomed(h), 1500) };
}

// ---------- 탭을 쓰는 메모장에서 탭 하나만 닫기 ----------
// 윈도우 11 메모장은 한 창에 여러 파일을 탭으로 연다. 창을 닫으면(WM_CLOSE) 다른 탭까지 닫히므로 그 파일의 탭만 닫는다.
// 방법: UI 자동화(UIAutomation, 화면 읽기 프로그램이 쓰는 윈도우 기능)로 이름이 정확히 그 파일인 탭을 골라(Select)
//       그 탭에 달린 "탭 닫기" 단추를 누른다(Invoke). 키보드를 쓰지 않으므로 다른 탭에 글자가 들어가거나 다른 탭이 닫힐 일이 없다.
//       저장 안 한 탭은 닫기 단추 대신 점(●)이 있어 단추가 없다 → 그때만 Ctrl+W(보이는 탭만 닫는 단축키)를 보낸다.
//       보내기 바로 앞에 키보드 초점이 그 메모장 창 안이고, 창 제목(보이는 탭)이 그 파일이고, 확인 창이 없는지 다시 본다.
//   - 키보드로 탭을 넘기며(Ctrl+Tab) 찾는 방법은 믿을 수 없었다: 탭을 넘기다 메모장 안의 알림 창("지정된 경로를 찾을 수 없습니다",
//     예전 세션에서 되살린 탭)이 뜨면 그 뒤로는 키가 먹지 않았다 (docs/poc/windows.md 체험판 15).
//   - 메모장 안의 확인·저장 창은 별도 창이 아니라 창 안의 팝업이라 list의 waiting으로는 안 보인다 → 여기서 따로 본다.
//     ("변경 내용을 …에 저장하시겠습니까?" 저장 / 저장하지 않음 / 취소)
//   - 같은 이름의 탭이 둘 이상이면(다른 폴더의 같은 이름 파일) 어느 것인지 모르므로 닫지 않는다.
// UI 자동화는 윈도우 기본 PowerShell로 부른다 (koffi로 COM을 직접 부르는 것보다 단순, 한 번에 약 1초).
// 파일 이름과 창 번호는 환경 변수로 넘겨 명령 글자에 섞이지 않게 한다. 출력은 영문 키의 JSON 한 줄.
const TAB_PS = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$A = [System.Windows.Automation.AutomationElement]
$TS = [System.Windows.Automation.TreeScope]::Descendants
$h = [IntPtr][long]$env:WINCTL_HWND
$name = $env:WINCTL_NAME
function Say($o){ [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress)) }
function Root(){ try { $A::FromHandle($h) } catch { $null } }
function Tabs($r){
  $c = New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty, [System.Windows.Automation.ControlType]::TabItem)
  @($r.FindAll($TS, $c) | Where-Object { $_.Current.Name -eq $name -or $_.Current.Name.StartsWith("$name. ") })
}
function Dialog($r){
  # 메모장 안의 확인·저장 창(ContentDialog): 팝업 창 안의 PrimaryButton·SecondaryButton·CloseButton
  # (탭의 "탭 닫기" 단추도 이름이 CloseButton이지만 부모가 탭이다. 탭에 마우스를 올리면 뜨는 설명 팝업은 단추가 없다)
  foreach ($id in 'PrimaryButton', 'SecondaryButton', 'CloseButton'){
    foreach ($b in $r.FindAll($TS, (New-Object System.Windows.Automation.PropertyCondition($A::AutomationIdProperty, $id)))){
      $p = [System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($b)
      if ($p -and $p.Current.ControlType -eq [System.Windows.Automation.ControlType]::Window){ return $true }
    }
  }
  $false
}
function Front(){
  # 키보드 초점이 이 메모장 창 안에 있는지 (= 메모장이 맨 앞)
  try {
    $e = $A::FocusedElement; $w = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    while ($e -and $e.Current.NativeWindowHandle -ne [int]$h){ $e = $w.GetParent($e) }
    $null -ne $e
  } catch { $false }
}
function Shows($r){ $s = $r.Current.Name -replace '^[*•●]\s*', ''; $s -eq $name -or $s.StartsWith("$name - ") }
$r = Root
if (-not $r){ Say @{ gone = $true }; exit }
if ($env:WINCTL_MODE -eq 'find'){ $n = (Tabs $r).Count; Say @{ found = ($n -eq 1); count = $n; dialog = (Dialog $r) }; exit }
if (Dialog $r){ Say @{ found = $false; dialog = $true }; exit }
$t = Tabs $r
if ($t.Count -ne 1){ Say @{ found = $false; count = $t.Count }; exit }
$t[0].GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select()
for ($i = 0; $i -lt 10 -and -not (Shows $r); $i++){ Start-Sleep -Milliseconds 50 }
if (-not (Shows $r)){ Say @{ found = $true; count = 1; closed = $false; how = 'notShown' }; exit }
$b = $t[0].FindFirst($TS, (New-Object System.Windows.Automation.PropertyCondition($A::AutomationIdProperty, 'CloseButton')))
if ($b){ $b.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke(); $how = 'button' }
else {
  # 저장 안 한 탭은 닫기 단추 대신 점(●)이 있어 단추가 없다 → Ctrl+W (지금 보이는 탭만 닫는 단축키)
  # 메모장이 맨 앞이고 보이는 탭이 그 파일인지 바로 앞에서 다시 확인한 뒤에만 보낸다
  if (-not (Front) -or -not (Shows $r) -or (Dialog $r)){ Say @{ found = $true; count = 1; closed = $false; how = 'notFront' }; exit }
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.SendKeys]::SendWait('^w'); $how = 'ctrlW'
}
for ($i = 0; $i -lt 25; $i++){
  Start-Sleep -Milliseconds 60
  $r = Root
  if (-not $r){ Say @{ found = $true; count = 1; closed = $true; how = $how }; exit }
  try {
    if ((Tabs $r).Count -eq 0){ Say @{ found = $true; count = 1; closed = $true; how = $how }; exit }
    if (Dialog $r){ Say @{ found = $true; count = 1; closed = $false; dialog = $true; how = $how }; exit }
  } catch { Say @{ found = $true; count = 1; closed = $true; how = $how }; exit }
}
Say @{ found = $true; count = 1; closed = $false; how = $how }
`;
const POWERSHELL = `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
const isTabbedNotepad = h => /\\Microsoft\.WindowsNotepad_[^\\]*\\Notepad\\Notepad\.exe$/i.test(exePath(pidOf(h)));

/** PowerShell로 TAB_PS 실행 → JSON. mode: 'close'(고르고 닫기) | 'find'(그 이름의 탭 수와 확인 창만) */
function runTabScript(h, name, mode){
  // -EncodedCommand는 스크립트 파일이 아니라서 "스크립트 실행 안 함" 정책과 상관없이 실행된다 (정책은 바꾸지 않음)
  const r = spawnSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(TAB_PS, 'utf16le').toString('base64')], {
    env: { ...process.env, WINCTL_HWND: String(h), WINCTL_NAME: name, WINCTL_MODE: mode }, encoding: 'utf8', timeout: 15000, windowsHide: true,
  });
  let out = null;
  try { out = JSON.parse(String(r.stdout ?? '').trim().split(/\r?\n/).pop()); } catch { /* 아래 */ }
  if (!out) fail(`메모장 탭을 읽지 못했습니다 (UI 자동화${r.error ? `: ${r.error.message}` : ''})`);
  if (out.gone) fail(`창 ${h}을(를) 찾지 못했습니다`);
  return out;
}

const plainTitleIs = (h, name) => { const t = title(h).replace(/^[*•●]\s*/, ''); return t === name || t.startsWith(`${name} - `); };

function findTab(h, name){
  if (!isTabbedNotepad(h)) return { ok: true, tabs: false, found: plainTitleIs(h, name), count: plainTitleIs(h, name) ? 1 : 0, dialog: false };
  const out = runTabScript(h, name, 'find');
  return { ok: true, tabs: true, found: !!out.found, count: out.count ?? 0, dialog: !!out.dialog };
}

function closeTab(h, name){
  const t0 = Date.now();
  // 탭이 없는 메모장(윈도우 10 등)은 창 하나에 파일 하나 → 알려만 준다 (닫기는 close로)
  if (!isTabbedNotepad(h)) return { ok: true, tabs: false, found: plainTitleIs(h, name), closed: false, ms: Date.now() - t0 };
  // 앞으로 가져와 둔다: 저장 여부를 물으면 선생님이 바로 보고 답하도록 (탭 닫기 단추는 앞에 없어도 눌린다)
  const raised = raise(h).ok;
  const out = runTabScript(h, name, 'close');
  const gone = !W.IsWindow(h);
  return {
    ok: true, tabs: true, found: !!out.found, count: out.count ?? (out.found ? 1 : 0), closed: !!out.closed, windowClosed: gone,
    // 메모장 안의 저장 여부·알림 창 (waiting과 같은 모양)
    waiting: out.dialog && !gone ? { wid: null, title: '메모장 안의 확인 창' } : null,
    how: out.how ?? null,   // button(탭 닫기 단추) | ctrlW(저장 안 한 탭) | notShown·notFront(멈춤)
    raised, ms: Date.now() - t0,
  };
}

function close(h){
  // 정상 종료 요청만 보낸다. 저장 여부를 묻는 창이 뜨면 그대로 둔다.
  const ok = !!W.PostMessageW(h, WM_CLOSE, 0, 0);
  if (ok) return { ok };
  const err = W.GetLastError();
  return { ok, error: `닫기 요청을 보내지 못했습니다 (오류 ${err}${err === 5 ? ': 관리자 권한으로 실행된 창일 수 있음' : ''})` };
}

async function watch(){
  // 계속 실행하며 바뀐 것만 한 줄씩 알린다 (맥 도우미와 같은 모양)
  //   {"event":"front", "front":{...}}   맨 앞 창이 바뀔 때
  //   {"event":"alive", "wids":[...]}    1.5초마다 살아 있는 창 번호 목록
  let lastFront = -1, tick = 0;
  for (;;){
    const f = frontInfo();
    const key = `${f.wid ?? 0}:${f.dialog?.wid ?? 0}`;
    if (key !== lastFront){ lastFront = key; emit({ event: 'front', front: f }); }
    if (tick % 5 === 0) emit({ event: 'alive', wids: allWindows() });
    tick++;
    await new Promise(r => setTimeout(r, 300));
  }
}

async function clicks(){
  // 포인터 강조의 클릭 물결: 마우스를 누를 때마다 {"event":"click","x","y","button"} 한 줄 (물리 픽셀).
  // 듣기만 한다 — 클릭은 원래 프로그램에 그대로 간다. 저수준 훅(WH_MOUSE_LL)은 메시지 펌프가 멈추면 윈도우가 훅을 떼고
  // 마우스 전체가 느려질 수 있어, 10ms마다 버튼 상태를 살피는 방식을 골랐다 (아주 짧은 클릭은 "그사이 눌렸음" 표시로 잡는다).
  const VK = { left: 0x01, right: 0x02 }, SM_SWAPBUTTON = 23;
  const was = { left: false, right: false };
  const pt = new Int32Array(2);
  let tick = 0;
  emit({ event: 'ready' });
  for (;;){
    const swap = tick % 100 === 0 ? !!W.GetSystemMetrics(SM_SWAPBUTTON) : null;   // 왼손잡이 설정: 물리 버튼과 논리 버튼이 바뀜
    if (swap !== null) clicks.swap = swap;
    for (const phys of ['left', 'right']){
      const s = W.GetAsyncKeyState(VK[phys]) & 0xffff;
      const down = (s & 0x8000) !== 0, tapped = (s & 0x1) !== 0;
      if ((down && !was[phys]) || (!down && !was[phys] && tapped)){
        W.GetCursorPos(pt);
        const button = clicks.swap ? (phys === 'left' ? 'right' : 'left') : phys;
        emit({ event: 'click', x: pt[0], y: pt[1], button });
      }
      was[phys] = down;
    }
    // 앱이 갑자기 꺼져도 혼자 남지 않게
    if (tick % 200 === 0){ try { process.kill(process.ppid, 0); } catch { process.exit(0); } }
    tick++;
    await new Promise(r => setTimeout(r, 10));
  }
}

const args = process.argv.slice(2);
const cmd = args[0];
try {
  switch (cmd){
    case 'trusted':
      emit({ ok: true, trusted: true });   // 윈도우는 창을 다루는 데 따로 권한이 필요 없다
      break;
    case 'displays':
      emit({ ok: true, displays: displayList() });
      break;
    case 'list': {
      const i = args.indexOf('--app');
      const filter = i >= 0 ? args[i + 1] : undefined;
      const ds = displayList();
      emit({ ok: true, windows: allWindows(filter).map(h => winJSON(h, ds)) });
      break;
    }
    case 'front':
      emit({ ok: true, front: frontInfo() });
      break;
    case 'raise':
      emit(raise(findWin(args[1])));
      break;
    case 'move': {
      const [x, y, w, h] = args.slice(2, 6).map(Number);
      if (args.length < 6 || [x, y, w, h].some(v => !Number.isFinite(v))) fail('사용법: winctl move <wid> <x> <y> <width> <height>');
      emit(move(findWin(args[1]), { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) }));
      break;
    }
    case 'minimize':
      emit(minimize(findWin(args[1])));
      break;
    case 'close':
      emit(close(findWin(args[1])));
      break;
    case 'maximize':
      emit(maximize(findWin(args[1])));
      break;
    case 'closetab':
      if (!args[2]) fail('사용법: winctl closetab <wid> <파일 이름>');
      emit(closeTab(findWin(args[1]), args[2]));
      break;
    case 'findtab':
      if (!args[2]) fail('사용법: winctl findtab <wid> <파일 이름>');
      emit(findTab(findWin(args[1]), args[2]));
      break;
    case 'watch':
      await watch();
      break;
    case 'clicks':
      await clicks();
      break;
    default:
      fail(cmd ? `모르는 명령: ${cmd}` : '사용법: winctl <trusted|displays|list|front|raise|move|minimize|close|maximize|closetab|findtab|watch|clicks> ...');
  }
} catch (e){
  emit({ ok: false, error: e instanceof Fail ? e.message : `도우미 내부 오류: ${e.message}` });
  process.exitCode = 1;
}
