// 안전 점검 (2026-11-22): 수업 파일의 실행 파일 막기, 파일 제공 서버가 폴더 밖·끊긴 읽기에 멈추지 않기
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadLesson } from '../src/core/lesson.js';
import { startFileServer } from '../src/core/fileserver.js';

const lessonWith = files => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'safe-'));
  for (const f of files) writeFileSync(path.join(root, f), 'x');
  writeFileSync(path.join(root, 'lesson.json'), JSON.stringify({ schema: 1, title: '시험', sections: [{ id: 's1', title: '도입', items: files.map((f, i) => ({ id: `i${i}`, type: 'file', title: f, file: f })) }] }));
  return root;
};

test('수업 파일에 적힌 실행 파일·스크립트는 열지 않는다 (공유받은 수업이어도)', () => {
  const root = lessonWith(['활동지.pdf', 'setup.exe', 'run.bat', 'open.command', 'tool.js', '바로가기.lnk']);
  const L = loadLesson(root);
  const byTitle = Object.fromEntries(L.items.map(it => [it.title, it]));
  assert.equal(byTitle['활동지.pdf'].problem, null);
  for (const n of ['setup.exe', 'run.bat', 'open.command', 'tool.js', '바로가기.lnk']){
    assert.match(byTitle[n].problem ?? '', /실행 파일/, n);
    assert.equal(byTitle[n].abs, null, n);
  }
  rmSync(root, { recursive: true, force: true });
});

test('파일 제공 서버: 폴더 밖을 가리키는 바로 가기는 주지 않고, 없는 파일·잘못된 요청에도 멈추지 않는다', { skip: process.platform === 'win32' }, async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'fs-'));
  const outside = mkdtempSync(path.join(os.tmpdir(), 'out-'));
  writeFileSync(path.join(outside, 'secret.txt'), '비밀');
  mkdirSync(path.join(root, 'a'));
  writeFileSync(path.join(root, 'a', 'ok.txt'), '좋음');
  writeFileSync(path.join(root, 'a', 'hello.txt'), 'hello');
  symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'a', 'link.txt'));
  const fsrv = await startFileServer(() => root);
  try {
    assert.equal(await (await fetch(fsrv.url('a/ok.txt'))).text(), '좋음');
    assert.equal((await fetch(fsrv.url('a/link.txt'))).status, 403);
    assert.equal((await fetch(fsrv.url('../' + path.basename(outside) + '/secret.txt'))).status, 404);   // fetch가 ..를 정리 → 열쇠 없는 경로
    assert.equal((await fetch(fsrv.url('a/없음.txt'))).status, 404);
    const base = fsrv.url('a/ok.txt').replace(/a\/ok\.txt$/, '');
    assert.equal((await fetch(base + '%E0%A4%A')).status, 400);                          // 잘못된 글자 인코딩
    assert.equal((await fetch(fsrv.url('a/ok.txt').replace(/\/[0-9a-f]{32}\//, '/틀린열쇠/'))).status, 404);
    assert.equal(await (await fetch(fsrv.url('a/hello.txt'), { headers: { Range: 'bytes=1-' } })).text(), 'ello');
  } finally {
    fsrv.close();
    rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true });
  }
});
