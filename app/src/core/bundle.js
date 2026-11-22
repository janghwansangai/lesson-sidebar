// 수업 꾸러미(.zip): 수업 폴더 하나를 zip 하나로 내보내고, 다른 PC·보관함에서 다시 가져온다.
// 설계: docs/PLAN.md 9.4 · 보안: docs/PLAN.md 12 (zip slip, zip 폭탄, 실행 파일)
//
// 꾸러미 안의 모양:  <수업 폴더 이름>/lesson.json, <수업 폴더 이름>/1_도입/01_….pptx, …, <수업 폴더 이름>/.sidebar/manifest.json
// - 손으로 풀어도 폴더 하나가 생기게 맨 위에 수업 폴더 이름을 둔다 (구글 드라이브 웹에서 폴더째 내려받은 zip과 같은 모양)
// - 파일 이름은 NFC + zip의 UTF-8 표시 (맥 한글 이름이 윈도우에서 "ㅎㅏㄴㄱㅡㄹ"로 깨지지 않게)
// - manifest.json: 형식 버전, 앱 버전, 만든 때, 파일 목록과 SHA-256 (가져올 때 손상 확인)
import yazl from 'yazl';
import yauzl from 'yauzl';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, lstatSync, renameSync, rmSync, statfsSync, readFileSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import path from 'node:path';
import { BLOCKED, TEMP_FILE, safeName } from './types.js';

export const FORMAT = 1;
export const LIMITS = {
  files: 5000,                       // 파일 수
  totalBytes: 20 * 1024 ** 3,        // 풀었을 때 전체 크기 20GB (영상 포함 수업도 들어가게)
  fileBytes: 8 * 1024 ** 3,          // 파일 하나 8GB
  smallJson: 5 * 1024 ** 2,          // lesson.json·manifest.json은 5MB까지만 읽는다
};
const META = '.sidebar';
const MANIFEST = `${META}/manifest.json`;
// 이미 압축된 형식은 다시 압축하지 않는다 (시간만 걸리고 줄지 않음)
const STORED = /\.(zip|pptx|xlsx|docx|hwpx|mp4|mov|m4v|webm|mp3|m4a|aac|jpg|jpeg|png|gif|webp|heic|pdf)$/i;
const LINK_NEEDS_ACCESS = new Set(['gdoc', 'gsheet', 'gslides', 'gdrive', 'canva']);

const posix = p => p.split(path.sep).join('/');
// 백업 폴더 이름에 쓰는 이 PC 시각 (예: 2026-11-21_2317)
const nowStamp = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };

/** 수업 폴더 안의 파일 (상대 경로, NFC). .sidebar(잠금·백업·휴지통), 임시 파일, 실행 파일, 바로 가기 링크는 뺀다. */
export function listLessonFiles(root){
  const out = [];
  const walk = rel => {
    for (const name of readdirSync(path.join(root, rel))){
      const r = rel ? `${rel}/${name}` : name;
      if (!rel && name === META) continue;
      if (TEMP_FILE.test(name) || BLOCKED.test(name)) continue;
      const st = lstatSync(path.join(root, r));
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) walk(r);
      else if (st.isFile()) out.push({ rel: r.normalize('NFC'), abs: path.join(root, r), size: st.size });
    }
  };
  walk('');
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

async function sha256File(file){
  const h = createHash('sha256');
  await pipeline(createReadStream(file), h);
  return h.digest('hex');
}

/**
 * 수업 폴더를 꾸러미로 만든다. 임시 이름으로 다 쓴 뒤 바꿔치기한다 (반쯤 쓰인 zip이 남지 않게).
 * @returns {{ file, count, bytes, needAccess: string[] }}
 */
