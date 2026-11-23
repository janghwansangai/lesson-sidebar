// 수업 보관함: 수업 폴더들이 들어 있는 상위 폴더 (보통 구글 드라이브의 "수업 사이드바").
import { readdirSync, readFileSync, existsSync, statSync, renameSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { cp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { otherLock } from './lock.js';
import { searchText, findConflicts } from './reuse.js';
import { cloudOf } from './precheck.js';

export const LIB_NAME = '수업 사이드바';

/** 이메일은 앞 두 글자만 (화면을 학생에게 띄워도 다 보이지 않게) */
export function maskEmail(e){
  const [id, dom] = String(e).split('@');
  return dom ? `${id.slice(0, 2)}•••@${dom}` : `${String(e).slice(0, 2)}•••`;
}

// 윈도우 구글 드라이브 데스크톱이 붙이는 드라이브(G: 등)의 맨 위에는 이 폴더들만 있다
// (.Encrypted: 구글 드라이브가 만드는 숨은 폴더 — 2026-11-23 윈도우 선생님 PC의 G:에 있어 진짜 구글 드라이브가 추천에서 빠졌다)
const DRIVEFS_TOP = /^(내 드라이브|My Drive|공유 드라이브|Shared drives|다른 컴퓨터|Other computers|\.shortcut-targets-by-id|\.Encrypted|desktop\.ini|System Volume Information)$/i;

/** 보관함으로 쓸 만한 위치. 구글 드라이브 데스크톱이 있으면 먼저.
 *  o: 시험용으로 바꿔 넣는 값 (platform, home, env, exists, readdir) */
export function suggestRoots(o = {}){
  const { platform = process.platform, home = os.homedir(), env = process.env, exists = existsSync, readdir = readdirSync } = o;
  const P = platform === 'win32' ? path.win32 : path.posix;
  const out = [];
  const cs = P.join(home, 'Library', 'CloudStorage');
  try {
    const accounts = readdir(cs).filter(d => d.startsWith('GoogleDrive-'));
    for (const d of accounts){
      for (const my of ['내 드라이브', 'My Drive']){
        const p = P.join(cs, d, my);
        if (exists(p)) out.push({ kind: 'drive', label: accounts.length > 1 ? `구글 드라이브 (${maskEmail(d.replace('GoogleDrive-', ''))})` : '구글 드라이브', path: P.join(p, LIB_NAME) });
      }
    }
  } catch { /* 구글 드라이브 없음 */ }
  if (platform === 'win32'){
    // 윈도우의 구글 드라이브 데스크톱은 드라이브 문자(보통 G:)로 붙는다.
    // 다른 디스크·NAS에 '내 드라이브' 폴더가 있어도 구글 드라이브로 붙이지 않게 두 가지를 본다:
    // ① 구글 드라이브 데스크톱이 깔려 있다 (%LOCALAPPDATA%\Google\DriveFS)  ② 그 드라이브 맨 위에 구글 드라이브 폴더만 있다
    const installed = env.LOCALAPPDATA && exists(P.join(env.LOCALAPPDATA, 'Google', 'DriveFS'));
    for (const letter of installed ? 'GHIJKLMNOPQRSTUVWXYZDEF' : ''){
      const top = `${letter}:\\`;
      let names;
      try { names = readdir(top); } catch { continue; }
      if (!names.length || !names.every(n => DRIVEFS_TOP.test(n) || n.startsWith('$'))) continue;
      for (const my of ['내 드라이브', 'My Drive']){
        if (names.includes(my)) out.push({ kind: 'drive', label: `구글 드라이브 (${letter}:)`, path: P.join(top, my, LIB_NAME) });
      }
    }
  }
  out.push({ kind: 'documents', label: platform === 'win32' ? '이 PC의 문서 폴더' : '이 맥의 문서 폴더', path: P.join(home, 'Documents', LIB_NAME) });
  return out;
}

/** 화면에 보일 짧은 위치. 사용자 이름·구글 계정 이메일이 든 앞부분은 빼고 바꿔 부른다.
 *  예) /Users/<이름>/Library/CloudStorage/GoogleDrive-<이메일>/내 드라이브/수업 사이드바 → 구글 드라이브 › 내 드라이브 › 수업 사이드바 */
/** 윈도우 짧은 이름(8.3, 예: C:\Users\KIMCHU~1)을 긴 이름으로. 아직 없는 폴더면 있는 데까지만 바꾼다 */
function longName(s){
  if (process.platform !== 'win32' || !s.includes('~')) return s;
  let head = s; const rest = [];
  for (let i = 0; i < 64; i++){
    try { return path.win32.join(realpathSync.native(head), ...rest); } catch { /* 위로 */ }
    const up = path.win32.dirname(head);
    if (up === head) return s;
    rest.unshift(path.win32.basename(head)); head = up;
  }
  return s;
}

export function shortPath(p, { platform = process.platform, home = os.homedir() } = {}){
  if (!p) return '';
  const P = platform === 'win32' ? path.win32 : path.posix;
  // 윈도우 TEMP 같은 경로는 사용자 이름이 짧은 이름(예: KIMCHU~1)으로 들어 있어 홈으로 알아보지 못하고 그대로 보였다 (2026-11-23)
  const s = (platform === 'win32' ? longName(String(p)) : String(p)).normalize('NFC');
  const parts = rest => rest.split(/[\\/]+/).filter(Boolean);
  const join = a => a.join(' › ');
  const cs = s.match(/[\\/]Library[\\/]CloudStorage[\\/]([^\\/]+)(.*)$/);
  if (cs){
    const kind = cs[1].split('-')[0];
    const name = { GoogleDrive: '구글 드라이브', OneDrive: 'OneDrive', Dropbox: 'Dropbox', Box: 'Box' }[kind] ?? kind;
    return join([name, ...parts(cs[2])]);
  }
  const icloud = s.match(/[\\/]Library[\\/]Mobile Documents[\\/]com~apple~CloudDocs(.*)$/);
  if (icloud) return join(['iCloud Drive', ...parts(icloud[1])]);
  const h = String(home).normalize('NFC');
  const same = platform === 'win32' ? (a, b) => a.toLowerCase() === b.toLowerCase() : (a, b) => a === b;
  if (h && (same(s, h) || same(s.slice(0, h.length + 1), h + P.sep))){
    const [first, ...more] = parts(s.slice(h.length));
    if (!first) return '홈';
    const NAMES = { Desktop: platform === 'win32' ? '바탕 화면' : '데스크탑', Documents: '문서', Downloads: '다운로드' };
    if (/^OneDrive( - .+)?$/i.test(first)) return join(['OneDrive', ...more]);
    return join(NAMES[first] ? [NAMES[first], ...more] : ['홈', first, ...more]);
  }
  if (platform === 'win32'){
    const m = s.match(/^([a-z]:)(.*)$/i);
    if (m){
      // 윈도우 구글 드라이브(G: 등)는 맨 위가 '내 드라이브'·'공유 드라이브'다 → "구글 드라이브 (G:) › 내 드라이브 › …"
      const [first, ...more] = parts(m[2]);
      if (first && /^(내 드라이브|My Drive|공유 드라이브|Shared drives|다른 컴퓨터|Other computers)$/i.test(first)) return join([`구글 드라이브 (${m[1].toUpperCase()})`, first, ...more]);
      return join([m[1].toUpperCase(), ...parts(m[2])]);
    }
  }
  const vol = s.match(/^\/Volumes\/(.*)$/);
  return join(parts(vol ? vol[1] : s));
}

// "목록에서만 빼기"로 숨긴 수업 폴더 이름 (보관함/.sidebar/hidden.json). 폴더와 자료는 그대로 있다.
// 보관함 안에 두어 구글 드라이브로 함께 쓰는 다른 PC에서도 똑같이 숨겨진다.
const hiddenFile = root => path.join(root, '.sidebar', 'hidden.json');
export function hiddenLessons(root){
  try {
    const d = JSON.parse(readFileSync(hiddenFile(root), 'utf8'));
    return new Set((Array.isArray(d?.names) ? d.names : []).filter(n => typeof n === 'string').map(n => n.normalize('NFC')));
  } catch { return new Set(); }
}
export function setHidden(root, name, hidden){
  const s = hiddenLessons(root), n = String(name).normalize('NFC');
  if (hidden === s.has(n)) return;
  if (hidden) s.add(n); else s.delete(n);
  mkdirSync(path.dirname(hiddenFile(root)), { recursive: true });
  writeFileSync(hiddenFile(root), JSON.stringify({ names: [...s] }, null, 2));
}
/** 이 수업 폴더가 보관함 바로 아래에 있는지 (보관함 목록에 나오는 수업인지) */
export const inLibrary = (folder, root) => !!root && path.resolve(path.dirname(folder)).normalize('NFC') === path.resolve(root).normalize('NFC');

/** 보관함 안의 수업 목록 (lesson.json이 있는 폴더). 최근 날짜 순. 목록에서 뺀(숨긴) 수업은 all일 때만. */
export function listLessons(root, { all = false } = {}){
  if (!root || !existsSync(root)) return [];
  const out = [];
  let names = [];
  try { names = readdirSync(root); } catch { return []; }
  const hidden = all ? new Set() : hiddenLessons(root);
  for (const name of names){
    if (name.startsWith('.') || hidden.has(name.normalize('NFC'))) continue;
    const dir = path.join(root, name);
    const f = path.join(dir, 'lesson.json');
    try {
      if (!statSync(dir).isDirectory() || !existsSync(f)) continue;
      const d = JSON.parse(readFileSync(f, 'utf8'));
      const count = (d.sections ?? []).reduce((a, s) => a + (s.items?.length ?? 0), 0);
      const lock = otherLock(dir);
      out.push({ folder: dir, name: name.normalize('NFC'), title: String(d.title ?? name).normalize('NFC'), date: String(d.date ?? ''),
        count, updatedAt: d.updatedAt ?? null, device: d.device ?? null, lockedBy: lock?.device ?? null,
        search: searchText(d), conflicts: Math.max(0, findConflicts(dir).length - 1) });
    } catch {
      out.push({ folder: dir, name: name.normalize('NFC'), title: name.normalize('NFC'), date: '', count: 0, broken: true });
    }
  }
  return out.sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.name.localeCompare(b.name));
}

const isInside = (child, parent) => { const r = path.relative(parent, child); return r === '' || (!!r && !r.startsWith('..') && !path.isAbsolute(r)); };

/** 고른 폴더를 보관함으로 써도 되는지. 안 되면 까닭을 돌려준다 */
export function libraryProblem(dir, lessons = []){
  if (existsSync(path.join(dir, 'lesson.json'))) return '고른 폴더는 수업 폴더입니다 · 수업들이 모일 상위 폴더를 골라 주세요';
  const inLesson = lessons.find(l => isInside(dir, l.folder));
  if (inLesson) return `'${inLesson.title}' 수업 폴더 안은 보관함으로 쓸 수 없습니다`;
  return null;
}

/** 파일 개수와 크기 합 (복사가 제대로 됐는지 견줄 때) */
function tally(dir){
  let files = 0, bytes = 0;
  for (const e of readdirSync(dir, { withFileTypes: true, recursive: true })){
    if (!e.isFile()) continue;
    files++;
    try { bytes += statSync(path.join(e.parentPath ?? e.path, e.name)).size; } catch { /* 사라진 파일 */ }
  }
  return { files, bytes };
}

/** 수업 폴더 하나를 다른 보관함으로 옮긴다.
 *  같은 디스크·같은 동기화 폴더 안이면 이름만 바꾸고(바로 끝남), 아니면 복사 → 파일 수·크기 확인 → 원래 폴더는 trash(휴지통)로.
 *  구글 드라이브 ↔ 이 PC처럼 밖으로 나갈 때 이름 바꾸기를 쓰면 아직 내려받지 않은 파일이 빈 껍데기로 옮겨질 수 있어 복사한다.
 *  @returns {{ dest, how: 'rename'|'copy', kept?: boolean }} kept: 복사는 됐지만 원래 폴더를 휴지통에 넣지 못함 */
export async function moveLesson(src, destRoot, { trash }){
  const dest = path.join(destRoot, path.basename(src));
  if (existsSync(dest)) throw new Error('새 보관함에 같은 이름의 폴더가 이미 있습니다');
  const sameDisk = (() => { try { return statSync(src).dev === statSync(destRoot).dev; } catch { return false; } })();
  if (sameDisk && cloudOf(path.join(src, 'x')) === cloudOf(path.join(destRoot, 'x'))){
    try { renameSync(src, dest); return { dest, how: 'rename' }; }
    catch (e){ if (e.code !== 'EXDEV') throw e; }
  }
  await cp(src, dest, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
  const a = tally(src), b = tally(dest);
  if (a.files !== b.files || a.bytes !== b.bytes){
    await rm(dest, { recursive: true, force: true });
    throw new Error(`복사한 내용이 원본과 다릅니다 (파일 ${a.files}개 중 ${b.files}개)`);
  }
  try { await trash(src); return { dest, how: 'copy' }; }
  catch { return { dest, how: 'copy', kept: true }; }
}
