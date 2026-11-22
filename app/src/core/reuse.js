// 정리와 재사용 (docs/PLAN.md 13 3단계): 수업 복제, 검색어, 수업 안내 페이지, 충돌 사본 찾기·고르기.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { safeName, TEMP_FILE } from './types.js';

const SKIP_DIRS = new Set(['.sidebar', '_녹화', '_캡처']);   // 복제할 때 빼는 것: 잠금·백업·휴지통, 녹화·캡처(학생 정보가 담길 수 있음)
const p2 = n => String(n).padStart(2, '0');
const nowStamp = () => { const d = new Date(); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`; };

/**
 * 수업을 통째로 복사해 새 수업을 만든다 ("2차 연수"). 자료 파일·순서·메모·저장한 배치는 그대로,
 * 수업 번호는 새로, 녹화·캡처·잠금·백업은 빼고.
 * @returns 새 수업 폴더
 */
export function duplicateLesson(srcRoot, libraryRoot, { title, date } = {}){
  const src = JSON.parse(readFileSync(path.join(srcRoot, 'lesson.json'), 'utf8'));
  title = String(title ?? '').trim().normalize('NFC') || `${src.title ?? '수업'} (사본)`;
  date = /^\d{4}-\d{2}-\d{2}$/.test(String(date)) ? String(date) : String(src.date ?? '');
  const base = `${date ? date + '_' : ''}${safeName(title)}`;
  let dest = path.join(libraryRoot, base);
  for (let i = 2; existsSync(dest); i++) dest = path.join(libraryRoot, `${base}_${i}`);
  cpSync(srcRoot, dest, { recursive: true, filter: s => {
    const rel = path.relative(srcRoot, s);
    if (!rel) return true;
    const first = rel.split(path.sep)[0], leaf = path.basename(s);
    return !SKIP_DIRS.has(first) && !TEMP_FILE.test(leaf) && !/^lesson.*\(\d+\)\.json$/i.test(leaf);
  } });
  const d = { ...src, id: `les_${randomBytes(4).toString('hex')}`, title, date };
  delete d.updatedAt; delete d.device;
  writeFileSync(path.join(dest, 'lesson.json'), JSON.stringify(d, null, 2) + '\n');
  return dest;
}

/** 지난 수업 검색에 쓰는 글: 수업 이름·날짜·구간·자료 이름·링크 (소문자, NFC) */
export function searchText(d){
  const parts = [d?.title, d?.date];
  for (const s of d?.sections ?? []){ parts.push(s?.title); for (const it of s?.items ?? []) parts.push(it?.title, it?.url); }
  return parts.filter(Boolean).join(' ').normalize('NFC').toLowerCase();
}
/** 검색어의 모든 낱말이 들어 있으면 맞음 */
export const matches = (text, q) => String(q ?? '').normalize('NFC').toLowerCase().split(/\s+/).filter(Boolean).every(w => text.includes(w));

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KIND = { web: '웹사이트', youtube: '유튜브', gdoc: '구글 문서', gsheet: '구글 시트', gslides: '구글 슬라이드', gdrive: '구글 드라이브', canva: '캔바',
  pdf: 'PDF', pptx: '파워포인트', ppt: '파워포인트', xlsx: '엑셀', xls: '엑셀', hwp: '한글', hwpx: '한글', img: '그림', audio: '소리', video: '영상', memo: '메모', file: '파일' };

/**
 * 참여자에게 나눠 줄 수업 안내 페이지 (HTML 한 파일, 인터넷 없이 열림). 진행 메모는 넣지 않는다(교사용).
 * 링크 자료는 누를 수 있고, 파일 자료는 이름만 (파일은 따로 나눔).
 */
export function guideHtml(d){
  const secs = (d?.sections ?? []).map(s => {
    const items = (s.items ?? []).filter(it => it.type !== 'memo').map(it => {
      const kind = KIND[it.type] ?? '자료';
      const name = esc(it.title);
      return it.url && /^https?:\/\//i.test(it.url)
        ? `<li><a href="${esc(it.url)}" target="_blank" rel="noopener">${name}</a> <span class="k">${kind}</span></li>`
        : `<li>${name} <span class="k">${kind}</span></li>`;
    }).join('');
    return `<section><h2>${esc(s.title)}${s.minutes ? ` <span class="m">${Number(s.minutes)}분</span>` : ''}</h2>${items ? `<ol>${items}</ol>` : '<p class="e">자료 없음</p>'}</section>`;
  }).join('\n');
  const total = (d?.sections ?? []).reduce((a, s) => a + (Number(s.minutes) || 0), 0);
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(d?.title)} 수업 안내</title>
<style>
:root{color-scheme:light dark;--fg:#16211d;--muted:#56665f;--line:#d3dbd5;--accent:#1f6b4f;--bg:#f7f8f6}
@media (prefers-color-scheme:dark){:root{--fg:#e4ebe7;--muted:#95a69f;--line:#2b3934;--accent:#7dd3b3;--bg:#0f1513}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 -apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif}
main{max-width:720px;margin:0 auto;padding:32px 16px 48px}
h1{font-size:26px;margin:0 0 4px}.sub{color:var(--muted);margin:0 0 24px}
section{border-top:1px solid var(--line);padding:16px 0}h2{font-size:18px;margin:0 0 8px}.m{color:var(--muted);font-weight:400;font-size:14px}
ol{margin:0;padding-left:22px}li{margin:4px 0}a{color:var(--accent)}.k{color:var(--muted);font-size:13px}.e{color:var(--muted);margin:0}
</style></head><body><main>
<h1>${esc(d?.title)}</h1><p class="sub">${esc(d?.date)}${total ? ` · 약 ${total}분` : ''}</p>
${secs}
</main></body></html>
`;
}