export async function exportBundle(root, outFile, { appVersion = '0' } = {}){
  root = path.resolve(root);
  const lesson = JSON.parse(readFileSync(path.join(root, 'lesson.json'), 'utf8'));
  const top = path.basename(root).normalize('NFC');
  const files = listLessonFiles(root);
  if (!files.some(f => f.rel === 'lesson.json')) throw new Error('수업 폴더에 lesson.json이 없습니다');
  const manifest = {
    format: FORMAT, app: appVersion, createdAt: new Date().toISOString(),
    title: String(lesson.title ?? ''), files: [],
  };
  const zip = new yazl.ZipFile();
  for (const f of files){
    manifest.files.push({ path: f.rel, size: f.size, sha256: await sha256File(f.abs) });
    zip.addFile(f.abs, `${top}/${f.rel}`, { compress: !STORED.test(f.rel), mode: 0o100644 });
  }
  zip.addBuffer(Buffer.from(JSON.stringify(manifest, null, 2) + '\n'), `${top}/${MANIFEST}`, { mode: 0o100644 });
  zip.end();
  const tmp = `${outFile}.tmp-${randomBytes(3).toString('hex')}`;
  try {
    await pipeline(zip.outputStream, createWriteStream(tmp));
    renameSync(tmp, outFile);
  } catch (e){ rmSync(tmp, { force: true }); throw e; }
  const items = (lesson.sections ?? []).flatMap(s => s.items ?? []);
  return {
    file: outFile, count: files.length, bytes: files.reduce((a, f) => a + f.size, 0),
    needAccess: items.filter(i => LINK_NEEDS_ACCESS.has(i.type)).map(i => String(i.title ?? i.url ?? '')),
  };
}

// ---------- 가져오기 ----------
const openZip = file => new Promise((res, rej) => yauzl.open(file, { lazyEntries: true, decodeStrings: false, validateEntrySizes: true, strictFileNames: false, autoClose: false }, (e, z) => e ? rej(e) : res(z)));
const readStream = (zip, entry) => new Promise((res, rej) => zip.openReadStream(entry, (e, s) => e ? rej(e) : res(s)));

const utf8 = new TextDecoder('utf-8', { fatal: true });
let cp949 = null;
try { cp949 = new TextDecoder('euc-kr'); } catch { /* ICU가 작은 Node면 없음 */ }
/** zip 안 이름: UTF-8 표시가 있으면 UTF-8. 없으면 UTF-8로 읽어 보고, 안 되면 윈도우 한국어(CP949)로 (윈도우 탐색기 압축). */
export function decodeName(raw, utf8Flag){
  if (utf8Flag) return raw.toString('utf8');
  try { return utf8.decode(raw); } catch { /* 아래 */ }
  return cp949 ? cp949.decode(raw) : raw.toString('latin1');
}

/** 위험한 경로인지: 절대 경로, 드라이브 문자, `..`, 빈 조각, 제어 문자 */
export function unsafePath(p){
  if (!p || p.startsWith('/') || /^[a-zA-Z]:/.test(p) || /[\u0000-\u001f]/.test(p)) return true;
  return p.split('/').some(seg => seg === '..' || seg === '.');
}

/** zip 항목을 모두 읽어 무엇을 어디에 풀지 정한다. 풀지는 않는다. */
async function scan(file, limits){
  const zip = await openZip(file);
  const entries = [];
  try {
    await new Promise((res, rej) => {
      zip.on('entry', e => {
        const name = decodeName(e.fileNameRaw ?? e.fileName, (e.generalPurposeBitFlag & 0x800) !== 0).replace(/\\/g, '/').replace(/^(\.\/)+/, '').normalize('NFC');
        const unixMode = (e.externalFileAttributes >>> 16) & 0o170000;
        entries.push({ e, name, dir: name.endsWith('/'), symlink: unixMode === 0o120000 });
        if (entries.length > limits.files * 2 + 100) return rej(new Error(`파일이 너무 많습니다 (${limits.files}개까지)`));
        zip.readEntry();
      });
      zip.on('end', res);
      zip.on('error', rej);
      zip.readEntry();
    });
  } catch (err){ zip.close(); throw err; }
  return { zip, entries };
}

