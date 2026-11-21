// 준비 화면 로직 시험: 임시 폴더에서 실제로 파일을 복사·이동한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, readdirSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LessonDoc } from '../src/core/editor.js';
import { detectUrl, safeName, typeOfFile } from '../src/core/types.js';
import { listLessons } from '../src/core/library.js';
import { writeLock, otherLock, readLocks, clearLock } from '../src/core/lock.js';
import { loadLesson } from '../src/core/lesson.js';

const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'prep-'));
function sourceFiles(){
  const d = tmp();
  for (const [n, c] of [['수업자료 발표.pptx', 'ppt'], ['활동지.hwp', 'hwp'], ['연수 안내.pdf', 'pdf'], ['설치.exe', 'x']]) writeFileSync(path.join(d, n), c);
  return d;
}

test('링크 종류를 알아본다', () => {
  assert.equal(detectUrl('https://youtu.be/abc?t=95').type, 'youtube');
  assert.equal(detectUrl('https://youtu.be/abc?t=95').start, '1:35');
  assert.equal(detectUrl('docs.google.com/spreadsheets/d/x').type, 'gsheet');
  assert.equal(detectUrl('https://www.canva.com/design/x/view').type, 'canva');
  assert.equal(detectUrl('https://example.com').title, 'example.com');
  assert.ok(detectUrl('javascript:alert(1)').error);
  assert.ok(detectUrl('그냥 글자').error);
});

test('파일 이름은 윈도우·맥 어디서나 쓸 수 있게 만든다', () => {
  assert.equal(safeName('활동지: AI 수업 설계'), '활동지_AI수업설계');
  assert.equal(safeName('a/b\\c*?"<>|d'), 'abcd');
  assert.equal(safeName('CON'), '_CON');
  assert.equal(safeName('   '), '자료');
  assert.equal(safeName('발표'.normalize('NFD')), '발표');   // 맥 NFD → NFC
  assert.equal(typeOfFile('a.HWPX'), 'hwp');
});

test('새 수업 폴더를 "날짜_제목"으로 만들고 구간 3개를 넣는다', () => {
  const lib = tmp();
  const doc = LessonDoc.create(lib, { title: 'AI 활용 연수 (2차)', date: '2026-12-05' });
  assert.equal(path.basename(doc.root), '2026-12-05_AI활용연수(2차)');
  assert.deepEqual(doc.data.sections.map(s => s.title), ['도입', '전개', '정리']);
  const again = LessonDoc.create(lib, { title: 'AI 활용 연수 (2차)', date: '2026-12-05' });
  assert.ok(again.root.endsWith('_2'));
  const list = listLessons(lib);
  assert.equal(list.length, 2);
  assert.equal(list[0].title, 'AI 활용 연수 (2차)');
});

test('파일을 수업 폴더로 복사하고(원본 유지), 실행 파일은 거른다', async () => {
  const src = sourceFiles();
  const doc = LessonDoc.create(tmp(), { title: '시험', date: '2026-12-05' });
  const [intro, main] = doc.data.sections;
  const r = await doc.addFiles(['수업자료 발표.pptx', '활동지.hwp', '설치.exe'].map(n => path.join(src, n)), main.id);
  assert.equal(r.added.length, 2);
  assert.equal(r.skipped[0].reason, '실행 파일은 넣지 않습니다');
  assert.equal(r.added[0].file, '2_전개/01_수업자료발표.pptx');
  assert.equal(r.added[1].file, '2_전개/02_활동지.hwp');
  assert.ok(existsSync(path.join(src, '활동지.hwp')));   // 원본 그대로
  assert.equal(readFileSync(path.join(doc.root, r.added[1].file), 'utf8'), 'hwp');
  doc.addMemo(intro.id);
  doc.addLink('https://youtu.be/abc?t=45', intro.id);
  doc.save();
  // 사이드바가 그대로 읽을 수 있어야 한다
  const lesson = loadLesson(doc.root);
  assert.equal(lesson.items.length, 4);
  assert.deepEqual(lesson.items.filter(i => i.problem), []);
  assert.equal(lesson.items.find(i => i.type === 'memo').screen, 'teacher');
});

