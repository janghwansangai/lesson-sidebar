import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../lib/match.js';

const NFD = '샘플_발표자료'.normalize('NFD');

test('맥(NFD) 한글 제목도 윈도우(NFC) 파일 이름과 짝이 맞는다', () => {
  assert.ok(M.titleMatches(`${NFD}.pptx`, '샘플_발표자료'));
  assert.ok(M.titleMatches('샘플_발표자료.pptx - PowerPoint', NFD));
  assert.equal(M.stem(`/a/b/${NFD}.pptx`), '샘플_발표자료');
  assert.equal(M.stem('C:\\수업\\활동지.hwp'), '활동지');
});

test('빈 파일 이름은 아무 창과도 짝짓지 않는다', () => {
  assert.equal(M.titleMatches('아무 창', ''), false);
});

test('새로 생긴 창만 골라낸다', () => {
  const before = [{ wid: 1 }, { wid: 2 }];
  const after = [{ wid: 1 }, { wid: 2 }, { wid: 3, title: '복원된 창' }, { wid: 4, title: '수업 사이드바 시험 A' }];
  const fresh = M.newWindows(before, after);
  assert.deepEqual(fresh.map(w => w.wid), [3, 4]);
  assert.equal(M.pickNewWindow(fresh, '시험 A').wid, 4);
  assert.equal(M.pickNewWindow(fresh, '없는 제목').wid, 4);
  assert.equal(M.pickNewWindow([], '시험 A'), null);
});

test('학생 화면은 주 모니터가 아닌 외부 모니터를 고른다', () => {
  const mac = { index: 0, primary: true, builtin: true };
  const ext = { index: 1, primary: false, builtin: false };
  assert.equal(M.pickStudentDisplay([mac, ext]), ext);
  assert.equal(M.pickStudentDisplay([mac]), null);
  assert.equal(M.pickStudentDisplay([ext, { index: 2, primary: false, builtin: true }]), ext);
});

test('사이드바 폭을 뺀 영역에 반반 배치한다', () => {
  const display = { x: 0, y: 0, width: 1512, height: 982, visible: { x: 0, y: 38, width: 1512, height: 944 } };
  const area = M.workArea(display, 272);
  assert.deepEqual(area, { x: 272, y: 38, width: 1240, height: 944 });
  const [a, b] = M.tileRects(area, 'half');
  assert.deepEqual(a, { x: 272, y: 38, width: 620, height: 944 });
  assert.deepEqual(b, { x: 892, y: 38, width: 620, height: 944 });
});

test('배치 5종이 영역을 빈틈없이 채운다', () => {
  const area = { x: 100, y: 0, width: 1200, height: 800 };
  for (const key of ['half', 'seventy', 'thirds', 'main2', 'grid']){
    const rs = M.tileRects(area, key);
    const sum = rs.reduce((s, r) => s + r.width * r.height, 0);
    assert.ok(Math.abs(sum - 1200 * 800) < 1200 * 4, `${key} 넓이`);
    for (const r of rs){
      assert.ok(r.x >= 100 && r.x + r.width <= 1301 && r.y >= 0 && r.y + r.height <= 801, `${key} 범위`);
    }
  }
  assert.throws(() => M.tileRects(area, 'nope'));
});

test('분할 비율은 창 최소 폭에서 멈춘다 (브라우저 최소 폭 500)', () => {
  assert.equal(M.fitRatio(1280, 0.5, 500, 500), 0.5);
  assert.ok(Math.abs(M.fitRatio(1280, 0.7, 0, 500) - (1 - 500 / 1280)) < 1e-9);
  assert.ok(Math.abs(M.fitRatio(1280, 0.2, 500, 0) - 500 / 1280) < 1e-9);
  assert.equal(M.fitRatio(900, 0.5, 500, 500), null);
});

test('위치 비교는 허용 오차 안이면 통과', () => {
  assert.ok(M.rectClose({ x: 0, y: 0, width: 100, height: 100 }, { x: 10, y: 0, width: 100, height: 112 }));
  assert.equal(M.rectClose({ x: 0, y: 0, width: 100, height: 100 }, { x: 40, y: 0, width: 100, height: 100 }), false);
});

test('창 가운데로 모니터를 찾는다 (외부 모니터가 음수 좌표여도)', () => {
  const ds = [{ index: 0, x: 0, y: 0, width: 1512, height: 982 }, { index: 1, x: -1280, y: 0, width: 1280, height: 800 }];
  assert.equal(M.displayOf({ x: -1200, y: 100, width: 800, height: 600 }, ds), 1);
  assert.equal(M.displayOf({ x: 100, y: 100, width: 800, height: 600 }, ds), 0);
  assert.equal(M.displayOf({ x: 5000, y: 100, width: 10, height: 10 }, ds), -1);
});

test('fitCuts: 여러 칸의 최소 크기에 맞게 경계를 민다', () => {
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
  assert.ok(near(M.fitCuts([1/3, 2/3], [0, 0.5, 0]), [1/3, 5/6]));        // 가운데 칸이 절반 이상
  assert.ok(near(M.fitCuts([1/3, 2/3], [0.5, 0, 0]), [0.5, 2/3]));        // 첫 칸
  assert.ok(near(M.fitCuts([1/3, 2/3], [0, 0, 0.6]), [1/3, 0.4]));        // 마지막 칸
  assert.ok(near(M.fitCuts([1/3, 2/3], [0.4, 0.4, 0]), [0.4, 0.8]));
  assert.ok(near(M.fitCuts([0.7], [0, 0.5]), [0.5]));
  assert.equal(M.fitCuts([0.5], [0.6, 0.6]), null);                       // 다 못 들어감
  assert.ok(near(M.fitCuts([0.6], [0, 0]), [0.6]));                        // 그대로
});
