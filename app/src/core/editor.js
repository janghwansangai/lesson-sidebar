// 수업 편집 (준비 화면): lesson.json을 고치고, 자료 파일을 수업 폴더로 복사·정리한다.
// 저장은 임시 파일에 쓰고 바꿔치기 + 최근 10개 백업 (클라우드 동기화가 반쯤 쓴 파일을 올리지 않게).
import { promises as fsp, existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, statSync, readdirSync, rmdirSync, unlinkSync, constants } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { BLOCKED, TEMP_FILE, typeOfFile, detectUrl, safeName, pad2, extOf, START_HINT } from './types.js';
import { deviceName } from './lock.js';

const BACKUPS = 10;
const BACKUP_GAP_MS = 60 * 1000;
/** 같은 이름이 이미 있으면 `이름_2.확장자`처럼 비어 있는 이름을 고른다 (같은 순간에 만든 백업·휴지통 파일이 서로 덮지 않게) */
function freeName(dir, name){
  const ext = path.extname(name), stem = name.slice(0, name.length - ext.length);
  let n = name;
  for (let i = 2; existsSync(path.join(dir, n)); i++) n = `${stem}_${i}${ext}`;
  return n;
}
const newId = p => `${p}_${randomBytes(4).toString('hex')}`;
const today = () => new Date().toISOString().slice(0, 10);

export class LessonDoc {
  constructor(root){
    this.root = path.resolve(root);
    this.data = null;
    this.mtime = 0;
    this.backedUpAt = 0;   // 마지막으로 백업을 만든 때
  }

  get file(){ return path.join(this.root, 'lesson.json'); }

  /** 보관함 안에 새 수업 폴더를 만든다: "날짜_제목" */
  static create(libraryRoot, { title, date } = {}){
    title = String(title ?? '').trim().normalize('NFC') || '새 수업';
    date = /^\d{4}-\d{2}-\d{2}$/.test(String(date)) ? String(date) : today();
    mkdirSync(libraryRoot, { recursive: true });
    const base = `${date}_${safeName(title)}`;
    let dir = path.join(libraryRoot, base);
    for (let i = 2; existsSync(dir); i++) dir = path.join(libraryRoot, `${base}_${i}`);
    mkdirSync(dir);
    const doc = new LessonDoc(dir);
    doc.data = {
      schema: 1, id: newId('les'), title, date,
      sections: [
        { id: newId('s'), title: '도입', minutes: 10, items: [] },
        { id: newId('s'), title: '전개', minutes: 30, items: [] },
        { id: newId('s'), title: '정리', minutes: 10, items: [] },
      ],
    };
    doc.save();
    return doc;
  }

  load(){
    const d = JSON.parse(readFileSync(this.file, 'utf8'));
    if (d.schema !== 1) throw new Error(`모르는 형식입니다 (schema ${d.schema})`);
    d.sections = Array.isArray(d.sections) ? d.sections : [];
    for (const s of d.sections){
      s.id = String(s.id ?? newId('s'));
      s.items = Array.isArray(s.items) ? s.items : [];
      for (const it of s.items) it.id = String(it.id ?? newId('it'));
    }
    this.data = d;
    this.mtime = statSync(this.file).mtimeMs;
    return this;
  }

