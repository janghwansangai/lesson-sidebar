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
