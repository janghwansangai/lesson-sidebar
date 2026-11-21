// 사이드바를 고정했을 때 옆으로 비킬 창 고르기 (실제 창은 옮기지 않음)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planAside } from '../src/core/aside.js';

// 윈도우 노트북 화면(배율 150%, 물리 픽셀)과 왼쪽 외부 모니터
const T = { index: 0, primary: true, scale: 1.5, x: 0, y: 0, width: 1920, height: 1080, visible: { x: 0, y: 0, width: 1920, height: 1032 } };
const S = { index: 1, primary: false, scale: 2, x: -2560, y: 0, width: 2560, height: 1600, visible: { x: -2560, y: 0, width: 2560, height: 1504 } };
const win = (wid, o) => ({ wid, pid: 50, x: 0, y: 0, width: 800, height: 600, minimized: false, maximized: false, fullscreen: false, ...o });

test('사이드바 자신·최소화·전체 화면(슬라이드 쇼)·학생 화면 창은 옮기지 않는다', () => {
  const span = 420;   // 280 × 150%
  const plan = planAside([
    win(1, { pid: 7 }),                                         // 사이드바 자신 (ownPid)
    win(2, { minimized: true }),
    win(3, { fullscreen: true, width: 1920, height: 1080 }),    // 슬라이드 쇼
    win(4, { x: -2560, width: 2560, height: 1504 }),            // 학생 화면
    win(5, { x: 100, y: 50 }),                                  // 가려짐 → 옮김
  ], T, span, { ownPid: 7, displays: [T, S] });
  assert.deepEqual(plan.map(p => p.wid), [5]);
  assert.deepEqual(plan[0].to, { x: 420, y: 50, width: 480, height: 600 });
  assert.deepEqual(plan[0].from, { x: 100, y: 50, width: 800, height: 600 });
});

test('오른쪽 끝이 화면 끝이면 넘지 않고, 사이드바 폭이 0(자동 숨김)이면 옮길 것이 없다', () => {
  const plan = planAside([win(1, { x: 0, width: 1920 })], T, 420, { displays: [T, S] });
  assert.deepEqual(plan[0].to, { x: 420, y: 0, width: 1500, height: 600 });
  assert.deepEqual(planAside([win(1, {})], T, 0, { displays: [T, S] }), []);
});
