// 자료를 원래 프로그램으로 연다 (맥·윈도우).
// - 맥: LaunchServices(open)로 실행한다. 실행 파일을 직접 부르면 부른 쪽의 제한을 물려받아 제대로 뜨지 않을 수 있다 (docs/poc/mac.md).
// - 윈도우: 브라우저는 App Paths에 등록된 실행 파일을 --new-window로, 문서는 파일 연결(ShellExecute)로 연다 (docs/poc/windows.md 5).
//   match는 도우미 list --app에 넘기는 실행 파일 이름이다 (도우미가 대소문자 없이 포함 여부로 거른다).
import { execFile, execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const IS_WIN = process.platform === 'win32';

const BROWSERS = IS_WIN ? [
  { app: 'Google Chrome',  exe: 'chrome.exe', match: 'chrome.exe', label: '크롬' },
  { app: 'Microsoft Edge', exe: 'msedge.exe', match: 'msedge.exe', label: '엣지' },
  { app: 'Whale',          exe: 'whale.exe',  match: 'whale.exe',  label: '웨일' },
] : [
  { app: 'Google Chrome', match: 'Google Chrome', label: '크롬' },
  { app: 'Microsoft Edge', match: 'Microsoft Edge', label: '엣지' },
  { app: 'Whale', match: 'Whale', label: '웨일' },
];

export const APPS = IS_WIN ? {
  // ext: 빈 문서로 열 때 프로그램 위치를 파일 연결(assoc/ftype)에서 찾는다 (한글은 App Paths에 없다)
  powerpoint: { app: 'PowerPoint',  match: 'POWERPNT.EXE', ext: '.pptx', label: '파워포인트' },
  excel:      { app: 'Excel',       match: 'EXCEL.EXE',    ext: '.xlsx', label: '엑셀' },
  hwp:        { app: 'Hwp',         match: 'Hwp.exe',      ext: '.hwp',  label: '한글' },
  // 진행 메모(.md)는 연결된 프로그램이 없는 PC가 많아 메모장으로 직접 연다
  text:       { app: 'notepad.exe', match: 'notepad.exe',  exe: 'notepad.exe', label: '메모장' },
  // 정해진 프로그램이 없는 파일(워드 등)은 이 PC의 기본 프로그램으로 연다. 창은 파일 이름으로 찾는다
  default:    { app: null,          match: null,           label: '기본 프로그램' },
} : {
  powerpoint: { app: 'Microsoft PowerPoint', match: 'PowerPoint', label: '파워포인트' },
  excel:      { app: 'Microsoft Excel',      match: 'Excel',      label: '엑셀' },
  hwp:        { app: 'Hancom Office HWP',    match: 'HWP',        label: '한글' },
  text:       { app: 'TextEdit',             match: 'TextEdit',   label: '텍스트 편집기' },
  // 정해진 프로그램이 없는 파일(워드 등)은 이 맥의 기본 프로그램으로 연다. 창은 파일 이름으로 찾는다
  default:    { app: null,                   match: null,         label: '기본 프로그램' },
};

// ---------- 윈도우 도구 ----------
/** App Paths에 등록된 실행 파일 위치 (예: chrome.exe → C:\Program Files\…\chrome.exe). 없으면 null. */
function appPath(exe){
  for (const hive of ['HKCU', 'HKLM']){
    try {
      const out = execFileSync('reg.exe', ['query', `${hive}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exe}`, '/ve'],
        { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 });
      const m = out.match(/REG_(?:EXPAND_)?SZ\s+(.+)/);
      if (!m) continue;
      const p = m[1].trim().replace(/^"|"$/g, '').replace(/%([^%]+)%/g, (s, v) => process.env[v] ?? s);
      if (existsSync(p)) return p;
    } catch { /* 이 위치에 없음 */ }
  }
  return null;
}

/** 확장자에 연결된 프로그램 실행 파일 (예: .hwp → …\Hwp.exe). */
function assocExe(ext){
  const run = (...a) => execFileSync('cmd.exe', ['/d', '/c', ...a], { encoding: 'utf8', windowsHide: true, timeout: 5000 }).trim();
  const prog = run('assoc', ext).split('=')[1];
  const cmdline = run('ftype', prog).split('=').slice(1).join('=');
  return cmdline.match(/^"([^"]+)"/)?.[1] ?? cmdline.split(' ')[0];
}

/** 사이드바와 떨어진 독립 프로그램으로 실행한다 (인자는 Node가 따옴표 처리, cmd를 거치지 않음). */
function launch(exe, args, extra = {}){
  return new Promise((resolve, reject) => {
    const p = spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: false, ...extra });
    p.once('error', reject);
    p.once('spawn', () => { p.unref(); resolve(); });
  });
}

// 파일을 연결된 프로그램으로 여는 방법. 실제 앱(Electron)에서는 shell.openPath를 넣어 준다 (cmd 해석을 거치지 않음).
let fileOpener = null;
export function setFileOpener(fn){ fileOpener = fn; }

function shellOpen(file){
  if (fileOpener) return fileOpener(file);
  // Electron 밖(시험 등): cmd의 start(ShellExecute). 실행기(poc/runner/run.js)와 같은 방법
  const q = s => `"${String(s).replace(/"/g, '')}"`;
  return launch('cmd.exe', ['/d', '/s', '/c', `"start "" ${q(file)}"`], { windowsHide: true, windowsVerbatimArguments: true });
}

// ---------- 공통 ----------
export function pickBrowser(prefer){
  const order = prefer ? [...BROWSERS.filter(b => b.app === prefer), ...BROWSERS] : BROWSERS;
  if (!IS_WIN) return order.find(b => existsSync(`/Applications/${b.app}.app`)) ?? null;
  for (const b of order){
    const p = appPath(b.exe);
    if (p) return { ...b, path: p };
  }
  return null;
}

export function appKeyFor(item){
  switch (item.type){
    case 'pptx': case 'ppt': return 'powerpoint';
    case 'xlsx': case 'xls': return 'excel';
    case 'hwp': case 'hwpx': return 'hwp';
    case 'memo': return 'text';
    case 'file': return 'default';
    default: return 'browser';
  }
}

function open(args){
  return new Promise((resolve, reject) => execFile('open', args, { timeout: 15000 }, e => e ? reject(e) : resolve()));
}

/** 브라우저 새 창으로 연다 (맥 -n: 이미 켜진 브라우저도 --new-window 인자를 받게). */
export function openInBrowser(browser, url){
  if (IS_WIN) return launch(browser.path ?? browser.exe, ['--new-window', url]);
  return open(['-na', browser.app, '--args', '--new-window', url]);
}

/** 파일을 지정한 프로그램으로 연다. 파일이 없으면 프로그램만 연다(빈 문서). */
export function openWithApp(app, file){
  if (IS_WIN){
    if (app.exe) return launch(app.exe, file ? [file] : []);          // 메모장
    if (file) return shellOpen(file);                                   // 문서: 파일 연결(파워포인트·엑셀·한글·기본 프로그램)
    if (!app.ext) throw new Error('열 파일이 없습니다');
    let exe;
    try { exe = assocExe(app.ext); } catch { throw new Error(`${app.label}이(가) 설치되어 있지 않습니다 (${app.ext} 연결 프로그램 없음)`); }
    return launch(exe, []);
  }
  if (!app.app) return open([file]);   // 기본 프로그램
  return open(file ? ['-a', app.app, file] : ['-a', app.app]);
}