  save(){
    const d = this.data;
    d.updatedAt = new Date().toISOString();
    d.device = deviceName();
    const side = path.join(this.root, '.sidebar', 'backup');
    // 글자를 칠 때마다 저장하므로 백업은 1분에 하나만 만든다 (오래된 백업이 금방 밀려나지 않게).
    // 다른 PC 등에서 바뀐 파일을 덮어쓰게 될 때는 시간과 상관없이 먼저 백업한다.
    const now = Date.now();
    if (existsSync(this.file) && (this.changedOutside() || now - this.backedUpAt >= BACKUP_GAP_MS)){
      this.backedUpAt = now;
      mkdirSync(side, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      writeFileSync(path.join(side, freeName(side, `lesson-${stamp}.json`)), readFileSync(this.file));
      const old = readdirSync(side).filter(f => f.startsWith('lesson-')).sort();
      for (const f of old.slice(0, Math.max(0, old.length - BACKUPS))){ try { unlinkSync(path.join(side, f)); } catch { /* 계속 */ } }
    }
    const tmp = `${this.file}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(d, null, 2) + '\n');
    renameSync(tmp, this.file);
    this.mtime = statSync(this.file).mtimeMs;
  }

  /** 다른 PC·프로그램이 lesson.json을 바꿨는지 (클라우드 동기화로 내려온 변경) */
  changedOutside(){
    try { return statSync(this.file).mtimeMs !== this.mtime; } catch { return false; }
  }

  // ---------- 찾기 ----------
  section(id){ return this.data.sections.find(s => s.id === id) ?? null; }
  locate(itemId){
    for (const s of this.data.sections){
      const i = s.items.findIndex(it => it.id === itemId);
      if (i >= 0) return { sec: s, item: s.items[i], index: i };
    }
    return null;
  }
  allItems(){ return this.data.sections.flatMap(s => s.items); }
  abs(rel){
    const a = path.resolve(this.root, String(rel).normalize('NFC'));
    if (!a.startsWith(this.root + path.sep)) throw new Error('수업 폴더 밖 경로입니다');
    return a;
  }
  sectionDir(sec){ return `${this.data.sections.indexOf(sec) + 1}_${safeName(sec.title, 20)}`; }
  nextNumber(){ return this.allItems().length + 1; }

  // ---------- 수업 정보 ----------
  setInfo({ title, date } = {}){
    if (title !== undefined) this.data.title = String(title).normalize('NFC').slice(0, 120);
    if (date !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(String(date))) this.data.date = String(date);
  }

  // ---------- 구간 ----------
  addSection(title = '새 구간'){
    const s = { id: newId('s'), title: String(title).normalize('NFC').slice(0, 40), minutes: 10, items: [] };
    this.data.sections.push(s);
    return s;
  }
  updateSection(id, { title, minutes } = {}){
    const s = this.section(id); if (!s) throw new Error('구간을 찾지 못했습니다');
    if (title !== undefined) s.title = String(title).normalize('NFC').slice(0, 40);
    if (minutes !== undefined) s.minutes = Math.max(0, Math.min(600, Math.round(Number(minutes) || 0)));
  }
  removeSection(id){
    const s = this.section(id); if (!s) return;
    if (s.items.length) throw new Error('자료가 있는 구간은 지울 수 없습니다. 자료를 먼저 옮기거나 빼 주세요');
    this.data.sections = this.data.sections.filter(x => x !== s);
  }

  // ---------- 자료 넣기 ----------
  /** 파일을 수업 폴더로 복사한다 (원본은 그대로). */
  async addFiles(paths, sectionId){
    const sec = this.section(sectionId) ?? this.data.sections[0] ?? this.addSection('자료');
    const added = [], skipped = [];
    for (const src of paths){
      const name = path.basename(String(src)).normalize('NFC');
      try {
        if (BLOCKED.test(name)){ skipped.push({ name, reason: '실행 파일은 넣지 않습니다' }); continue; }
        if (TEMP_FILE.test(name)){ skipped.push({ name, reason: '문서 프로그램이 잠시 만드는 임시 파일이라 넣지 않습니다' }); continue; }
        const st = statSync(src);
        if (!st.isFile()){ skipped.push({ name, reason: '폴더는 넣을 수 없습니다 (안의 파일을 넣어 주세요)' }); continue; }
        const ext = extOf(name);
        const stem = name.replace(/\.[^.]+$/, '');
        const dir = this.sectionDir(sec);
        mkdirSync(this.abs(dir), { recursive: true });
        let rel = `${dir}/${pad2(this.nextNumber())}_${safeName(stem)}${ext ? '.' + ext : ''}`;
        for (let i = 2; existsSync(this.abs(rel)); i++) rel = `${dir}/${pad2(this.nextNumber())}_${safeName(stem)}_${i}${ext ? '.' + ext : ''}`;
        await fsp.copyFile(src, this.abs(rel), constants.COPYFILE_EXCL);
        const type = typeOfFile(name);
        const item = { id: newId('it'), type, title: stem, file: rel };
        if (type === 'memo') item.screen = 'teacher';
        sec.items.push(item);
        added.push(item);
      } catch (e){
        skipped.push({ name, reason: e.code === 'ENOENT' ? '파일을 찾지 못했습니다' : `복사하지 못했습니다 (${e.code ?? e.message})` });
      }
    }
    return { added, skipped };
  }

  addLink(url, sectionId, title){
    const d = detectUrl(url);
    if (d.error) throw new Error(d.error);
    const sec = this.section(sectionId) ?? this.data.sections[0] ?? this.addSection('자료');
    const item = { id: newId('it'), type: d.type, title: String(title ?? '').trim().normalize('NFC') || d.title, url: d.url };
    if (d.start) item.start = d.start;
    sec.items.push(item);
    return item;
  }

  addMemo(sectionId, title = '진행 메모'){
    const sec = this.section(sectionId) ?? this.data.sections[0] ?? this.addSection('자료');
    const dir = this.sectionDir(sec);
    mkdirSync(this.abs(dir), { recursive: true });
    let rel = `${dir}/${pad2(this.nextNumber())}_${safeName(title)}.md`;
    for (let i = 2; existsSync(this.abs(rel)); i++) rel = `${dir}/${pad2(this.nextNumber())}_${safeName(title)}_${i}.md`;
    writeFileSync(this.abs(rel), `# ${title}\n\n- \n`, { flag: 'wx' });
    const item = { id: newId('it'), type: 'memo', title, file: rel, screen: 'teacher' };
    sec.items.push(item);
    return item;
  }

  // ---------- 자료 고치기 ----------
  updateItem(id, patch = {}){
    const loc = this.locate(id); if (!loc) throw new Error('자료를 찾지 못했습니다');
    const it = loc.item;
    if (patch.title !== undefined) it.title = String(patch.title).normalize('NFC').slice(0, 80);
    if (patch.start !== undefined){
      const v = String(patch.start).trim().slice(0, 20);
      if (v && START_HINT[it.type]) it.start = v; else delete it.start;
    }
    if (patch.screen !== undefined){
      if (patch.screen === 'teacher' || patch.screen === 'student') it.screen = patch.screen; else delete it.screen;
    }
  }

  /** 흐름에서 뺀다. 파일은 지우지 않고 .sidebar/휴지통으로 옮긴다. */
  removeItem(id){
    const loc = this.locate(id); if (!loc) return null;
    loc.sec.items.splice(loc.index, 1);
    if (loc.item.file){
      try {
        const src = this.abs(loc.item.file);
        if (existsSync(src)){
          const trash = path.join(this.root, '.sidebar', '휴지통');
          mkdirSync(trash, { recursive: true });
          const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
          renameSync(src, path.join(trash, freeName(trash, `${stamp}_${path.basename(src)}`)));
        }
      } catch { /* 흐름에서는 빠짐 */ }
    }
    return loc.item;
  }

  /** 자료를 다른 자리로 옮긴다. beforeId가 없으면 그 구간 끝으로. */
  moveItem(id, toSectionId, beforeId = null){
    const loc = this.locate(id); if (!loc) throw new Error('자료를 찾지 못했습니다');
    const to = this.section(toSectionId); if (!to) throw new Error('구간을 찾지 못했습니다');
    if (beforeId === id) return;
    loc.sec.items.splice(loc.index, 1);
    const at = beforeId ? to.items.findIndex(x => x.id === beforeId) : -1;
    if (at >= 0) to.items.splice(at, 0, loc.item); else to.items.push(loc.item);
  }

  // ---------- 정리하기 ----------
  /**
   * 파일 이름과 폴더를 지금 순서에 맞춘다: "1_도입/01_진행메모.md".
   * 열려 있는 자료(openIds)는 이름을 바꾸면 실패할 수 있어 건너뛴다.
   */
  tidy(openIds = new Set()){
    let n = 0;
    const renamed = [], skipped = [];
    for (const sec of this.data.sections){
      const dir = this.sectionDir(sec);
      for (const it of sec.items){
        n++;
        if (!it.file) continue;
        const ext = extOf(it.file);
        const want = `${dir}/${pad2(n)}_${safeName(it.title)}${ext ? '.' + ext : ''}`;
        if (want === it.file) continue;
        if (openIds.has(it.id)){ skipped.push({ title: it.title, reason: '열려 있어 다음에 정리합니다' }); continue; }
        try {
          const from = this.abs(it.file), to = this.abs(want);
          if (!existsSync(from)){ skipped.push({ title: it.title, reason: '파일이 없습니다' }); continue; }
          if (existsSync(to)){ skipped.push({ title: it.title, reason: '같은 이름 파일이 이미 있습니다' }); continue; }
          mkdirSync(path.dirname(to), { recursive: true });
          renameSync(from, to);
          renamed.push({ from: it.file, to: want });
          it.file = want;
        } catch (e){ skipped.push({ title: it.title, reason: e.code ?? e.message }); }
      }
    }
    // 비어 버린 옛 구간 폴더("3_정리" 등) 지우기
    for (const name of readdirSync(this.root)){
      if (!/^\d+_/.test(name)) continue;
      const p = path.join(this.root, name);
      try { if (statSync(p).isDirectory() && !readdirSync(p).length) rmdirSync(p); } catch { /* 계속 */ }
    }
    return { renamed, skipped };
  }

  // ---------- 화면에 보낼 상태 ----------
  snapshot(){
    const d = this.data;
    return {
      root: this.root, title: d.title, date: d.date, updatedAt: d.updatedAt ?? null, device: d.device ?? null,
      sections: d.sections.map(s => ({ id: s.id, title: s.title, minutes: s.minutes ?? 0,
        items: s.items.map(it => ({ id: it.id, type: it.type, title: it.title, start: it.start ?? '', screen: it.screen ?? null,
          file: it.file ?? null, url: it.url ?? null,
          problem: it.file && !existsSync(this.abs(it.file)) ? '파일이 없습니다 (아직 동기화 중일 수 있습니다)' : null })) })),
    };
  }
}
