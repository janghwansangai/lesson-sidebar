// 수업 꾸러미(.zip) 시험: 임시 폴더에서 실제로 묶고 푼다. 위험한 zip은 직접 바이트로 만든다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import yauzl from 'yauzl';
import { LessonDoc } from '../src/core/editor.js';
import { loadLesson } from '../src/core/lesson.js';
import { exportBundle, inspectBundle, importBundle, findExisting, unsafePath, LIMITS } from '../src/core/bundle.js';

const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'bundle-'));

async function makeLesson(){
  const src = tmp();
  writeFileSync(path.join(src, '발표 자료.pptx'.normalize('NFD')), 'ppt-내용');   // 맥에서 만든 이름(NFD)
  writeFileSync(path.join(src, '활동지.hwp'), 'hwp-내용');
  const lib = tmp();
  const doc = LessonDoc.create(lib, { title: 'AI 활용 연수', date: '2026-12-05' });
  const main = doc.data.sections[1].id;
  await doc.addFiles([path.join(src, '발표 자료.pptx'.normalize('NFD')), path.join(src, '활동지.hwp')], main);
  doc.addLink('https://docs.google.com/document/d/abc', main, '연수 안내 문서');
  doc.addMemo(doc.data.sections[0].id);
  doc.save(); doc.setInfo({ title: 'AI 활용 연수' }); doc.backedUpAt = 0; doc.save();   // .sidebar/backup 생김
  writeFileSync(path.join(doc.root, '2_전개', '~$01_발표자료.pptx'), '잠금');
  mkdirSync(path.join(doc.root, '.sidebar', 'locks'), { recursive: true });
  writeFileSync(path.join(doc.root, '.sidebar', 'locks', '맥북.json'), '{}');
  return doc;
}

const zipEntries = file => new Promise((res, rej) => yauzl.open(file, { lazyEntries: true }, (e, z) => {
  if (e) return rej(e);
  const out = []; z.on('entry', en => { out.push({ name: en.fileName, utf8: (en.generalPurposeBitFlag & 0x800) !== 0 }); z.readEntry(); });
  z.on('end', () => res(out)); z.on('error', rej); z.readEntry();
}));

