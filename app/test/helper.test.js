// 도우미 연결(Helper.call): 진짜 도우미 대신 Node로 JSON 한 줄을 찍는 작은 스크립트를 부른다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Helper } from '../src/core/helper.js';

/** 받은 JSON을 그대로 마지막 줄에 찍는 가짜 도우미. */
const fake = res => new Helper(process.execPath, { pre: ['-e', `console.log('앞줄'); console.log(${JSON.stringify(JSON.stringify(res))})`] });

test('ok:true 응답은 그대로 돌려준다', async () => {
  const r = await fake({ ok: true, actual: { x: 1 } }).call('move', 1, 2, 3, 4, 5);
  assert.deepEqual(r, { ok: true, actual: { x: 1 } });
});

test('ok:false 응답은 오류로 바꾸고, 응답 전체를 오류의 response에 붙인다 (raise: 창은 있는데 맨 앞이 안 됨)', async () => {
  const res = { ok: false, front: { wid: 7, pid: 8, app: 'OpenWith.exe', title: '' }, ms: 2400, detail: { waiting: null, tried: [] } };
  await assert.rejects(fake(res).call('raise', 5), e => {
    assert.equal(e.message, '도우미 오류');
    assert.deepEqual(e.response, res);
    return true;
  });
  await assert.rejects(fake({ ok: false, error: '창 5을(를) 찾지 못했습니다' }).call('raise', 5), e => {
    assert.equal(e.message, '창 5을(를) 찾지 못했습니다');
    assert.equal(e.response.error, '창 5을(를) 찾지 못했습니다');
    return true;
  });
});
