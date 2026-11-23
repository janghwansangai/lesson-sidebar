// 업데이트를 받아 바꿔 깔기 (선생님 요청 2026-11-22: "업데이트 확인을 눌러 새 버전이 나오면 업데이트할 수 있게").
// - 맥: 설치판(.dmg)을 앱이 직접 받아 열고(브라우저를 거치지 않아 '인터넷에서 받은 파일' 경고가 붙지 않음), 새 앱의 서명이
//   지금 앱과 **같은 인증서**인지 확인한 뒤 응용 프로그램 폴더 옆에 복사해 둔다. 사이드바가 끝나면 작은 스크립트가 이름만 바꿔
//   새 앱으로 갈아 끼우고 다시 켠다. 옛 앱은 다음에 켤 때 휴지통으로 (cleanupOldApps).
//   같은 인증서라 손쉬운 사용·화면 기록 권한이 그대로 남는다 (docs/poc/mac.md 33). 다른 서명이면 깔지 않는다.
// - 윈도우: 설치 .exe를 받아 사이드바가 끝난 뒤 실행한다 (설치 프로그램이 바꿔 깔고 다시 켬). 설치 없이 켜는 판은 예전처럼 브라우저로.
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const run = (cmd, args, opts = {}) => new Promise((resolve, reject) =>
  execFile(cmd, args, { timeout: 180000, maxBuffer: 4 << 20, ...opts }, (e, so, se) => e ? reject(Object.assign(e, { stderr: String(se ?? '') })) : resolve({ out: String(so ?? ''), err: String(se ?? '') })));

/**
 * 파일 하나를 받는다. onProgress(퍼센트 또는 null, 받은 바이트, 전체 바이트).
 * expected(바이트)를 주면 크기가 다를 때 오류. sha256(16진수 64자)을 주면 받은 내용의 지문이 다를 때 오류
 * (중간에 깨지거나 바뀐 설치 파일을 실행하지 않게 — 다르면 다시 받고, 그래도 다르면 깔지 않는다).
 * 실패하면 잠시 기다렸다가 다시 받는다 (waits: 기다릴 초) — GitHub는 설치판을 막 올린 뒤 몇 분 동안 HTTP 400을 주기도 했다 (docs/poc/mac.md 75)
 */
export async function download(url, file, { waits = [10, 30], sleep = s => new Promise(r => setTimeout(r, s * 1000)), onRetry, ...o } = {}){
  for (let i = 0; ; i++){
    try { return await downloadOnce(url, file, o); }
    catch (e){
      if (i >= waits.length) throw e;
      onRetry?.(i + 1, e);
      await sleep(waits[i]);
    }
  }
}
async function downloadOnce(url, file, { fetchFn = fetch, onProgress, expected = null, sha256 = null, timeoutMs = 20 * 60000 } = {}){
  // cache 'no-store': 120MB 설치판을 브라우저 캐시에 남기지 않고, 예전에 받은 것을 다시 쓰지도 않는다 (시험에서 옛 파일이 나왔다)
  const r = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' });
  if (!r.ok){
    const body = await r.text().catch(() => '');
    throw Object.assign(new Error(`HTTP ${r.status}`), { detail: `${r.url || url} ${body.replace(/\s+/g, ' ').slice(0, 400)}` });
  }
  const total = Number(r.headers.get('content-length')) || expected || 0;
  mkdirSync(path.dirname(file), { recursive: true });
  const out = createWriteStream(file);
  const closed = new Promise((res, rej) => { out.on('close', res); out.on('error', rej); });
  let got = 0, last = -1;
  const hash = sha256 ? createHash('sha256') : null;
  try {
    const reader = r.body.getReader();
    for (;;){
      const { done, value } = await reader.read();
      if (done) break;
      got += value.length;
      hash?.update(value);
      if (!out.write(value)) await new Promise(res => out.once('drain', res));
      const pct = total ? Math.min(100, Math.floor(got * 100 / total)) : null;
      if (pct !== last){ last = pct; onProgress?.(pct, got, total); }
    }
  } finally { out.end(); await closed; }
  if (expected && got !== expected) throw new Error(`받은 크기가 맞지 않습니다 (${got} / ${expected})`);
  if (hash && hash.digest('hex') !== String(sha256).toLowerCase()) throw new Error('받은 파일의 지문(SHA-256)이 GitHub에 올린 것과 다릅니다');
  return got;
}

// ---------- 맥 ----------
/** 앱의 서명 요건 (예: identifier "…" and certificate leaf = H"…"). 서명이 없으면 null */
export async function designated(appPath){
  try {
    const { out, err } = await run('codesign', ['-d', '-r-', appPath]);
    const m = `${out}\n${err}`.match(/designated => (.+)/);
    return m ? m[1].trim() : null;
  } catch { return null; }
}

/** 지금 실행 중인 앱 묶음(.app) — 응용 프로그램 폴더처럼 바꿀 수 있는 곳에 있을 때만, 아니면 null */
export function currentMacApp(exePath){
  const P = path.posix;   // 맥 전용 (윈도우 검사에서 테스트가 돌 때도 맥 경로로)
  const app = P.resolve(exePath, '..', '..', '..');
  if (!app.endsWith('.app') || app.startsWith('/Volumes/')) return null;
  return app;
}

