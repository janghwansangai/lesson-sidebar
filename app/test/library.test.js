// 수업 보관함: 화면에 보일 짧은 위치, 구글 드라이브 알아보기, 보관함 옮기기
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { shortPath, maskEmail, suggestRoots, libraryProblem, moveLesson, listLessons } from '../src/core/library.js';

const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'lib-'));

test('화면에 보일 위치에는 사용자 이름·이메일이 없다', () => {
  const mac = { platform: 'darwin', home: '/Users/t' };
  assert.equal(shortPath('/Users/t/Library/CloudStorage/GoogleDrive-a@b.c/내 드라이브/수업 사이드바', mac), '구글 드라이브 › 내 드라이브 › 수업 사이드바');
  assert.equal(shortPath('/Users/t/Library/CloudStorage/OneDrive-개인/문서', mac), 'OneDrive › 문서');
  assert.equal(shortPath('/Users/t/Library/Mobile Documents/com~apple~CloudDocs/수업', mac), 'iCloud Drive › 수업');
  assert.equal(shortPath('/Users/t/Downloads/1_포트폴리오', mac), '다운로드 › 1_포트폴리오');
  assert.equal(shortPath('/Users/t/Documents/수업 사이드바', mac), '문서 › 수업 사이드바');
  assert.equal(shortPath('/Users/t/수업', mac), '홈 › 수업');
  assert.equal(shortPath('/Users/t', mac), '홈');
  assert.equal(shortPath('/Users/tt/수업', mac), 'Users › tt › 수업');   // 이름이 비슷한 다른 폴더를 홈으로 보지 않는다
  assert.equal(shortPath('/Volumes/USB/수업', mac), 'USB › 수업');
  const win = { platform: 'win32', home: 'C:\\Users\\kim' };
  assert.equal(shortPath('C:\\Users\\Kim\\Desktop\\수업', win), '바탕 화면 › 수업');
  assert.equal(shortPath('C:\\Users\\kim\\OneDrive - 학교\\문서\\수업', win), 'OneDrive › 문서 › 수업');
  assert.equal(shortPath('G:\\내 드라이브\\수업 사이드바', win), '구글 드라이브 (G:) › 내 드라이브 › 수업 사이드바');
  assert.equal(shortPath('g:\\공유 드라이브\\우리 학교', win), '구글 드라이브 (G:) › 공유 드라이브 › 우리 학교');
  assert.equal(shortPath('d:\\자료', win), 'D: › 자료');
  assert.equal(shortPath('', win), '');
});

test('이메일은 앞 두 글자만 보인다', () => {
  assert.equal(maskEmail('teacher@example.com'), 'te•••@example.com');
  assert.equal(maskEmail('ab'), 'ab•••');
});

test('맥: 구글 드라이브 계정이 하나면 이메일 없이, 여럿이면 가린 이메일로 나눈다', () => {
  const dirs = { '/Users/t/Library/CloudStorage': ['GoogleDrive-one@x.kr', 'Dropbox'] };
  const has = new Set(['/Users/t/Library/CloudStorage/GoogleDrive-one@x.kr/내 드라이브']);
  const o = { platform: 'darwin', home: '/Users/t', env: {}, exists: p => has.has(p), readdir: p => { if (!dirs[p]) throw new Error('없음'); return dirs[p]; } };
  let r = suggestRoots(o);
  assert.equal(r[0].label, '구글 드라이브');
  assert.ok(!r.some(s => s.label.includes('one@')));
  dirs['/Users/t/Library/CloudStorage'].push('GoogleDrive-two@y.kr');
  has.add('/Users/t/Library/CloudStorage/GoogleDrive-two@y.kr/My Drive');
  r = suggestRoots(o);
  assert.deepEqual(r.filter(s => s.kind === 'drive').map(s => s.label), ['구글 드라이브 (on•••@x.kr)', '구글 드라이브 (tw•••@y.kr)']);
  assert.equal(r.at(-1).kind, 'documents');
});

