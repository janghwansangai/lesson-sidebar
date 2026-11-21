// 수업 폴더 잠금: 지금 어느 PC에서 이 수업을 열었는지 (.sidebar/locks/<PC 이름>.json).
// PC마다 자기 파일만 쓴다. 한 파일을 여러 PC가 번갈아 쓰면 서로의 표시를 지우고,
// 구글 드라이브가 충돌 사본을 만들 수 있기 때문이다.
// 클라우드 동기화에는 시간이 걸리므로 "경고"용이다. 완전히 막지는 않는다.
import { readFileSync, writeFileSync, mkdirSync, unlinkSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const FRESH_MS = 5 * 60 * 1000;

export function deviceName(){
  return os.hostname().replace(/\.local$/i, '') || '이 PC';
}

const lockDir = root => path.join(root, '.sidebar', 'locks');
const fileName = device => String(device).normalize('NFC').replace(/[^\p{L}\p{N}_.-]+/gu, '_').slice(0, 60) + '.json';
const lockFile = (root, device) => path.join(lockDir(root), fileName(device));

/** 모든 PC의 잠금 [{ device, at }] */
export function readLocks(root){
  let names = [];
  try { names = readdirSync(lockDir(root)); } catch { return []; }
  const out = [];
  for (const n of names){
    if (!n.endsWith('.json')) continue;
    try {
      const l = JSON.parse(readFileSync(path.join(lockDir(root), n), 'utf8'));
      if (l && typeof l.device === 'string' && Number.isFinite(Number(l.at))) out.push({ device: l.device, at: Number(l.at) });
    } catch { /* 동기화 중 반쯤 쓰인 파일은 건너뜀 */ }
  }
  return out;
}

export function writeLock(root, device = deviceName()){
  try {
    mkdirSync(lockDir(root), { recursive: true });
    writeFileSync(lockFile(root, device), JSON.stringify({ device, at: Date.now() }));
  } catch { /* 잠금은 경고용이라 실패해도 계속 */ }
}

export function clearLock(root, device = deviceName()){
  try { unlinkSync(lockFile(root, device)); } catch { /* 이미 없음 */ }
}

/** 다른 PC가 최근(5분 안)에 연 기록 중 가장 최근 것. 없으면 null. */
export function otherLock(root, device = deviceName(), now = Date.now()){
  return readLocks(root)
    .filter(l => l.device !== device && now - l.at < FRESH_MS)
    .sort((a, b) => b.at - a.at)[0] ?? null;
}