test('순서를 바꾸고 "정리하기"하면 파일 이름·폴더가 새 순서를 따른다 (열린 파일은 건너뜀)', async () => {
  const src = sourceFiles();
  const doc = LessonDoc.create(tmp(), { title: '시험', date: '2026-12-05' });
  const [intro, main, end] = doc.data.sections;
  const r = await doc.addFiles(['수업자료 발표.pptx', '활동지.hwp', '연수 안내.pdf'].map(n => path.join(src, n)), main.id);
  const [ppt, hwp, pdf] = r.added;
  doc.moveItem(pdf.id, intro.id);            // 안내를 도입으로
  doc.moveItem(hwp.id, end.id);              // 활동지를 정리로
  doc.updateItem(ppt.id, { title: '1부 생성형 AI' });
  const t = doc.tidy(new Set([hwp.id]));     // 활동지는 열려 있다고 가정
  assert.deepEqual(t.renamed.map(x => x.to), ['1_도입/01_연수안내.pdf', '2_전개/02_1부생성형AI.pptx']);
  assert.equal(t.skipped[0].reason, '열려 있어 다음에 정리합니다');
  assert.ok(existsSync(path.join(doc.root, '1_도입/01_연수안내.pdf')));
  doc.tidy();                                // 닫힌 뒤 다시 정리
  assert.equal(doc.locate(hwp.id).item.file, '3_정리/03_활동지.hwp');
  assert.deepEqual(readdirSync(path.join(doc.root, '2_전개')), ['02_1부생성형AI.pptx']);
});

test('자료를 빼면 파일은 .sidebar/휴지통으로 간다', async () => {
  const src = sourceFiles();
  const doc = LessonDoc.create(tmp(), { title: '시험', date: '2026-12-05' });
  const r = await doc.addFiles([path.join(src, '활동지.hwp')], doc.data.sections[1].id);
  doc.removeItem(r.added[0].id);
  assert.equal(doc.allItems().length, 0);
  const trash = readdirSync(path.join(doc.root, '.sidebar', '휴지통'));
  assert.equal(trash.length, 1);
  assert.match(trash[0], /활동지\.hwp$/);
});

test('이름이 같은 파일 두 개를 곧바로 빼도 휴지통에서 서로 덮지 않는다', async () => {
  const src = sourceFiles();
  const doc = LessonDoc.create(tmp(), { title: '시험', date: '2026-12-05' });
  const main = doc.data.sections[1];
  const a = (await doc.addFiles([path.join(src, '활동지.hwp')], main.id)).added[0];
  doc.removeItem(a.id);                                          // 뺐다가
  const b = (await doc.addFiles([path.join(src, '활동지.hwp')], main.id)).added[0];
  assert.equal(b.file, a.file);                                  // 다시 넣으면 같은 이름 2_전개/01_활동지.hwp
  doc.removeItem(b.id);                                          // 같은 초에 또 빼도
  assert.equal(readdirSync(path.join(doc.root, '.sidebar', '휴지통')).length, 2);
});

test('저장은 바꿔치기로 하고 백업은 최근 10개만 남긴다', () => {
  const doc = LessonDoc.create(tmp(), { title: '시험', date: '2026-12-05' });
  for (let i = 0; i < 14; i++){ doc.backedUpAt = 0; doc.setInfo({ title: `시험 ${i}` }); doc.save(); }   // 1분씩 지났다고 치고
  const backups = readdirSync(path.join(doc.root, '.sidebar', 'backup'));
  assert.ok(backups.length <= 10);
  assert.equal(JSON.parse(readFileSync(doc.file, 'utf8')).title, '시험 13');
  assert.ok(!readdirSync(doc.root).some(f => f.includes('.tmp-')));
});

