#!/usr/bin/env node
// 관리자 권한으로 실행된 프로그램 창을 다룰 수 있는지 시험 (윈도우 전용, 사람이 함께)
// 사람이 "명령 프롬프트"를 관리자 권한으로 직접 연다 (시작 → cmd 검색 → 관리자 권한으로 실행 → [예]).
// 실행기가 관리자 권한으로 여는 방식(Start-Process -Verb RunAs)은 1차 시도에서 창이 열리지 않아 쓰지 않는다
// (뒤에 있는 프로그램의 요청이면 윈도우가 허용 창을 작업 표시줄에서만 깜빡이게 하는 경우가 있다).
// 새로 생긴 창을 보통 권한의 도우미로 찾기·앞으로·옮기기·최소화·닫기 해 본다.
//
//   node runner/elevated.js

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
if (process.platform !== 'win32'){ console.log('윈도우 전용 시험입니다'); process.exit(1); }

function helper(...a){
  let out;
  try { out = execFileSync(process.execPath, [path.join(ROOT, 'win-helper/winctl.js'), ...a], { encoding: 'utf8', timeout: 20000 }); }
  catch (e) { out = e.stdout || ''; }
  return JSON.parse(out.trim().split(/\r?\n/).pop());
}
const fmt = r => r ? `${r.x},${r.y} ${r.width}×${r.height}` : '없음';

const before = new Set(helper('list').windows.map(w => w.wid));
console.log('"명령 프롬프트"를 관리자 권한으로 열어 주세요 (시작 → cmd 검색 → 관리자 권한으로 실행 → [예]). 3분까지 기다립니다.');

let win = null;
for (let i = 0; i < 360 && !win; i++){
  await sleep(500);
  // 명령 프롬프트 창만 고른다 (다른 프로그램 창을 옮기거나 닫지 않도록). 관리자 프로그램은 이름을 못 읽을 수도 있어 제목도 본다.
  win = helper('list').windows.find(w => !before.has(w.wid) &&
    (/^(cmd|WindowsTerminal|OpenConsole|conhost)\.exe$/i.test(w.app) || /관리자|Administrator|명령 프롬프트/.test(w.title))) ?? null;
}
if (!win){ console.log('새 창을 찾지 못했습니다 (3분이 지남)'); process.exit(1); }
await sleep(1500);   // 창 제목이 자리 잡을 시간
win = helper('list').windows.find(w => w.wid === win.wid) ?? win;
const wid = win.wid;
console.log(`\n① 찾기: 창 번호 ${wid} · 프로그램 이름 "${win.app}" · 제목 "${win.title}" · 위치 ${fmt(win)}`);

const r = helper('raise', String(wid));
console.log(`② 앞으로 가져오기: ${r.ok ? '성공' : '실패'} · 방법 ${r.detail?.method ?? '-'}`);

const target = { x: 300, y: 120, width: 700, height: 500 };
const m = helper('move', String(wid), ...Object.values(target).map(String));
console.log(`③ 옮기기 (요청 ${fmt(target)}): ${m.ok ? `보냄 → 실제 ${fmt(m.actual)}` : `실패 — ${m.error}`}`);

const n = helper('minimize', String(wid));
await sleep(500);
const afterMin = helper('list').windows.find(w => w.wid === wid);
console.log(`④ 최소화: ${n.ok && afterMin?.minimized ? '됨' : '안 됨'}`);
if (afterMin?.minimized) helper('raise', String(wid));

const c = helper('close', String(wid));
await sleep(2000);
const still = helper('list').windows.some(w => w.wid === wid);
console.log(`⑤ 닫기 요청: ${c.ok ? '보냄' : `보내지 못함${c.error ? ' — ' + c.error : ''}`} → 창 ${still ? '남아 있음' : '닫힘'}`);
if (still) console.log('\n관리자 권한 창이 아직 열려 있습니다. 직접 닫아 주세요.');
