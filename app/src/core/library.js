// 수업 보관함: 수업 폴더들이 들어 있는 상위 폴더 (보통 구글 드라이브의 "수업 사이드바").
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { otherLock } from './lock.js';

export const LIB_NAME = '수업 사이드바';

/** 보관함으로 쓸 만한 위치. 구글 드라이브 데스크톱이 있으면 먼저. */
export function suggestRoots(){
  const home = os.homedir();
  const out = [];
  const cs = path.join(home, 'Library', 'CloudStorage');
  try {
    for (const d of readdirSync(cs)){
      if (!d.startsWith('GoogleDrive-')) continue;
      for (const my of ['내 드라이브', 'My Drive']){
        const p = path.join(cs, d, my);
        if (existsSync(p)) out.push({ kind: 'drive', label: `구글 드라이브 (${d.replace('GoogleDrive-', '')})`, path: path.join(p, LIB_NAME) });
      }
    }
  } catch { /* 구글 드라이브 없음 */ }
  if (process.platform === 'win32'){
    // 윈도우의 구글 드라이브 데스크톱은 드라이브 문자(보통 G:)로 붙는다
    for (const letter of 'GHIJKLMNOPQRSTUVWXYZDEF'){
      for (const my of ['내 드라이브', 'My Drive']){
        const p = `${letter}:\\${my}`;
        if (existsSync(p)) out.push({ kind: 'drive', label: `구글 드라이브 (${letter}:)`, path: path.join(p, LIB_NAME) });
      }
    }
  }
  out.push({ kind: 'documents', label: process.platform === 'win32' ? '이 PC의 문서 폴더' : '이 맥의 문서 폴더', path: path.join(home, 'Documents', LIB_NAME) });
  return out;
}

/** 보관함 안의 수업 목록 (lesson.json이 있는 폴더). 최근 날짜 순. */
export function listLessons(root){
  if (!root || !existsSync(root)) return [];
  const out = [];
  let names = [];
  try { names = readdirSync(root); } catch { return []; }
  for (const name of names){
    if (name.startsWith('.')) continue;
    const dir = path.join(root, name);
    const f = path.join(dir, 'lesson.json');
    try {
      if (!statSync(dir).isDirectory() || !existsSync(f)) continue;
      const d = JSON.parse(readFileSync(f, 'utf8'));
      const count = (d.sections ?? []).reduce((a, s) => a + (s.items?.length ?? 0), 0);
      const lock = otherLock(dir);
      out.push({ folder: dir, name: name.normalize('NFC'), title: String(d.title ?? name).normalize('NFC'), date: String(d.date ?? ''),
        count, updatedAt: d.updatedAt ?? null, device: d.device ?? null, lockedBy: lock?.device ?? null });
    } catch {
      out.push({ folder: dir, name: name.normalize('NFC'), title: name.normalize('NFC'), date: '', count: 0, broken: true });
    }
  }
  return out.sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.name.localeCompare(b.name));
}