/** 구글 드라이브·원드라이브 등이 만든 충돌 사본 ("lesson (1).json", "lesson 2.json", "lesson-PC이름.json" 등)과 요약 */
export function findConflicts(root){
  let names = [];
  try { names = readdirSync(root); } catch { return []; }
  const sum = f => {
    try {
      const d = JSON.parse(readFileSync(path.join(root, f), 'utf8'));
      if (d?.schema !== 1) return null;
      const items = (d.sections ?? []).reduce((a, s) => a + (s.items?.length ?? 0), 0);
      return { file: f, title: String(d.title ?? ''), items, sections: (d.sections ?? []).length, updatedAt: d.updatedAt ?? null, device: d.device ?? null };
    } catch { return null; }
  };
  // lesson (1).json·lesson(1).json(구글 드라이브), lesson 2.json, lesson-<PC 이름>.json(원드라이브), "충돌"·"conflict"가 든 이름(드롭박스 등).
  // 맨 위의 lesson-….json은 사이드바가 만들지 않는다 (백업은 .sidebar/backup/에) → 수업 파일 모양(schema 1)이면 사본으로 본다
  const copies = names.filter(n => n !== 'lesson.json' && /^lesson(\s*\(\d+\)|\d+|[ _-].+)\.json$/i.test(n.normalize('NFC'))).map(sum).filter(Boolean);
  if (!copies.length) return [];
  return [sum('lesson.json') ?? { file: 'lesson.json', broken: true }, ...copies];
}

/**
 * 충돌 사본 중 하나를 고른다. 고른 것이 lesson.json이 되고, 나머지는 모두 .sidebar/backup/에 남긴다 (지우지 않음).
 */
export function resolveConflict(root, pick){
  const all = findConflicts(root);
  if (!all.some(c => c.file === pick)) throw new Error('고른 사본을 찾지 못했습니다');
  const keep = path.join(root, '.sidebar', 'backup');
  mkdirSync(keep, { recursive: true });
  const stamp = nowStamp();
  for (const c of all){
    if (c.file === pick) continue;
    renameSync(path.join(root, c.file), path.join(keep, `충돌전_${stamp}_${c.file.replace(/[^\p{L}\p{N}._-]+/gu, '_')}`));
  }
  if (pick !== 'lesson.json') renameSync(path.join(root, pick), path.join(root, 'lesson.json'));
  return { kept: all.length - 1 };
}
