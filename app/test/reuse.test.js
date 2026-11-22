// 정리와 재사용 시험: 임시 폴더에서 실제로 복제·안내 페이지·충돌 사본 고르기
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LessonDoc } from '../src/core/editor.js';
import { loadLesson } from '../src/core/lesson.js';
import { duplicateLesson, searchText, matches, guideHtml, findConflicts, resolveConflict } from '../src/core/reuse.js';

const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'reuse-'));
async function lesson(){
  const lib = tmp(), src = tmp();
  writeFileSync(path.join(src, '활동지.hwp'), 'hwp');
  const doc = LessonDoc.create(lib, { title: 'AI 활용 연수 1차', date: '2026-12-05' });
  await doc.addFiles([path.join(src, '활동지.hwp')], doc.data.sections[1].id);
  doc.addLink('https://www.youtube.com/watch?v=abc', doc.data.sections[0].id, '오프닝 영상');
  doc.addMemo(doc.data.sections[0].id);
  doc.save();
  mkdirSync(path.join(doc.root, '_녹화')); writeFileSync(path.join(doc.root, '_녹화', 'a.mp4'), 'x');
  mkdirSync(path.join(doc.root, '_캡처')); writeFileSync(path.join(doc.root, '_캡처', 'b.png'), 'x');
  return { lib, doc };
}

test('수업 복제: 자료·순서는 그대로, 새 이름·날짜·수업 번호, 녹화·캡처·잠금은 빼고', async () => {
  const { lib, doc } = await lesson();
  const dest = duplicateLesson(doc.root, lib, { title: 'AI 활용 연수 2차', date: '2026-12-19' });
  assert.equal(path.basename(dest), '2026-12-19_AI활용연수2차');
  const L = loadLesson(dest);
  assert.equal(L.title, 'AI 활용 연수 2차');
  assert.equal(L.items.length, 3);
  assert.deepEqual(L.items.filter(i => i.problem), []);
  assert.notEqual(JSON.parse(readFileSync(path.join(dest, 'lesson.json'), 'utf8')).id, doc.data.id);
  assert.ok(!existsSync(path.join(dest, '_녹화')) && !existsSync(path.join(dest, '_캡처')) && !existsSync(path.join(dest, '.sidebar')));
  assert.ok(duplicateLesson(doc.root, lib, { title: 'AI 활용 연수 2차', date: '2026-12-19' }).endsWith('_2'));
});

test('검색: 수업 이름·자료 이름·링크로, 낱말이 모두 들어 있어야', async () => {
  const { doc } = await lesson();
  const t = searchText(doc.data);
  assert.ok(matches(t, '활동지'));
  assert.ok(matches(t, 'ai 1차'));
  assert.ok(matches(t, 'youtube'));
  assert.ok(!matches(t, '활동지 엑셀'));
  assert.ok(matches(t, ''));
});

test('수업 안내 페이지: 구간·자료·링크, 진행 메모는 빼고, 글자는 안전하게', async () => {
  const { doc } = await lesson();
  doc.data.sections[1].items[0].title = '<script>활동지</script>';
  const h = guideHtml(doc.data);
  assert.match(h, /<h1>AI 활용 연수 1차<\/h1>/);
  assert.match(h, /<a href="https:\/\/www\.youtube\.com\/watch\?v=abc"[^>]*>오프닝 영상<\/a> <span class="k">유튜브<\/span>/);
  assert.ok(!h.includes('진행 메모'));
  assert.ok(!h.includes('<script>활동지'));
  assert.match(h, /&lt;script&gt;활동지/);
});

test('충돌 사본: 찾아서 요약하고, 고른 것이 lesson.json이 되며 나머지는 백업에 남는다', async () => {
  const { doc } = await lesson();
  const other = JSON.parse(readFileSync(doc.file, 'utf8'));
  other.title = '윈도우에서 고친 것'; other.device = '교실 PC'; other.sections[1].items = [];
  writeFileSync(path.join(doc.root, 'lesson (1).json'), JSON.stringify(other));
  const cs = findConflicts(doc.root);
  assert.deepEqual(cs.map(c => [c.file, c.title, c.items]), [['lesson.json', 'AI 활용 연수 1차', 3], ['lesson (1).json', '윈도우에서 고친 것', 2]]);
  resolveConflict(doc.root, 'lesson (1).json');
  assert.equal(loadLesson(doc.root).title, '윈도우에서 고친 것');
  assert.deepEqual(findConflicts(doc.root), []);
  assert.ok(readdirSync(path.join(doc.root, '.sidebar', 'backup')).some(n => n.startsWith('충돌전_') && n.endsWith('lesson.json')));
  assert.throws(() => resolveConflict(doc.root, '없는.json'), /찾지 못했습니다/);
});

test('충돌 사본 이름: 원드라이브(lesson-PC이름.json)·구글 드라이브·드롭박스 모양을 찾고, 수업 파일이 아니거나 다른 이름은 건너뛴다', async () => {
  const { doc } = await lesson();
  const body = readFileSync(doc.file, 'utf8');
  const copies = ['lesson-교실PC.json', 'lesson-DESKTOP-AB12C3-2.json', 'lesson(1).json', 'lesson 3.json', 'lesson (교실 PC의 충돌 사본 2026-11-22).json'];
  for (const n of copies) writeFileSync(path.join(doc.root, n), body);
  writeFileSync(path.join(doc.root, 'lesson-메모.json'), '{"memo":1}');     // 수업 파일 모양이 아님
  writeFileSync(path.join(doc.root, 'lessons.json'), body);                  // 다른 이름
  writeFileSync(path.join(doc.root, 'my lesson.json'), body);
  assert.deepEqual(findConflicts(doc.root).map(c => c.file).sort(), ['lesson.json', ...copies].sort());
});

test('수업 후 돌아보기: 검색에 잡히고, 안내 페이지와 복제한 수업에는 들어가지 않는다', async () => {
  const { doc } = await lesson();
  doc.setInfo({ review: '모둠 활동 시간이 모자랐다' }); doc.save();
  const d = JSON.parse(readFileSync(doc.file, 'utf8'));
  assert.ok(matches(searchText(d), '모둠 모자랐'));
  assert.ok(!guideHtml(d).includes('모자랐'));
  const lib = path.dirname(doc.root);
  const copy = duplicateLesson(doc.root, lib, { title: '2차' });
  assert.equal(JSON.parse(readFileSync(path.join(copy, 'lesson.json'), 'utf8')).review, undefined);
  assert.equal(doc.snapshot().review, '모둠 활동 시간이 모자랐다');
});