test('윈도우: 구글 드라이브 데스크톱이 깔려 있고, 그 드라이브 맨 위에 구글 폴더만 있어야 구글 드라이브로 붙인다', () => {
  const tops = {
    'G:\\': ['내 드라이브', '공유 드라이브', '$RECYCLE.BIN', 'desktop.ini'],
    'H:\\': ['공유 드라이브', '내 드라이브', '다른 컴퓨터', '.shortcut-targets-by-id', '$RECYCLE.BIN', '.Encrypted'],   // 2026-11-23 윈도우 선생님 PC의 실제 구글 드라이브 모양
    'D:\\': ['내 드라이브', '사진', '게임'],          // 다른 디스크에 같은 이름 폴더만 있는 경우
    'Z:\\': ['My Drive', '백업'],                      // NAS 등
  };
  const base = { platform: 'win32', home: 'C:\\Users\\kim', readdir: p => { if (!tops[p]) throw new Error('없음'); return tops[p]; } };
  const drives = o => suggestRoots({ ...base, ...o }).filter(s => s.kind === 'drive');
  const installed = { env: { LOCALAPPDATA: 'C:\\Users\\kim\\AppData\\Local' }, exists: p => p === 'C:\\Users\\kim\\AppData\\Local\\Google\\DriveFS' };
  assert.deepEqual(drives(installed).map(s => [s.label, s.path]), [['구글 드라이브 (G:)', 'G:\\내 드라이브\\수업 사이드바'], ['구글 드라이브 (H:)', 'H:\\내 드라이브\\수업 사이드바']]);
  assert.deepEqual(drives({ env: { LOCALAPPDATA: 'C:\\Users\\kim\\AppData\\Local' }, exists: () => false }), []);   // 구글 드라이브 데스크톱이 없음
  const docs = suggestRoots({ ...installed, ...base }).at(-1);
  assert.equal(docs.label, '이 PC의 문서 폴더');
  assert.equal(docs.path, 'C:\\Users\\kim\\Documents\\수업 사이드바');
});

function lesson(root, name, files = { 'lesson.json': JSON.stringify({ title: name, date: '2026-11-23', sections: [] }) }){
  const dir = path.join(root, name);
  for (const [f, c] of Object.entries(files)){ mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); writeFileSync(path.join(dir, f), c); }
  return dir;
}

test('수업 폴더나 수업 폴더 안은 보관함으로 쓰지 않는다', () => {
  const lib = tmp();
  const a = lesson(lib, 'A수업');
  const lessons = listLessons(lib);
  assert.match(libraryProblem(a, lessons), /수업 폴더입니다/);
  mkdirSync(path.join(a, '하위'));
  assert.match(libraryProblem(path.join(a, '하위'), lessons), /A수업' 수업 폴더 안/);
  assert.equal(libraryProblem(path.join(lib, '새 보관함'), lessons), null);
});

test('같은 디스크면 이름만 바꿔 옮긴다', async () => {
  const from = tmp(), to = tmp();
  const src = lesson(from, '수업1', { 'lesson.json': '{"title":"수업1"}', '1_도입/자료.pdf': 'pdf' });
  let trashed = 0;
  const r = await moveLesson(src, to, { trash: async () => { trashed++; } });
  assert.equal(r.how, 'rename');
  assert.equal(trashed, 0);
  assert.ok(!existsSync(src));
  assert.equal(readFileSync(path.join(to, '수업1', '1_도입', '자료.pdf'), 'utf8'), 'pdf');
});

test('동기화 폴더 밖으로 옮길 때는 복사·확인 뒤 원래 폴더를 휴지통으로', async () => {
  const from = path.join(tmp(), 'Google Drive', '수업 사이드바'); mkdirSync(from, { recursive: true });
  const to = tmp();
  const src = lesson(from, '수업2', { 'lesson.json': '{"title":"수업2"}', '_녹화/녹화.mp4': 'x'.repeat(5000), '2_전개/활동지.hwp': 'hwp' });
  const trashed = [];
  const r = await moveLesson(src, to, { trash: async f => { trashed.push(f); rmSync(f, { recursive: true }); } });
  assert.equal(r.how, 'copy');
  assert.deepEqual(trashed, [src]);
  assert.equal(readFileSync(path.join(to, '수업2', '_녹화', '녹화.mp4'), 'utf8').length, 5000);
  assert.equal(readFileSync(path.join(to, '수업2', '2_전개', '활동지.hwp'), 'utf8'), 'hwp');
});

test('휴지통에 넣지 못하면 원래 폴더를 남기고 알려 준다', async () => {
  const from = path.join(tmp(), 'Google Drive'); mkdirSync(from);
  const to = tmp();
  const src = lesson(from, '수업3');
  const r = await moveLesson(src, to, { trash: async () => { throw new Error('휴지통 없음'); } });
  assert.equal(r.kept, true);
  assert.ok(existsSync(src) && existsSync(path.join(to, '수업3', 'lesson.json')));
});

test('새 보관함에 같은 이름이 있으면 옮기지 않는다', async () => {
  const from = tmp(), to = tmp();
  const src = lesson(from, '수업4'); lesson(to, '수업4');
  await assert.rejects(moveLesson(src, to, { trash: async () => {} }), /같은 이름/);
  assert.ok(existsSync(path.join(src, 'lesson.json')));
});