/** 압축하지 않은(stored) zip을 바이트로 직접 만든다. 이름은 Buffer(그대로) 또는 문자열(UTF-8 표시). */
function rawZip(file, entries){
  const parts = [], central = []; let offset = 0;
  for (const en of entries){
    const name = Buffer.isBuffer(en.name) ? en.name : Buffer.from(en.name, 'utf8');
    const flag = Buffer.isBuffer(en.name) ? 0 : 0x800;
    const data = Buffer.from(en.data ?? '');
    const crc = zlib.crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(flag, 6);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(flag, 8);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    parts.push(lh, name, data); central.push(ch, name);
    offset += lh.length + name.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  writeFileSync(file, Buffer.concat([...parts, cd, end]));
  return file;
}
const LESSON = (extra = {}) => JSON.stringify({ schema: 1, id: 'les_win', title: '윈도우 수업', date: '2026-12-01',
  sections: [{ id: 's1', title: '전개', items: [{ id: 'a', type: 'hwp', title: '활동지', file: '2_전개/01_활동지.hwp' }] }], ...extra });

test('내보내기: 폴더째 zip 하나, 이름은 NFC + UTF-8 표시, 잠금·백업·임시 파일은 빼고 manifest를 넣는다', async () => {
  const doc = await makeLesson();
  const out = path.join(tmp(), '꾸러미.zip');
  const r = await exportBundle(doc.root, out, { appVersion: '0.1.0' });
  const top = path.basename(doc.root);
  const names = (await zipEntries(out)).map(e => e.name);
  assert.ok(names.includes(`${top}/lesson.json`));
  assert.ok(names.includes(`${top}/2_전개/01_발표자료.pptx`));            // NFD였던 이름이 NFC로
  assert.ok(names.includes(`${top}/.sidebar/manifest.json`));
  assert.ok(!names.some(n => /backup|locks|~\$/.test(n)));
  assert.ok((await zipEntries(out)).filter(e => /[^\x00-\x7f]/.test(e.name)).every(e => e.utf8));
  assert.deepEqual(r.needAccess, ['연수 안내 문서']);                      // 받는 사람 권한이 필요한 링크
  assert.equal(r.count, 4);                                                // lesson.json, 메모, pptx, hwp
});

test('가져오기: 다른 보관함에 그대로 풀리고, 사이드바가 바로 읽을 수 있다', async () => {
  const doc = await makeLesson();
  const out = path.join(tmp(), 'a.zip');
  await exportBundle(doc.root, out);
  const lib2 = tmp();
  const info = await inspectBundle(out);
  assert.equal(info.lesson.title, 'AI 활용 연수');
  assert.equal(findExisting(info, lib2), null);
  const r = await importBundle(info, lib2);
  assert.equal(path.basename(r.root), path.basename(doc.root));
  assert.deepEqual(r.damaged, []);
  const lesson = loadLesson(r.root);
  assert.equal(lesson.items.length, 4);
  assert.deepEqual(lesson.items.filter(i => i.problem), []);
  assert.equal(readFileSync(path.join(r.root, '2_전개', '02_활동지.hwp'), 'utf8'), 'hwp-내용');
  assert.ok(!existsSync(path.join(r.root, '.sidebar', 'manifest.json')));   // 꾸러미 정보는 풀지 않는다
  assert.ok(!readdirSync(lib2).some(n => n.startsWith('.가져오는 중')));     // 임시 폴더 남지 않음
});

test('같은 수업이 있으면: 사본은 _2 폴더와 새 수업 번호, 덮어쓰기는 기존 것을 .sidebar/덮어쓰기 전에 둔다', async () => {
  const doc = await makeLesson();
  const out = path.join(tmp(), 'a.zip');
  await exportBundle(doc.root, out);
  const lib = path.dirname(doc.root);
  const info = await inspectBundle(out);
  const existing = findExisting(info, lib);
  assert.equal(existing, doc.root);
  const copy = await importBundle(info, lib, { mode: 'copy', existing });
  assert.ok(copy.root.endsWith('_2'));
  const copied = JSON.parse(readFileSync(path.join(copy.root, 'lesson.json'), 'utf8'));
  assert.notEqual(copied.id, doc.data.id);
  assert.equal(copied.title, 'AI 활용 연수 (사본)');
  writeFileSync(path.join(doc.root, '이 PC에서만.txt'), '덮어쓰기 전 내용');
  const over = await importBundle(info, lib, { mode: 'overwrite', existing });
  assert.equal(over.root, doc.root);
  assert.ok(!existsSync(path.join(doc.root, '이 PC에서만.txt')));
  assert.equal(readFileSync(path.join(over.backup, '이 PC에서만.txt'), 'utf8'), '덮어쓰기 전 내용');
  assert.ok(over.backup.includes(path.join('.sidebar', '덮어쓰기 전')));
});

test('위험한 경로(../, 절대 경로, 드라이브 문자)가 하나라도 있으면 꾸러미 전체를 거절한다', async () => {
  for (const bad of ['../밖.txt', '수업/../../밖.txt', '/etc/밖', 'C:/Windows/밖.txt', '수업\\..\\..\\밖.txt']){
    const z = rawZip(path.join(tmp(), 'bad.zip'), [{ name: '수업/lesson.json', data: LESSON() }, { name: bad, data: 'x' }]);
    await assert.rejects(inspectBundle(z), /위험한 경로/, bad);
  }
  assert.equal(unsafePath('1_도입/01_자료.pdf'), false);
});

test('윈도우 탐색기로 묶은 zip(한글 CP949 이름, 역슬래시, manifest 없음)도 가져오고, 실행 파일은 뺀다', async () => {
  const cp = s => Buffer.from({ '활동지': [0xC8, 0xB0, 0xB5, 0xBF, 0xC1, 0xF6], '모둠': [0xB8, 0xF0, 0xB5, 0xD2] }[s]);
  const z = rawZip(path.join(tmp(), 'win.zip'), [
    { name: Buffer.from('2026-12-01_윈도우수업\\lesson.json'.replace('윈도우수업', 'win'), 'latin1'), data: LESSON() },
    { name: Buffer.concat([Buffer.from('2026-12-01_win\\2_'), Buffer.from([0xC0, 0xFC, 0xB0, 0xB3]), Buffer.from('\\01_'), cp('활동지'), Buffer.from('.hwp')]), data: 'hwp' },
    { name: Buffer.concat([Buffer.from('2026-12-01_win\\'), cp('모둠'), Buffer.from('.exe')]), data: 'MZ' },
  ]);
  const info = await inspectBundle(z);
  assert.equal(info.folderName, '2026-12-01_win');
  assert.deepEqual(info.plan.map(p => p.rel).sort(), ['2_전개/01_활동지.hwp', 'lesson.json']);
  assert.deepEqual(info.skipped, [{ name: '모둠.exe', reason: '실행 파일은 가져오지 않습니다' }]);
  const r = await importBundle(info, tmp());
  assert.deepEqual(loadLesson(r.root).items.filter(i => i.problem), []);
});

test('풀었을 때 너무 크거나 파일이 너무 많으면 거절한다 (압축 폭탄)', async () => {
  const z = rawZip(path.join(tmp(), 'big.zip'), [{ name: 'lesson.json', data: LESSON() }, { name: 'a.txt', data: 'x'.repeat(100) }]);
  await assert.rejects(inspectBundle(z, { limits: { ...LIMITS, totalBytes: 50 } }), /너무 큽니다/);
  await assert.rejects(inspectBundle(z, { limits: { ...LIMITS, files: 1 } }), /너무 많습니다/);
});

test('manifest의 확인값과 다른 파일은 손상으로 알리고 빼며, 나머지는 가져온다', async () => {
  const manifest = JSON.stringify({ format: 1, files: [{ path: '2_전개/01_활동지.hwp', size: 3, sha256: '0'.repeat(64) }] });
  const z = rawZip(path.join(tmp(), 'dmg.zip'), [
    { name: '수업/lesson.json', data: LESSON() }, { name: '수업/2_전개/01_활동지.hwp', data: 'hwp' },
    { name: '수업/메모.md', data: '# 메모' }, { name: '수업/.sidebar/manifest.json', data: manifest }]);
  const r = await importBundle(await inspectBundle(z), tmp());
  assert.deepEqual(r.damaged, ['2_전개/01_활동지.hwp']);
  assert.ok(!existsSync(path.join(r.root, '2_전개', '01_활동지.hwp')));
  assert.ok(existsSync(path.join(r.root, '메모.md')));
});

test('lesson.json이 없거나 모르는 형식이면 거절한다', async () => {
  await assert.rejects(inspectBundle(rawZip(path.join(tmp(), 'x.zip'), [{ name: '사진.jpg', data: 'x' }])), /lesson.json이 없습니다/);
  await assert.rejects(inspectBundle(rawZip(path.join(tmp(), 'y.zip'), [{ name: 'lesson.json', data: '{"schema":9}' }])), /모르는 lesson.json/);
});
