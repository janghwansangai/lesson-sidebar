// 만든 설치판을 실제로 켜서 예시 수업까지 열리는지 확인한다 (맥 .app, 윈도우 .exe).
// 2026-11-21에 겪은 두 문제를 다시 잡기 위한 검사다:
//   ① 공통 로직(poc/lib)이 앱 안에 빠져 켜자마자 멈춤
//   ② 실행 파일 이름이 한글이면 Electron이 준비 단계에서 멈춤
// 윈도우는 하나 더: ③ 창 관리 도우미(winctl.js + koffi)가 앱 안에 들어 있고,
//   앱 실행 파일을 Node로 돌리는 기능(ELECTRON_RUN_AS_NODE)이 꺼지지 않았는지
// 사용: npm run dist:mac:dir (또는 dist:win:dir) && node scripts/smoke-packaged.mjs [실행 파일 경로]
//   경로를 주면 그 실행 파일을 켠다 (예: 설치한 %LOCALAPPDATA%\Programs\…\LessonSidebar.exe)
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const IS_WIN = process.platform === 'win32';
const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = process.argv[2] ? path.resolve(process.argv[2])
  : IS_WIN ? path.join(APP_DIR, 'dist', 'win-unpacked', 'LessonSidebar.exe')
  : path.join(APP_DIR, 'dist', 'mac-arm64', 'LessonSidebar.app', 'Contents', 'MacOS', 'LessonSidebar');
// 설정 폴더 이름은 package.json의 productName("수업 사이드바")
const userData = IS_WIN ? path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), '수업 사이드바')
  : path.join(os.homedir(), 'Library', 'Application Support', '수업 사이드바');
const debugFile = path.join(userData, 'debug.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fail = m => { console.error(`실패: ${m}`); process.exitCode = 1; };

if (!existsSync(bin)) { fail(`앱이 없습니다: ${bin} (먼저 npm run dist:${IS_WIN ? 'win' : 'mac'}:dir)`); process.exit(); }

// ③ 윈도우: 앱 실행 파일로 도우미를 직접 돌려 본다 (앱이 도우미를 부르는 방법과 같음)
//   설치 없이 켜는 파일(portable.exe)은 켤 때 임시 폴더에 풀리므로 옆에 resources가 없다 → 켜진 앱으로만 확인
const script = path.join(path.dirname(bin), 'resources', 'win-helper', 'winctl.js');
if (IS_WIN && existsSync(script)){
  const r = spawnSync(bin, [script, 'displays'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 30000 });
  let out = null;
  try { out = JSON.parse(r.stdout.trim().split('\n').pop()); } catch { /* 아래에서 실패 */ }
  if (!out?.ok || !out.displays?.length) { fail(`창 관리 도우미가 앱 안에서 돌지 않습니다: ${(r.stdout || r.stderr || r.error?.message || '').trim().slice(0, 300)}`); process.exit(); }
  console.log(`통과: 창 관리 도우미가 앱 안에서 돕니다 (모니터 ${out.displays.length}개)`);
}

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
  // 교사 화면 이름은 앱이 도우미의 displays로 읽은 것 → 켜진 앱 안에서 도우미가 돈다는 뜻
  if (s.teacherName == null) fail('앱이 창 관리 도우미로 화면 목록을 읽지 못했습니다');
  else console.log(`통과: 앱이 도우미로 화면을 읽었습니다 (교사 화면: ${s.teacherName || '이름 없음'}${s.studentName ? `, 학생 화면: ${s.studentName}` : ''})`);
  const p = await (await fetch(`${url}/prep?do=open`)).json();
  if (!p.library) fail('수업 준비 화면 상태를 읽지 못했습니다');
  else console.log('통과: 수업 준비 화면이 열렸습니다');
  await fetch(`${url}/act?do=quit`).catch(() => {});
  for (let i = 0; i < 20 && exited === null; i++) await sleep(250);
  if (exited === null) child.kill();
}
rmSync(debugFile, { force: true });