async function readSmall(zip, entry, limit){
  if (entry.uncompressedSize > limit) throw new Error('lesson.json이 너무 큽니다');
  const chunks = []; let n = 0;
  for await (const c of await readStream(zip, entry)){ n += c.length; if (n > limit) throw new Error('lesson.json이 너무 큽니다'); chunks.push(c); }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * 꾸러미를 살펴본다 (풀지 않음): 안전한지, 무슨 수업인지, 무엇을 건너뛰는지.
 * 위험한 경로가 하나라도 있으면 꾸러미 전체를 거절한다.
 */
export async function inspectBundle(file, { limits = LIMITS } = {}){
  const { zip, entries } = await scan(file, limits);
  try {
    const bad = entries.find(x => unsafePath(x.dir ? x.name.slice(0, -1) : x.name));
    if (bad) throw new Error('수업 폴더 밖으로 풀리는 위험한 경로가 들어 있어 가져오지 않습니다');
    const real = entries.filter(x => !x.dir && !x.name.startsWith('__MACOSX/'));
    // lesson.json 위치: 맨 위 또는 폴더 하나 아래 (드라이브 웹 zip·우리 꾸러미)
    let base = '';
    if (!real.some(x => x.name === 'lesson.json')){
      const tops = new Set(real.map(x => x.name.split('/')[0]));
      const only = tops.size === 1 ? [...tops][0] : null;
      if (!only || !real.some(x => x.name === `${only}/lesson.json`)) throw new Error('꾸러미 안에 lesson.json이 없습니다 (수업 사이드바 수업 폴더를 묶은 zip이 아닙니다)');
      base = `${only}/`;
    }
    const plan = [], skipped = [];
    let manifestEntry = null, lessonEntry = null, total = 0;
    for (const x of real){
      if (!x.name.startsWith(base)) continue;
      const rel = x.name.slice(base.length);
      const leaf = rel.split('/').pop();
      if (rel === MANIFEST){ manifestEntry = x.e; continue; }
      if (rel === META || rel.startsWith(`${META}/`)) continue;   // 다른 PC의 잠금·백업·휴지통은 가져오지 않는다
      if (x.symlink){ skipped.push({ name: rel, reason: '바로 가기(링크) 파일' }); continue; }
      if (TEMP_FILE.test(leaf)) continue;
      if (BLOCKED.test(leaf)){ skipped.push({ name: rel, reason: '실행 파일은 가져오지 않습니다' }); continue; }
      if (x.e.uncompressedSize > limits.fileBytes) throw new Error(`너무 큰 파일이 있습니다: ${rel}`);
      total += x.e.uncompressedSize;
      if (rel === 'lesson.json') lessonEntry = x.e;
      plan.push({ rel, entry: x.e });
    }
    if (plan.length > limits.files) throw new Error(`파일이 너무 많습니다 (${plan.length}개, ${limits.files}개까지)`);
    if (total > limits.totalBytes) throw new Error(`풀면 너무 큽니다 (${fmtBytes(total)}, ${fmtBytes(limits.totalBytes)}까지)`);

    let lesson;
    try { lesson = JSON.parse(await readSmall(zip, lessonEntry, limits.smallJson)); } catch (e){ throw new Error(`lesson.json을 읽지 못했습니다 (${e.message})`); }
    if (lesson?.schema !== 1 || !Array.isArray(lesson.sections)) throw new Error('수업 사이드바가 모르는 lesson.json 형식입니다');
    let manifest = null;
    if (manifestEntry){ try { manifest = JSON.parse(await readSmall(zip, manifestEntry, limits.smallJson)); } catch { manifest = null; } }

    const title = String(lesson.title ?? '').normalize('NFC');
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(lesson.date ?? '')) ? lesson.date : '';
    const folderName = base ? safeFolder(base.slice(0, -1)) : safeFolder(`${date ? date + '_' : ''}${safeName(title || '가져온 수업')}`);
    return { file, base, plan: plan.map(p => ({ rel: p.rel, size: p.entry.uncompressedSize })), skipped, totalBytes: total,
      lesson: { id: lesson.id ? String(lesson.id) : null, title, date }, manifest, folderName };
  } finally { zip.close(); }
}

/** 폴더 이름으로 쓸 수 있게 (윈도우 금지 문자·끝의 점/공백 제거). 날짜_제목 모양은 그대로 둔다. */
function safeFolder(name){
  const n = String(name).normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 80);
  return n || '가져온 수업';
}

