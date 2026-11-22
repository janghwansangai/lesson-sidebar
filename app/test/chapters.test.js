import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chapters, clock } from '../src/core/chapters.js';

test('목차: 자료가 바뀔 때마다 시각과 이름, 같은 자료 잇달아는 한 번, 2초 안에 넘긴 것은 바꿔 씀', () => {
  const c = new Chapters(0);
  c.add('오프닝 영상', 0);
  c.add('오프닝 영상', 5000);
  c.add('잘못 누른 자료', 192000);
  c.add('연수 안내', 193000);          // 1초 만에 넘김 → 앞의 것을 바꿔 씀
  c.add('', 200000);
  c.add('활동지', 3725000);
  assert.equal(c.text(), '00:00 오프닝 영상\n03:12 연수 안내\n1:02:05 활동지\n');
  assert.equal(clock(59999), '00:59');
  assert.deepEqual(Chapters.from(c.toJSON()).list, c.list);
});
