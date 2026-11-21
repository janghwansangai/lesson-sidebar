#!/usr/bin/env node
// "저장할까요?" 같은 창(모달)이 떠 있을 때 닫기 요청이 어떻게 되는지 시험 (윈도우 전용, 자동)
// 시험 자료를 poc/out/에 복사해 엑셀로 열고, 셀에 글자를 하나 넣어 "바뀐 문서"로 만든 뒤
// 닫기 요청(WM_CLOSE)을 보내 본다. poc/out/은 저장소에 올라가지 않으므로 저장돼도 괜찮다.
//
//   node runner/modal.js

import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as M from '../lib/match.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
if (process.platform !== 'win32'){ console.log('윈도우 전용 시험입니다'); process.exit(1); }

function helper(...a){
  let out;
  try { out = execFileSync(process.execPath, [path.join(ROOT, 'win-helper/winctl.js'), ...a], { encoding: 'utf8', timeout: 20000 }); }
  catch (e) { out = e.stdout || ''; }
  return JSON.parse(out.trim().split(/\r?\n/).pop());
}
const alive = wid => helper('list').windows.find(w => w.wid === wid) ?? null;
/** 맨 앞 창에 키를 보낸다 (PowerShell SendKeys). */
const keys = k => execFileSync('powershell.exe', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${k}')`]);
const desc = f => `${f.app} 창 ${f.wid} "${f.title}"${f.dialog ? ` · 대화 상자 "${f.dialog.title}" (창 번호 ${f.dialog.wid})` : ''}`;
const waitingOf = wid => { const w = alive(wid); return w?.waiting ? `답을 기다리는 창 있음: "${w.waiting.title}" (창 번호 ${w.waiting.wid})` : '답을 기다리는 창 없음'; };

const OUT = path.join(ROOT, 'out');
mkdirSync(OUT, { recursive: true });
const file = path.join(OUT, 'modal-test.xlsx');
copyFileSync(path.join(ROOT, 'samples', '샘플_모둠편성.xlsx'), file);

const before = new Set(helper('list', '--app', 'EXCEL.EXE').windows.map(w => w.wid));
spawn('cmd.exe', ['/d', '/s', '/c', `"start "" "${file}""`], { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true }).unref();
let win = null;
for (let i = 0; i < 60 && !win; i++){
  await sleep(500);
  win = M.findByTitle(helper('list', '--app', 'EXCEL.EXE').windows.filter(w => !before.has(w.wid)), 'modal-test')[0] ?? null;
}
if (!win){ console.log('엑셀 창을 찾지 못했습니다'); process.exit(1); }
const wid = win.wid;
console.log(`① 엑셀로 시험 파일을 열었습니다 (창 번호 ${wid})`);
await sleep(1500);

// ---- 바뀐 문서로 만들기 ----
const r = helper('raise', String(wid));
if (!r.ok){ console.log('엑셀 창을 앞으로 가져오지 못해 글자를 넣을 수 없습니다'); process.exit(1); }
keys('1{ENTER}');
await sleep(800);
console.log('② 셀에 글자 하나를 넣었습니다 (저장 안 된 문서)');

// ---- 1차 닫기 요청 ----
const c1 = helper('close', String(wid));
await sleep(2500);
const f1 = helper('front').front;
const w1 = alive(wid);
console.log(`③ 닫기 요청 1번 (보냄: ${c1.ok}) → 창 ${w1 ? '남아 있음' : '닫힘'} · 맨 앞: ${desc(f1)}`);
if (w1) console.log(`   목록: ${waitingOf(wid)}`);

// ---- 대화 상자가 떠 있는 동안 ----
if (w1){
  const c2 = helper('close', String(wid));
  await sleep(2000);
  const f2 = helper('front').front;
  console.log(`④ 대화 상자가 떠 있는 동안 닫기 요청 한 번 더 (보냄: ${c2.ok}) → 창 ${alive(wid) ? '남아 있음' : '닫힘'} · 맨 앞: ${desc(f2)}`);

  console.log(`   목록: ${waitingOf(wid)}`);
  // 엑셀 바탕 창을 앞으로 가져오면 무엇이 앞에 오는지
  const r2 = helper('raise', String(wid));
  console.log(`⑤ 대화 상자가 떠 있을 때 엑셀 창 앞으로 가져오기 → 결과 ${r2.ok ? '성공' : '실패'} · 맨 앞: ${desc(r2.front)}`);

  // ---- 정리: 기본 단추(저장)를 눌러 닫는다. 시험 복사본(poc/out)에 저장되므로 괜찮다 ----
  const f3 = helper('front').front;
  if (f3.wid === wid && f3.dialog){   // 키는 엑셀 대화 상자가 맨 앞일 때만 보낸다
    keys('{ENTER}');
    await sleep(3000);
  }
  console.log(`⑥ 정리: 대화 상자에서 기본 단추(저장) → 창 ${alive(wid) ? '아직 남아 있음 (손으로 닫아 주세요)' : '닫힘'}`);
}
