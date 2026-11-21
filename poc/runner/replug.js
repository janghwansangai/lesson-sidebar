#!/usr/bin/env node
// 외부 모니터를 뺐다 다시 꽂는 시험 (사람이 함께 하는 시험, 맥·윈도우 공통)
// 브라우저 창 하나를 학생 화면에 놓고, 사람이 모니터 선을 뺐다가 다시 꽂는 동안
// 모니터 목록이 언제 바뀌는지, 창이 어디로 가는지, 다시 꽂으면 돌아오는지 기록한다.
//
//   node runner/replug.js

import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as M from '../lib/match.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IS_MAC = process.platform === 'darwin';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fmt = r => r ? `${r.x},${r.y} ${r.width}×${r.height}` : '없음';

function helper(...a){
  const [cmd, cargs] = IS_MAC
    ? [path.join(ROOT, 'mac-helper/.build/release/winctl'), a]
    : [process.execPath, [path.join(ROOT, 'win-helper/winctl.js'), ...a]];
  if (IS_MAC && !existsSync(cmd)) throw new Error('맥 도우미가 없습니다. 먼저 npm run build:mac');
  let out;
  try { out = execFileSync(cmd, cargs, { encoding: 'utf8', timeout: 20000 }); }
  catch (e) { out = e.stdout || ''; }
  const res = JSON.parse(out.trim().split(/\r?\n/).pop());
  if (res.ok === false) throw new Error(res.error || '도우미 오류');
  return res;
}
const displays = () => helper('displays').displays;
const MATCH = IS_MAC ? 'Google Chrome' : 'chrome.exe';
const findWin = wid => helper('list', '--app', MATCH).windows.find(w => w.wid === wid) ?? null;

function openChrome(){
  if (IS_MAC) execFileSync('open', ['-na', 'Google Chrome', '--args', '--new-window', 'about:blank']);
  else spawn('cmd.exe', ['/d', '/s', '/c', '"start "" "chrome.exe" "--new-window" "about:blank""'], { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true }).unref();
}

function where(w, ds){
  if (!w) return '창이 사라짐';
  const d = ds.find(d => d.index === M.displayOf(w, ds));
  return `${fmt(w)} · ${d ? `${d.name}${d.primary ? '(주 모니터)' : ''}` : '화면 밖'}${w.minimized ? ' · 최소화됨' : ''}`;
}

/** 창 위치가 1.5초 동안 그대로면 멈춘 것으로 본다 (운영체제가 창을 옮기는 중일 수 있다). */
async function settle(wid, max = 12000){
  const t0 = Date.now();
  let last = null, stableSince = Date.now();
  while (Date.now() - t0 < max){
    const w = findWin(wid);
    const key = w ? fmt(w) + w.minimized : 'gone';
    if (key !== last){ last = key; stableSince = Date.now(); }
    else if (Date.now() - stableSince >= 1500) return { w, ms: stableSince - t0 };
    await sleep(300);
  }
  return { w: findWin(wid), ms: null };
}

const ds0 = displays();
const student = M.pickStudentDisplay(ds0);
if (!student){ console.log('외부 모니터가 연결되어 있지 않습니다. 연결한 뒤 다시 실행해 주세요.'); process.exit(1); }
console.log(`모니터 ${ds0.length}개 · 학생 화면: ${student.name} (배율 ${student.scale})`);

const before = new Set(helper('list', '--app', MATCH).windows.map(w => w.wid));
openChrome();
let win = null;
for (let i = 0; i < 40 && !win; i++){ await sleep(500); win = helper('list', '--app', MATCH).windows.find(w => !before.has(w.wid)) ?? null; }
if (!win){ console.log('크롬 새 창을 찾지 못했습니다'); process.exit(1); }
const wid = win.wid;

const area = M.workArea(student);
const [left] = M.tileRects(area, 'half');
helper('move', String(wid), ...[left.x, left.y, left.width, left.height].map(String));
console.log(`\n① 크롬 창을 학생 화면 왼쪽 반에 놓았습니다: ${where(findWin(wid), ds0)}`);

// ---- 빼기 ----
console.log('\n▶ 이제 외부 모니터 선을 빼 주세요. (3분까지 기다립니다)');
let t0 = Date.now(), ds1 = null;
while (Date.now() - t0 < 180000){
  await sleep(500);
  let ds; try { ds = displays(); } catch { continue; }
  if (ds.length < ds0.length){ ds1 = ds; break; }
}
if (!ds1){ console.log('모니터가 빠진 것을 3분 동안 알아채지 못했습니다.'); helper('close', String(wid)); process.exit(1); }
console.log(`② 모니터 빠짐 감지 · 남은 모니터 ${ds1.length}개: ${ds1.map(d => d.name).join(', ')}`);
const s1 = await settle(wid);
console.log(`   창 위치: ${where(s1.w, displays())}${s1.ms !== null ? ` · 감지 후 ${s1.ms}ms에 자리 잡음` : ' · 12초 동안 계속 움직임'}`);

// ---- 다시 꽂기 ----
console.log('\n▶ 이제 외부 모니터 선을 다시 꽂아 주세요. (3분까지 기다립니다)');
t0 = Date.now(); let ds2 = null;
while (Date.now() - t0 < 180000){
  await sleep(500);
  let ds; try { ds = displays(); } catch { continue; }
  if (ds.length >= ds0.length){ ds2 = ds; break; }
}
if (!ds2){ console.log('모니터가 다시 꽂힌 것을 3분 동안 알아채지 못했습니다.'); helper('close', String(wid)); process.exit(1); }
const back = M.pickStudentDisplay(ds2);
console.log(`③ 모니터 다시 연결 감지 · ${ds2.length}개 · 학생 화면: ${back?.name ?? '없음'} (위치 ${back ? `${back.x},${back.y}` : '-'}, 배율 ${back?.scale ?? '-'})`);
await sleep(1000);
const s2 = await settle(wid, 15000);
const returned = s2.w && back && M.displayOf(s2.w, ds2) === back.index;
console.log(`   창 위치: ${where(s2.w, ds2)} → ${returned ? '운영체제가 학생 화면으로 되돌려 놓음' : '학생 화면으로 돌아가지 않음'}`);

// ---- 사이드바가 하듯이 다시 놓기 ----
if (back && s2.w){
  const [l2] = M.tileRects(M.workArea(back), 'half');
  const r = helper('move', String(wid), ...[l2.x, l2.y, l2.width, l2.height].map(String));
  console.log(`④ 사이드바처럼 학생 화면 왼쪽 반에 다시 놓기: ${M.rectClose(r.actual, l2, 24) ? '맞음' : '어긋남'} (${fmt(r.actual)})`);
}

await sleep(1500);
try { helper('close', String(wid)); } catch {}
console.log('\n시험한 크롬 창을 닫았습니다.');
