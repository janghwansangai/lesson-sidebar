#!/usr/bin/env node
// 수업 사이드바 — 윈도우 창 관리 도우미 (0단계 기술 검증)
// 규격: docs/poc/helper-protocol.md. 맥 도우미(poc/mac-helper)와 같은 명령, 같은 JSON 출력을 지킨다.
//
//   node winctl.js trusted | displays | list [--app <이름 일부>] | front
//   node winctl.js raise <wid> | move <wid> <x> <y> <width> <height> | minimize <wid> | close <wid>
//   node winctl.js watch          (계속 실행하며 바뀐 것만 한 줄씩 알림)
//
// 출력: 표준 출력 마지막 줄에 JSON 하나. 실패하면 {"ok":false,"error":"…"} + 종료 코드 1.
// 좌표: 물리 픽셀, 주 모니터 왼쪽 위가 (0, 0). 이 프로세스를 Per-Monitor DPI Aware V2로 설정해
//       배율이 다른 모니터에서도 좌표가 어긋나지 않게 한다. 창 위치는 그림자를 뺀 실제 테두리 기준.
// 안전: 닫기는 WM_CLOSE(정상 종료 요청)만 보낸다. 강제 종료하지 않는다.

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
};

const GW_OWNER = 4, GA_ROOT = 2, GWL_EXSTYLE = -20;
const WS_EX_TOOLWINDOW = 0x80, WS_EX_APPWINDOW = 0x40000;
const DWMWA_EXTENDED_FRAME_BOUNDS = 9, DWMWA_CLOAKED = 14;
const SW_RESTORE = 9, SW_MINIMIZE = 6;
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
function exeName(pid){
  if (exeCache.has(pid)) return exeCache.get(pid);
  let name = '';
  const hp = num(W.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid));
  if (hp){
    const b = Buffer.alloc(2048), size = [1024];
    if (W.QueryFullProcessImageNameW(hp, 0, b, size)) name = b.toString('utf16le', 0, size[0] * 2).split('\\').pop();
    W.CloseHandle(hp);
  }
  exeCache.set(pid, name);
  return name;
}

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

function winJSON(h, ds){
  const minimized = !!W.IsIconic(h), maximized = !!W.IsZoomed(h);
  const r = minimized ? restoredRect(h, ds) : xywh(frameRect(h));
  const pid = pidOf(h);
  const mon = ds[displayIndex(r, ds)];
  // 윈도우에는 맥 같은 "전체 화면" 상태가 따로 없다. 최대화가 아니면서 모니터 전체를 덮으면 전체 화면으로 본다 (슬라이드 쇼, F11).
  const fullscreen = !minimized && !maximized && !!mon && r.x <= mon.x && r.y <= mon.y && r.x + r.width >= mon.x + mon.width && r.y + r.height >= mon.y + mon.height;
  return { wid: h, pid, app: exeName(pid), title: title(h), ...r, minimized, maximized, fullscreen, display: displayIndex(r, ds) };
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

function close(h){
  // 정상 종료 요청만 보낸다. 저장 여부를 묻는 창이 뜨면 그대로 둔다.
  return { ok: !!W.PostMessageW(h, WM_CLOSE, 0, 0) };
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
    case 'watch':
      await watch();
      break;
    default:
      fail(cmd ? `모르는 명령: ${cmd}` : '사용법: winctl <trusted|displays|list|front|raise|move|minimize|close|watch> ...');
  }
} catch (e){
  emit({ ok: false, error: e instanceof Fail ? e.message : `도우미 내부 오류: ${e.message}` });
  process.exitCode = 1;
}
