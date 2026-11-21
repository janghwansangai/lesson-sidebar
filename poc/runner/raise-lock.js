#!/usr/bin/env node
// 윈도우 "앞으로 가져오기 제한" 시험 (사람이 함께 하는 시험)
// 윈도우는 사용자가 방금 다른 프로그램을 쓰고 있으면, 맨 앞이 아닌 프로그램이 창을 앞으로 가져오는 것을 막는다.
// 자동 실행기(run.js)는 아무도 키보드·마우스를 만지지 않을 때 돌아서 이 제한이 걸리지 않았다.
// 이 시험은 사람이 다른 창에 글자를 치는 도중에 앞으로 가져오기를 해 본다.
//
//   node runner/raise-lock.js            (크롬 창 하나를 열고 시험한 뒤 닫는다)
//   node runner/raise-lock.js --browser=edge

import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXE = { chrome: 'chrome.exe', edge: 'msedge.exe', whale: 'whale.exe' };
const browser = process.argv.find(a => a.startsWith('--browser='))?.split('=')[1] ?? 'chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));

if (process.platform !== 'win32'){ console.log('윈도우 전용 시험입니다'); process.exit(1); }

function helper(...a){
  let out;
  try { out = execFileSync(process.execPath, [path.join(ROOT, 'win-helper/winctl.js'), ...a], { encoding: 'utf8', timeout: 20000 }); }
  catch (e) { out = e.stdout || ''; }
  return JSON.parse(out.trim().split(/\r?\n/).pop());
}

const before = new Set(helper('list', '--app', EXE[browser]).windows.map(w => w.wid));
const line = `start "" "${EXE[browser]}" "--new-window" "about:blank"`;
spawn('cmd.exe', ['/d', '/s', '/c', `"${line}"`], { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true }).unref();

let win = null;
for (let i = 0; i < 40 && !win; i++){
  await sleep(500);
  win = helper('list', '--app', EXE[browser]).windows.find(w => !before.has(w.wid)) ?? null;
}
if (!win){ console.log('브라우저 새 창을 찾지 못했습니다'); process.exit(1); }

console.log('\n브라우저 창을 하나 열었습니다.');
console.log('지금 메모장(또는 아무 프로그램)을 클릭하고, 아래 숫자가 끝날 때까지 키보드를 계속 눌러 주세요.\n');
for (let s = 8; s > 0; s--){ process.stdout.write(`  ${s}… `); await sleep(1000); }
console.log('\n');

const fgBefore = helper('front').front;
const r = helper('raise', String(win.wid));
const tried = (r.detail?.tried ?? []).map(t => `${t.method}:${t.front ? '성공' : '실패'}`).join(', ');
console.log(`시험 전 맨 앞: ${fgBefore.app}`);
console.log(`결과: ${r.ok ? '앞으로 가져오기 성공' : '실패 (작업 표시줄 단추만 깜빡였을 수 있음)'} · 통한 방법 ${r.detail?.method ?? '없음'} · 시도 ${tried} · ${r.ms}ms`);

await sleep(1500);
helper('close', String(win.wid));
console.log('\n시험한 창을 닫았습니다. 위 "결과" 줄을 Claude에게 알려 주세요.');
