// 업데이트 바꿔 깔기: 받기(진행·크기 확인), 맥 앱 위치, 남은 옛 앱 찾기, 갈아 끼우기 스크립트
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { download, currentMacApp, leftovers, MAC_SWAP } from '../src/core/selfupdate.js';

const fakeFetch = (chunks, { status = 200, length } = {}) => async () => new Response(new ReadableStream({
  start(c){ for (const x of chunks) c.enqueue(new TextEncoder().encode(x)); c.close(); },
}), { status, headers: length != null ? { 'content-length': String(length) } : {} });

test('받기: 파일로 쓰고 진행을 알리며, 크기가 다르면 오류', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'upd-'));
  const seen = [];
  const n = await download('https://x/a.dmg', path.join(dir, 'a.dmg'), { fetchFn: fakeFetch(['ab', 'cd', 'ef'], { length: 6 }), onProgress: p => seen.push(p) });
  assert.equal(n, 6);
  assert.equal(readFileSync(path.join(dir, 'a.dmg'), 'utf8'), 'abcdef');
  assert.deepEqual(seen, [33, 66, 100]);
  await assert.rejects(download('https://x/b', path.join(dir, 'b'), { fetchFn: fakeFetch(['abc']), expected: 10 }), /크기가 맞지 않습니다/);
  await assert.rejects(download('https://x/c', path.join(dir, 'c'), { fetchFn: fakeFetch([], { status: 404 }) }), /HTTP 404/);
  rmSync(dir, { recursive: true, force: true });
});

test('맥 앱 위치: 응용 프로그램 폴더의 앱만 (설치 파일 창에서 켠 것은 아님)', () => {
  assert.equal(currentMacApp('/Applications/LessonSidebar.app/Contents/MacOS/LessonSidebar'), '/Applications/LessonSidebar.app');
  assert.equal(currentMacApp('/Volumes/수업 사이드바 0.3.1/LessonSidebar.app/Contents/MacOS/LessonSidebar'), null);
  assert.equal(currentMacApp('/usr/local/bin/node'), null);
});

test('남은 옛 앱: .<이름>.old-….app만', () => {
  const dest = '/Applications/LessonSidebar.app';
  assert.deepEqual(leftovers(dest, ['LessonSidebar.app', '.LessonSidebar.old-20261122.app', '.LessonSidebar.updating.app', '.Other.old-1.app', 'Safari.app']),
    ['/Applications/.LessonSidebar.old-20261122.app']);
});

test('갈아 끼우기: 사이드바가 끝나면 새 앱으로 바꾸고 옛 앱은 .old-로 남긴다', { skip: process.platform === 'win32' }, () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'swap-'));
  const dest = path.join(dir, 'LessonSidebar.app'), staged = path.join(dir, '.LessonSidebar.updating.app');
  mkdirSync(dest); writeFileSync(path.join(dest, 'v'), '0.3.1');
  mkdirSync(staged); writeFileSync(path.join(staged, 'v'), '0.3.2');
  const gone = spawnSync('true').pid;   // 이미 끝난 프로세스 = 끝난 사이드바
  const r = spawnSync('/bin/bash', ['-c', MAC_SWAP, 'swap', String(gone), staged, dest, '0']);
  assert.equal(r.status, 0);
  assert.equal(readFileSync(path.join(dest, 'v'), 'utf8'), '0.3.2');
  assert.equal(existsSync(staged), false);
  const old = leftovers(dest, readdirSync(dir));
  assert.equal(old.length, 1);
  assert.equal(readFileSync(path.join(old[0], 'v'), 'utf8'), '0.3.1');
  rmSync(dir, { recursive: true, force: true });
});
