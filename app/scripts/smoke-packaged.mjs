// 만든 설치판(.app)을 실제로 켜서 예시 수업까지 열리는지 확인한다.
// 2026-11-21에 겪은 두 문제를 다시 잡기 위한 검사다:
//   ① 공통 로직(poc/lib)이 앱 안에 빠져 켜자마자 멈춤
//   ② 실행 파일 이름이 한글이면 Electron이 준비 단계에서 멈춤
// 사용: npm run dist:mac:dir && node scripts/smoke-packaged.mjs
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = path.join(APP_DIR, 'dist', 'mac-arm64', 'LessonSidebar.app', 'Contents', 'MacOS', 'LessonSidebar');
const userData = path.join(os.homedir(), 'Library', 'Application Support', '수업 사이드바');
const debugFile = path.join(userData, 'debug.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fail = m => { console.error(`실패: ${m}`); process.exitCode = 1; };

if (!existsSync(bin)) { fail(`앱이 없습니다: ${bin} (먼저 npm run dist:mac:dir)`); process.exit(); }
rmSync(debugFile, { force: true });

const child = spawn(bin, [], { env: { ...process.env, SIDEBAR_DEBUG: '1' }, stdio: 'ignore' });
let exited = null;
child.on('exit', (code, sig) => { exited = sig ?? code; });

let url = null;
for (let i = 0; i < 120 && exited === null && !url; i++){
  await sleep(500);
  try { url = JSON.parse(readFileSync(debugFile, 'utf8')).url; } catch { /* 아직 */ }
}
if (!url){
  fail(exited !== null ? `앱이 켜지다 꺼졌습니다 (${exited})` : '60초 안에 준비되지 않았습니다');
  child.kill();
} else {
  const s = await (await fetch(`${url}/state`)).json();
  const items = s.lesson?.sections?.flatMap(x => x.items) ?? [];
  const bad = items.filter(i => i.problem);
  if (!s.lesson) fail('수업을 불러오지 못했습니다');
  else if (bad.length) fail(`자료 문제: ${bad.map(i => `${i.title}: ${i.problem}`).join(', ')}`);
  else console.log(`통과: '${s.lesson.title}' 자료 ${items.length}개를 불러왔습니다`);
  const p = await (await fetch(`${url}/prep?do=open`)).json();
  if (!p.library) fail('수업 준비 화면 상태를 읽지 못했습니다');
  else console.log('통과: 수업 준비 화면이 열렸습니다');
  await fetch(`${url}/act?do=quit`).catch(() => {});
  for (let i = 0; i < 20 && exited === null; i++) await sleep(250);
  if (exited === null) child.kill();
}
rmSync(debugFile, { force: true });
