#!/usr/bin/env node
// "저장할까요?" 같은 창(모달)이 떠 있을 때 닫기 요청이 어떻게 되는지 시험 (윈도우·맥, 자동)
// 시험 자료를 poc/out/에 새 이름으로 복사해 열고, 글자를 하나 넣어 "바뀐 문서"로 만든 뒤
// 닫기 요청을 보내 본다. poc/out/은 저장소에 올라가지 않으므로 저장돼도 괜찮다. 끝나면 복사본은 지운다.
// 창 제목은 출력하지 않는다 (폴더 경로·프로필 이름이 들어갈 수 있음).
//
//   node runner/modal.js              엑셀로 시험
//   node runner/modal.js --app=hwp    한글로 시험
//
// 맥: 글자는 키보드 이벤트로 넣는다 (손쉬운 사용 권한 필요, 도우미와 같음). 키는 시험 창이 맨 앞일 때만 보낸다.

import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as M from '../lib/match.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const IS_MAC = process.platform === 'darwin', IS_WIN = process.platform === 'win32';
if (!IS_MAC && !IS_WIN){ console.log('윈도우·맥에서만 돌아가는 시험입니다'); process.exit(1); }

const APPS = {
  excel: { label: '엑셀', sample: '샘플_모둠편성.xlsx', mac: { match: 'Excel', app: 'Microsoft Excel' }, win: { match: 'EXCEL.EXE' } },
  hwp:   { label: '한글', sample: '샘플_한글문서.hwp',  mac: { match: 'HWP',   app: 'Hancom Office HWP' }, win: { match: 'Hwp.exe' } },
};
const key = (process.argv.find(a => a.startsWith('--app=')) ?? '--app=excel').slice(6);
const A = APPS[key];
if (!A){ console.log(`모르는 프로그램: ${key} (excel, hwp 중 하나)`); process.exit(1); }
const OS = IS_MAC ? A.mac : A.win;

const MAC_HELPER = path.join(ROOT, 'mac-helper/.build/release/winctl');
function helper(...a){
  let out;
  const [bin, args] = IS_MAC ? [MAC_HELPER, a] : [process.execPath, [path.join(ROOT, 'win-helper/winctl.js'), ...a]];
  try { out = execFileSync(bin, args, { encoding: 'utf8', timeout: 20000 }); }
  catch (e) { out = e.stdout || ''; }
  return JSON.parse(out.trim().split(/\r?\n/).pop());
}
const alive = wid => helper('list').windows.find(w => w.wid === wid) ?? null;

/** 맨 앞 창에 키를 보낸다. 윈도우: PowerShell SendKeys, 맥: 키보드 이벤트(CGEvent, osascript). */
const MAC_KEYCODE = { '1': 18, enter: 36, escape: 53 };
function keys(list){
  if (IS_WIN){
    const k = list.map(x => ({ enter: '{ENTER}', escape: '{ESC}' })[x] ?? x).join('');
    execFileSync('powershell.exe', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${k}')`]);
  } else {
    const codes = list.map(x => MAC_KEYCODE[x]);
    const js = `ObjC.import('CoreGraphics'); for (const c of ${JSON.stringify(codes)}){ $.CGEventPost(0, $.CGEventCreateKeyboardEvent(null, c, true)); $.CGEventPost(0, $.CGEventCreateKeyboardEvent(null, c, false)); delay(0.15); }`;
    execFileSync('osascript', ['-l', 'JavaScript', '-e', js]);
  }
}
function openDoc(file){
  if (IS_MAC) execFileSync('open', ['-a', OS.app, file]);
  else spawn('cmd.exe', ['/d', '/s', '/c', `"start "" "${file}""`], { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true }).unref();
}
const desc = f => `${f.app} 창 ${f.wid}${f.dialog ? ` · 대화 상자 (창 번호 ${f.dialog.wid})` : ''}`;
const waitingOf = w => w?.waiting ? `답을 기다리는 창 있음 (창 번호 ${w.waiting.wid})` : '답을 기다리는 창 없음';

const OUT = path.join(ROOT, 'out');
mkdirSync(OUT, { recursive: true });
// 매번 새 이름: 같은 문서가 이미 열려 있으면 새 창이 생기지 않기 때문 (docs/poc/mac.md)
const stamp = new Date().toTimeString().slice(0, 8).replace(/:/g, '');
const file = path.join(OUT, `modal-test-${stamp}${path.extname(A.sample)}`);
copyFileSync(path.join(ROOT, 'samples', A.sample), file);

const listed = helper('list', '--app', OS.match).windows;
const before = new Set(listed.map(w => w.wid));
const waitingBefore = new Set(listed.filter(w => w.waiting).map(w => w.wid));   // 시험 전부터 답을 기다리던 창
openDoc(file);
let win = null;
for (let i = 0; i < 60 && !win; i++){
  await sleep(500);
  win = M.findByTitle(helper('list', '--app', OS.match).windows.filter(w => !before.has(w.wid)), M.stem(file))[0] ?? null;
}
if (!win){ console.log(`${A.label} 창을 찾지 못했습니다`); process.exit(1); }
const wid = win.wid;
console.log(`① ${A.label}로 시험 파일 복사본을 열었습니다 (창 번호 ${wid}) · ${waitingOf(win)}`);
await sleep(1500);

// ---- 바뀐 문서로 만들기 ----
const r = helper('raise', String(wid));
if (!r.ok || r.front?.wid !== wid){ console.log(`${A.label} 창을 앞으로 가져오지 못해 글자를 넣을 수 없습니다`); process.exit(1); }
keys(['1', 'enter']);
await sleep(800);
console.log('② 글자 하나를 넣었습니다 (저장 안 된 문서)');

// ---- 1차 닫기 요청: 저장 창이 뜨기까지 걸린 시간을 잰다 ----
const c1 = helper('close', String(wid));
const t0 = Date.now();
let w1 = alive(wid);
while (w1 && !w1.waiting && Date.now() - t0 < 8000){ await sleep(250); w1 = alive(wid); }
const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`③ 닫기 요청 1번 (보냄: ${c1.ok}) → 창 ${w1 ? '남아 있음' : '닫힘'} · ${w1 ? `${waitingOf(w1)} · ${secs}초 뒤` : `${secs}초`}`);
console.log(`   맨 앞: ${desc(helper('front').front)}`);