test('글자 칠 때마다 저장해도 백업은 1분에 하나, 다른 곳에서 바뀐 파일은 덮기 전에 백업', async () => {
  const doc = LessonDoc.create(tmp(), { title: '시험', date: '2026-12-05' });
  const dir = path.join(doc.root, '.sidebar', 'backup');
  const count = () => readdirSync(dir).length;
  for (const t of ['A', 'AI', 'AI 연', 'AI 연수']){ doc.setInfo({ title: t }); doc.save(); }
  assert.equal(count(), 1);                  // 4번 저장, 백업은 1개
  doc.backedUpAt -= 61 * 1000;               // 1분이 지나면
  doc.setInfo({ title: 'AI 연수 1차' }); doc.save();
  assert.equal(count(), 2);                  // 다시 백업
  await new Promise(r => setTimeout(r, 20));
  const d = JSON.parse(readFileSync(doc.file, 'utf8')); d.title = '윈도우에서 고침';
  writeFileSync(doc.file, JSON.stringify(d));   // 다른 PC가 고친 파일이 동기화로 내려옴
  doc.setInfo({ title: '맥에서 고침' }); doc.save();
  assert.equal(count(), 3);                  // 1분이 안 됐어도 덮기 전에 백업
  const newest = readdirSync(dir).sort().at(-1);
  assert.equal(JSON.parse(readFileSync(path.join(dir, newest), 'utf8')).title, '윈도우에서 고침');
});

test('다른 곳에서 lesson.json이 바뀌면 알아챈다', async () => {
  const doc = LessonDoc.create(tmp(), { title: '시험', date: '2026-12-05' });
  assert.equal(doc.changedOutside(), false);
  await new Promise(r => setTimeout(r, 20));
  const d = JSON.parse(readFileSync(doc.file, 'utf8')); d.title = '윈도우에서 고침';
  writeFileSync(doc.file, JSON.stringify(d));
  assert.equal(doc.changedOutside(), true);
  doc.load();
  assert.equal(doc.data.title, '윈도우에서 고침');
  assert.equal(doc.changedOutside(), false);
});

test('자료가 있는 구간은 지울 수 없다, 시작 위치는 쓸 수 있는 종류만', async () => {
  const src = sourceFiles();
  const doc = LessonDoc.create(tmp(), { title: '시험', date: '2026-12-05' });
  const main = doc.data.sections[1];
  const r = await doc.addFiles([path.join(src, '활동지.hwp'), path.join(src, '연수 안내.pdf')], main.id);
  assert.throws(() => doc.removeSection(main.id), /자료가 있는 구간/);
  doc.updateItem(r.added[0].id, { start: '3쪽' });
  doc.updateItem(r.added[1].id, { start: '3쪽', screen: 'teacher' });
  assert.equal(doc.locate(r.added[0].id).item.start, undefined);
  assert.equal(doc.locate(r.added[1].id).item.start, '3쪽');
  assert.equal(doc.locate(r.added[1].id).item.screen, 'teacher');
});

test('잠금: 다른 PC가 5분 안에 잡은 잠금만 알린다', () => {
  const d = tmp(); mkdirSync(path.join(d, '.sidebar'));
  writeLock(d, '교실 윈도우 PC');
  assert.equal(otherLock(d, '맥북').device, '교실 윈도우 PC');
  assert.equal(otherLock(d, '교실 윈도우 PC'), null);
  const at = readLocks(d)[0].at;
  assert.equal(otherLock(d, '맥북', at + 6 * 60 * 1000), null);
});

test('잠금: 이 PC가 잠금을 써도 다른 PC의 잠금은 지워지지 않는다 (PC마다 따로 저장)', () => {
  const d = tmp();
  writeLock(d, '교실 윈도우 PC');
  writeLock(d, '맥북');                      // 이 맥이 같은 수업을 엶
  assert.equal(readLocks(d).length, 2);
  assert.equal(otherLock(d, '맥북').device, '교실 윈도우 PC');
  clearLock(d, '맥북');                      // 이 맥이 닫아도
  assert.equal(otherLock(d, '맥북').device, '교실 윈도우 PC');   // 윈도우 PC 기록은 남음
  assert.deepEqual(readLocks(d).map(l => l.device), ['교실 윈도우 PC']);
});

test('수업 폴더 밖 경로로는 파일을 쓰지 않는다', () => {
  const doc = LessonDoc.create(tmp(), { title: '시험', date: '2026-12-05' });
  assert.throws(() => doc.abs('../../밖.txt'), /수업 폴더 밖/);
});