/** 옛 앱·바꾸다 남은 것: /Applications/.LessonSidebar.old-….app, .LessonSidebar.updating.app */
export const leftovers = (dest, names) => {
  const P = path.posix;   // 맥 전용
  const base = P.basename(dest, '.app');
  return names.filter(n => n.startsWith(`.${base}.old-`) && n.endsWith('.app')).map(n => P.join(P.dirname(dest), n));
};

/**
 * 받은 .dmg를 열어 새 앱을 확인하고, 지금 앱 옆(같은 폴더, 숨긴 이름)에 복사해 둔다.
 * @returns 복사해 둔 새 앱 경로 (끝날 때 startMacSwap으로 갈아 끼움)
 */
export async function stageMacUpdate(dmg, { currentApp, version, workDir }){
  const mnt = path.join(workDir, 'mnt');
  mkdirSync(mnt, { recursive: true });
  await run('hdiutil', ['attach', dmg, '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mnt]);
  const staged = path.join(path.dirname(currentApp), `.${path.basename(currentApp, '.app')}.updating.app`);
  try {
    const name = readdirSync(mnt).find(n => n.endsWith('.app'));
    if (!name) throw new Error('설치판 안에 앱이 없습니다');
    const newApp = path.join(mnt, name);
    await run('codesign', ['--verify', '--deep', '--strict', newApp]);
    const want = await designated(currentApp), got = await designated(newApp);
    if (!want || want !== got) throw new Error('새 버전의 서명이 지금 앱과 달라 바꿔 깔지 않았습니다');
    const v = (await run('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', path.join(newApp, 'Contents', 'Info.plist')])).out.trim();
    if (v !== version) throw new Error(`설치판 버전(${v})이 새 버전 알림(${version})과 다릅니다`);
    rmSync(staged, { recursive: true, force: true });
    await run('ditto', [newApp, staged]);
    return staged;
  } catch (e){
    rmSync(staged, { recursive: true, force: true });
    throw e;
  } finally {
    await run('hdiutil', ['detach', mnt, '-quiet']).catch(() => run('hdiutil', ['detach', mnt, '-force', '-quiet']).catch(() => {}));
  }
}

// 사이드바(pid)가 끝나기를 30초까지 기다렸다가, 이름만 바꿔 새 앱으로 갈아 끼우고 다시 켠다.
// 옛 앱은 지우지 않고 .<이름>.old-<시각>.app으로 남긴다 (다음에 켤 때 휴지통으로). 안 되면 옛 앱 그대로 다시 켠다.
export const MAC_SWAP = `
pid="$1"; staged="$2"; dest="$3"; relaunch="$4"
for i in $(seq 1 150); do kill -0 "$pid" 2>/dev/null || break; sleep 0.2; done
if kill -0 "$pid" 2>/dev/null; then exit 1; fi
old="$(dirname "$dest")/.$(basename "$dest" .app).old-$(date +%Y%m%d%H%M%S).app"
if mv "$dest" "$old"; then
  if ! mv "$staged" "$dest"; then mv "$old" "$dest"; fi
fi
if [ "$relaunch" = 1 ]; then open "$dest"; fi
`;
export function startMacSwap({ pid, staged, dest, relaunch = true }){
  spawn('/bin/bash', ['-c', MAC_SWAP, 'swap', String(pid), staged, dest, relaunch ? '1' : '0'], { detached: true, stdio: 'ignore' }).unref();
}

// ---------- 윈도우 ----------
/**
 * 받은 설치 프로그램을 바로 실행한다. 실행되면 resolve, 막히면(보안 프로그램 등) reject.
 * - cmd.exe를 거치지 않는다: 예전에는 cmd로 3초 기다렸다 실행했는데, V3가 "서명 없는 앱이 cmd로 받은 파일을 실행"을
 *   악성 행위(MDP.Event)로 막아 업데이트가 되지 않았다 (2026-11-23 윈도우, docs/poc/windows.md "업데이트").
 * - --updated: 설치 프로그램(electron-builder NSIS)이 사이드바가 끝나기를 기다렸다가(안 끝나면 끝내고) 바꿔 깐다.
 *   --force-run: 다 깔면 사이드바를 다시 켠다. 부르는 쪽은 실행된 뒤 곧바로 사이드바를 끝낸다.
 */
export function startWinInstaller(exe, { spawnFn = spawn } = {}){
  if (!/\.exe$/i.test(exe) || /[\r\n"]/.test(exe)) return Promise.reject(new Error('설치 파일 경로를 쓸 수 없습니다'));
  return new Promise((resolve, reject) => {
    let p;
    try { p = spawnFn(exe, ['--updated', '--force-run'], { detached: true, stdio: 'ignore' }); }
    catch (e){ reject(e); return; }
    p.once('error', reject);
    p.once('spawn', () => { p.unref?.(); resolve(); });
  });
}

export const workDirOf = tmp => path.join(tmp, 'lesson-sidebar-update');
/** 윈도우: 받은 설치 파일을 둘 곳 — 임시 폴더(Temp)가 아니라 이 PC의 앱 자리(%LOCALAPPDATA%) 아래 (보안 프로그램이 덜 의심함) */
export const winUpdateDir = (localAppData, tmp) => path.join(localAppData || tmp, 'lesson-sidebar-updater');
export const exists = existsSync;
