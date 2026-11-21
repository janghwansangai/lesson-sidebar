// 자료를 원래 프로그램으로 연다 (맥). 프로그램은 LaunchServices(open)로 실행한다.
// 실행 파일을 직접 부르면 부른 쪽의 제한을 물려받아 제대로 뜨지 않을 수 있다 (docs/poc/mac.md).
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';

const BROWSERS = [
  { app: 'Google Chrome', match: 'Google Chrome', label: '크롬' },
  { app: 'Microsoft Edge', match: 'Microsoft Edge', label: '엣지' },
  { app: 'Whale', match: 'Whale', label: '웨일' },
];

export const APPS = {
  powerpoint: { app: 'Microsoft PowerPoint', match: 'PowerPoint', label: '파워포인트' },
  excel:      { app: 'Microsoft Excel',      match: 'Excel',      label: '엑셀' },
  hwp:        { app: 'Hancom Office HWP',    match: 'HWP',        label: '한글' },
  text:       { app: 'TextEdit',             match: 'TextEdit',   label: '텍스트 편집기' },
  // 정해진 프로그램이 없는 파일(워드 등)은 이 맥의 기본 프로그램으로 연다. 창은 파일 이름으로 찾는다
  default:    { app: null,                   match: null,         label: '기본 프로그램' },
};

export function pickBrowser(prefer){
  const order = prefer ? [...BROWSERS.filter(b => b.app === prefer), ...BROWSERS] : BROWSERS;
  return order.find(b => existsSync(`/Applications/${b.app}.app`)) ?? null;
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

/** 브라우저 새 창으로 연다 (-n: 이미 켜진 브라우저도 --new-window 인자를 받게). */
export function openInBrowser(browser, url){
  return open(['-na', browser.app, '--args', '--new-window', url]);
}

/** 파일을 지정한 프로그램으로 연다. 파일이 없으면 프로그램만 연다(빈 문서). */
export function openWithApp(app, file){
  if (!app.app) return open([file]);   // 기본 프로그램
  return open(file ? ['-a', app.app, file] : ['-a', app.app]);
}
