// 수업 폴더(lesson.json) 읽기. 다른 PC·사람이 고친 파일일 수 있으므로 형식과 경로를 검사한다.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

export const TYPES = new Set(['web', 'youtube', 'gdoc', 'gsheet', 'gslides', 'gdrive', 'canva', 'pdf', 'img', 'pptx', 'ppt', 'xlsx', 'xls', 'hwp', 'hwpx', 'audio', 'video', 'memo', 'folder', 'file']);

export function loadLesson(folder){
  const root = path.resolve(folder);
  const file = path.join(root, 'lesson.json');
  if (!existsSync(file)) throw new Error('이 폴더에는 lesson.json이 없습니다. 수업 폴더를 골라 주세요.');
  let data;
  try { data = JSON.parse(readFileSync(file, 'utf8')); }
  catch (e) { throw new Error(`lesson.json을 읽지 못했습니다: ${e.message}`); }
  if (data.schema !== 1) throw new Error(`이 체험판이 모르는 형식입니다 (schema ${data.schema}). 사이드바를 업데이트해 주세요.`);

  const sections = [];
  const items = [];
  const seen = new Set();
  for (const s of Array.isArray(data.sections) ? data.sections : []){
    const sec = { id: String(s.id), title: String(s.title ?? ''), minutes: Number(s.minutes) || 0, items: [] };
    for (const raw of Array.isArray(s.items) ? s.items : []){
      const it = {
        id: String(raw.id),
        section: sec.id,
        type: TYPES.has(raw.type) ? raw.type : 'file',
        title: String(raw.title ?? '').normalize('NFC'),
        start: raw.start ? String(raw.start) : '',
        screen: raw.screen === 'teacher' || raw.screen === 'student' ? raw.screen : null,
        url: null, file: null, abs: null, problem: null,
      };
      if (seen.has(it.id)) it.problem = '자료 번호(id)가 겹칩니다';
      seen.add(it.id);
      if (raw.url){
        try {
          const u = new URL(String(raw.url));
          if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error();
          it.url = u.href;
        } catch { it.problem = '주소가 올바르지 않습니다 (http/https만 열 수 있습니다)'; }
      }
      if (raw.file){
        const rel = String(raw.file).normalize('NFC');
        const abs = path.resolve(root, rel);
        if (!abs.startsWith(root + path.sep)) it.problem = '수업 폴더 밖의 파일은 열지 않습니다';
        else if (!existsSync(abs)) it.problem = '파일이 없습니다 (아직 동기화 중일 수 있습니다)';
        else { it.file = path.relative(root, abs).split(path.sep).join('/'); it.abs = abs; }
      }
      sec.items.push(it);
      items.push(it);
    }
    sections.push(sec);
  }
  return { root, title: String(data.title ?? path.basename(root)).normalize('NFC'), date: String(data.date ?? ''), sections, items };
}
