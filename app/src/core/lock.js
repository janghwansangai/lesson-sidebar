// 수업 폴더 잠금 파일 (.sidebar/lock.json): 지금 어느 PC에서 이 수업을 열었는지.
// 클라우드 동기화에는 시간이 걸리므로 "경고"용이다. 완전히 막지는 않는다.
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const FRESH_MS = 5 * 60 * 1000;

export function deviceName(){
  return os.hostname().replace(/\.local$/i, '') || '이 PC';
}

const lockPath = root => path.join(root, '.sidebar', 'lock.json');

export function readLock(root){
  try { return JSON.parse(readFileSync(lockPath(root), 'utf8')); } catch { return null; }
}

export function writeLock(root, device = deviceName()){
  try {
    mkdirSync(path.dirname(lockPath(root)), { recursive: true });
    writeFileSync(lockPath(root), JSON.stringify({ device, at: Date.now() }));
  } catch { /* 잠금은 경고용이라 실패해도 계속 */ }
}

export function clearLock(root, device = deviceName()){
  if (readLock(root)?.device === device){ try { unlinkSync(lockPath(root)); } catch { /* 이미 없음 */ } }
}

/** 다른 PC가 최근(5분 안)에 잡은 잠금이 있으면 그 정보를 돌려준다. */
export function otherLock(root, device = deviceName(), now = Date.now()){
  const l = readLock(root);
  return l && l.device !== device && now - Number(l.at) < FRESH_MS ? l : null;
}