export function fmtBytes(n){
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)}GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(n / 1024))}KB`;
}

/** 보관함에 같은 수업이 있는지: 같은 수업 번호(lesson.id) 또는 같은 폴더 이름 */
export function findExisting(info, libraryRoot){
  const same = path.join(libraryRoot, info.folderName);
  if (existsSync(path.join(same, 'lesson.json'))) return same;
  if (!info.lesson.id) return null;
  for (const name of readdirSync(libraryRoot)){
    if (name.startsWith('.')) continue;
    const f = path.join(libraryRoot, name, 'lesson.json');
    try { if (JSON.parse(readFileSync(f, 'utf8')).id === info.lesson.id) return path.join(libraryRoot, name); } catch { /* 건너뜀 */ }
  }
  return null;
}

const freeFolder = (dir, name) => { let n = name; for (let i = 2; existsSync(path.join(dir, n)); i++) n = `${name}_${i}`; return path.join(dir, n); };

// 윈도우: 폴더 안 파일이 다른 프로그램(파워포인트·한글 등)에 열려 있으면 폴더 이름을 바꿀 수 없다 (EPERM/EBUSY/EACCES).
// 클라우드 동기화 프로그램이 잠깐 잡고 있을 때도 같은 오류라 조금 기다리며 몇 번 더 해 본다.
const BUSY = new Set(['EPERM', 'EBUSY', 'EACCES']);
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function renameRetry(from, to, { tries = 4, waitMs = 400 } = {}){
  for (let i = 1; ; i++){
    try { return renameSync(from, to); }
    catch (e){ if (!BUSY.has(e.code) || i >= tries) throw e; await sleep(waitMs); }
  }
}

/**
 * 수업 폴더 안에서 다른 프로그램이 열고 있는 파일 (이름만, 최대 max개). 윈도우만 판단하고 맥은 빈 목록.
 * 오피스·한글은 연 파일을 쓰기 금지로 잡아 두므로, 쓰기로 열어 보아 막히면 "열려 있음"으로 본다 (내용은 바꾸지 않음).
 * 오피스가 옆에 만드는 `~$파일` 표시는 listLessonFiles가 빼므로 원래 파일로 판단한다.
 */
export function busyFiles(root, { max = 3, platform = process.platform } = {}){
  if (platform !== 'win32') return [];
  const out = [];
  for (const f of listLessonFiles(root)){
    try {
      if (lstatSync(f.abs).mode & 0o200){ closeSync(openSync(f.abs, 'r+')); }   // 읽기 전용 파일은 건너뜀
    } catch (e){
      if (BUSY.has(e.code)){ out.push(path.basename(f.rel)); if (out.length >= max) break; }
    }
  }
  return out;
}

/** 덮어쓰지 못할 때 선생님께 보일 말 (경로·영어 오류는 넣지 않는다) */
function busyError(names){
  const which = names.length ? `'${names.join("', '")}' 파일이` : '이 수업 폴더의 파일이';
  const e = new Error(`${which} 다른 프로그램(파워포인트·엑셀·한글·탐색기 등)에 열려 있어 덮어쓰지 못했습니다 · 그 파일을 닫고 다시 가져오거나 "사본으로 가져오기"를 고르세요 (지금 수업은 그대로입니다)`);
  e.code = 'BUSY';
  return e;
}

/**
 * 꾸러미를 보관함에 푼다.
 * mode 'copy': 새 폴더(이름이 겹치면 _2)로, 수업 번호도 새로 — 따로 고치는 사본
 * mode 'overwrite': existing 폴더를 `.sidebar/덮어쓰기 전/`으로 옮겨 두고 그 자리에 푼다
 * 먼저 숨은 임시 폴더에 다 푼 뒤 확인이 끝나면 바꿔치기한다 (중간에 실패해도 보관함이 망가지지 않게).
 * @returns {{ root, count, skipped, damaged, backup }}
 */
export async function importBundle(info, libraryRoot, { mode = 'copy', existing = null, limits = LIMITS, newId = () => `les_${randomBytes(4).toString('hex')}` } = {}){
  libraryRoot = path.resolve(libraryRoot);
  try {
    const fs = statfsSync(libraryRoot);
    if (fs.bavail * fs.bsize < info.totalBytes * 1.05 + 50 * 1024 ** 2) throw new Error(`저장 공간이 모자랍니다 (${fmtBytes(info.totalBytes)} 필요)`);
  } catch (e){ if (/모자랍니다/.test(e.message)) throw e; }
  // 덮어쓸 수업의 파일이 열려 있으면 풀기 전에 알린다 (큰 꾸러미를 다 푼 뒤에 실패하지 않게)
  if (mode === 'overwrite' && existing){
    const open = busyFiles(existing);
    if (open.length) throw busyError(open);
  }

  const tmp = path.join(libraryRoot, `.가져오는 중-${randomBytes(4).toString('hex')}`);
  const want = new Map(info.plan.map(p => [p.rel, p]));
  const hashes = new Map((info.manifest?.files ?? []).filter(f => f && typeof f.path === 'string').map(f => [String(f.path).normalize('NFC'), String(f.sha256 ?? '')]));
  const damaged = [];
  let count = 0, written = 0;
  const { zip, entries } = await scan(info.file, limits);
  try {
    mkdirSync(tmp);
    for (const x of entries){
      if (x.dir || !x.name.startsWith(info.base)) continue;
      const rel = x.name.slice(info.base.length);
      if (!want.has(rel)) continue;
      const dest = path.resolve(tmp, ...rel.split('/'));
      if (!dest.startsWith(tmp + path.sep)) throw new Error('수업 폴더 밖으로 풀리는 경로가 있습니다');
      mkdirSync(path.dirname(dest), { recursive: true });
      const h = createHash('sha256');
      let n = 0;
      const count$ = new Transform({ transform(chunk, _e, cb){
        n += chunk.length; written += chunk.length;
        if (n > limits.fileBytes || written > limits.totalBytes) return cb(new Error('풀다 보니 너무 큽니다 (압축 폭탄일 수 있습니다)'));
        h.update(chunk); cb(null, chunk);
      } });
      await pipeline(await readStream(zip, x.e), count$, createWriteStream(dest, { mode: 0o644 }));
      const expect = hashes.get(rel);
      if (expect && expect !== h.digest('hex')){ rmSync(dest, { force: true }); damaged.push(rel); continue; }
      count++;
    }
    if (!existsSync(path.join(tmp, 'lesson.json'))) throw new Error('lesson.json이 손상되어 가져올 수 없습니다');
    const lj = path.join(tmp, 'lesson.json');
    const d = JSON.parse(readFileSync(lj, 'utf8'));
    if (mode === 'copy' && existing){
      // 따로 고치는 사본: 수업 번호를 새로 하고, 목록에서 구분되게 이름에 "(사본)"을 붙인다
      d.id = newId();
      d.title = `${String(d.title ?? '').replace(/\s*\(사본\)$/, '')} (사본)`;
      writeFileSync(lj, JSON.stringify(d, null, 2) + '\n');
    }
  } catch (e){
    zip.close(); rmSync(tmp, { recursive: true, force: true }); throw e;
  }
  zip.close();

  let root, backup = null;
  if (mode === 'overwrite' && existing){
    const keep = path.join(libraryRoot, META, '덮어쓰기 전');
    mkdirSync(keep, { recursive: true });
    backup = freeFolder(keep, `${path.basename(existing)}_${nowStamp()}`);
    try { await renameRetry(existing, backup); }
    catch (e){
      rmSync(tmp, { recursive: true, force: true });
      if (BUSY.has(e.code)) throw busyError(busyFiles(existing));
      throw e;
    }
    try { await renameRetry(tmp, existing); }
    catch (e){ renameSync(backup, existing); rmSync(tmp, { recursive: true, force: true }); throw e; }
    root = existing;
  } else {
    root = freeFolder(libraryRoot, info.folderName);
    try { await renameRetry(tmp, root); }
    catch (e){ rmSync(tmp, { recursive: true, force: true }); throw e; }
  }
  return { root, count, skipped: info.skipped, damaged, backup };
}
