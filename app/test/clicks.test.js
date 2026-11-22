// 클릭 물결: 도우미 'clicks'가 한 줄씩 알리는 누른 자리를 받고, 모르는 도우미면 조용히 끝난다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Helper } from '../src/core/helper.js';

const script = body => new Helper(process.execPath, { pre: ['-e', body] });

test('클릭 자리를 받고, 끄면 멈춘다', async () => {
  const h = script(`console.log('{"event":"ready"}'); console.log('{"event":"click","x":10.5,"y":20,"button":"left"}'); console.log('잘못된 줄'); console.log('{"event":"click","x":"x","y":1}'); setInterval(() => {}, 1000);`);
  const got = await new Promise(resolve => h.startClicks(m => resolve(m)));
  assert.deepEqual([got.x, got.y, got.button], [10.5, 20, 'left']);
  const p = h.clicker;
  h.stopClicks();
  assert.equal(h.clicker, null);
  await new Promise(r => p.once('exit', r));
});

test('clicks를 모르는 도우미(바로 끝남)는 다시 켜지 않는다', async () => {
  const h = script(`console.log('{"ok":false,"error":"모르는 명령: clicks"}'); process.exit(1);`);
  let n = 0;
  h.startClicks(() => n++);
  const p = h.clicker;
  await new Promise(r => p.once('exit', r));
  await new Promise(r => setTimeout(r, 1300));
  assert.equal(h.clicker, null);
  assert.equal(n, 0);
  h.stop();
});