// ---- 대화 상자가 떠 있는 동안 ----
if (w1){
  const c2 = helper('close', String(wid));
  await sleep(2000);
  const w2 = alive(wid);
  const again = w2?.waiting && w1.waiting && w2.waiting.wid !== w1.waiting.wid ? ' · 대화 상자 번호가 바뀜 (하나 더 생겼을 수 있음)' : '';
  console.log(`④ 대화 상자가 떠 있는 동안 닫기 요청 한 번 더 (보냄: ${c2.ok}) → 창 ${w2 ? '남아 있음' : '닫힘'} · ${waitingOf(w2)}${again}`);
  console.log(`   맨 앞: ${desc(helper('front').front)}`);

  // 바탕 창을 앞으로 가져오면 무엇이 앞에 오는지
  const r2 = helper('raise', String(wid));
  console.log(`⑤ 대화 상자가 떠 있을 때 ${A.label} 창 앞으로 가져오기 → 결과 ${r2.ok ? '성공' : '실패'} · 맨 앞: ${desc(r2.front)}`);

  // ---- 정리 ----
  // 대화 상자가 여러 개일 수 있다 (맥 한글은 닫기를 또 보내면 하나 더 생기고, 문서가 닫힌 뒤에도 남아 다른 한글 창까지 막는다).
  // 그래서 먼저 모두 취소(Esc)하고 → 닫기를 한 번만 보내고 → 그 대화 상자에서 기본 단추(저장)를 누른다.
  // 키는 시험 창의 대화 상자가 맨 앞일 때만 보낸다. 시험 복사본(poc/out)에 저장되므로 괜찮다.
  const dialogInFront = () => { helper('raise', String(wid)); const f = helper('front').front; return f.wid === wid && !!f.dialog; };
  let cancels = 0, saved = false;
  for (let i = 0; i < 4 && alive(wid)?.waiting && dialogInFront(); i++){ keys(['escape']); cancels++; await sleep(1200); }
  if (alive(wid) && !alive(wid).waiting){
    helper('close', String(wid));
    let w = alive(wid); const t = Date.now();
    while (w && !w.waiting && Date.now() - t < 8000){ await sleep(250); w = alive(wid); }
    if (w?.waiting && dialogInFront()){ keys(['enter']); saved = true; await sleep(2500); }
  }
  const left = alive(wid);
  console.log(`⑥ 정리: 대화 상자 취소 ${cancels}번 → 닫기 한 번 → 기본 단추(저장) ${saved ? '누름' : '못 누름'} → 창 ${left ? '아직 남아 있음 (손으로 닫아 주세요)' : '닫힘'}`);
}
// 시험 창이 닫힌 뒤 같은 프로그램의 다른 창에 답을 기다리는 창이 새로 남았는지 (프로그램 전체를 막는 대화 상자)
const stuck = helper('list', '--app', OS.match).windows.filter(w => w.waiting && !waitingBefore.has(w.wid));
if (stuck.length) console.log(`   주의: ${A.label}의 다른 창 ${stuck.length}개에 답을 기다리는 창이 남아 있습니다 (손으로 닫아 주세요)`);
if (!alive(wid)){ try { unlinkSync(file); } catch { /* 다음 실행 때 */ } }
