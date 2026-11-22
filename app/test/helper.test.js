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

// ---------- 계속 켜 둔 도우미 ('serve') ----------
// 가짜 도우미: 'serve'면 준비 줄을 알리고 한 줄씩 답한다 (pid를 넣어 같은 프로세스인지 본다). 아니면 한 번 실행처럼 답하고 끝난다.
const SERVE_FAKE = `
const a = process.argv.slice(1);
const answer = args => args[0] === 'fail' ? { ok: false, error: '실패: ' + args[1] } : { ok: true, args, pid: process.pid, mode: a[0] === 'serve' ? 'serve' : 'once' };
if (a[0] !== 'serve'){ console.log(JSON.stringify(answer(a))); process.exit(0); }
console.log(JSON.stringify({ ok: true, serve: 1 }));
let buf = '';
process.stdin.on('data', d => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\\n')) >= 0){
    const args = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
    if (args[0] === 'die') process.exit(3);
    const out = JSON.stringify(answer(args));
    if (args[0] === 'slow') setTimeout(() => console.log(out), 400); else console.log(out);
  }
});
process.stdin.on('end', () => process.exit(0));
`;
const serving = (body = SERVE_FAKE) => new Helper(process.execPath, { pre: ['-e', body], serve: true });

test('serve: 도우미 하나를 켜 두고 여러 명령에 답한다', async () => {
  const h = serving();
  const a = await h.call('list');
  const b = await h.call('raise', 5);
  assert.equal(a.mode, 'serve');
  assert.deepEqual(b.args, ['raise', '5']);
  assert.equal(a.pid, b.pid);
  assert.equal(h.servers.length, 1);
  await assert.rejects(h.call('fail', 'x'), e => e.message === '실패: x' && e.response.ok === false);
  h.stop();
});

test('serve: 앞 명령이 오래 걸리면 하나 더 켜서 기다리지 않는다', async () => {
  const h = serving();
  await h.call('list');
  const slow = h.call('slow');
  const t = Date.now();
  const quick = await h.call('front');
  assert.ok(Date.now() - t < 350, '느린 명령 뒤에 줄 서지 않음');
  assert.notEqual(quick.pid, (await slow).pid);
  h.stop();
});

test("serve: 'serve'를 모르는 도우미면 예전처럼 명령마다 실행한다", async () => {
  const h = serving(`console.log(JSON.stringify(process.argv[1] === 'serve' ? { ok: false, error: '모르는 명령: serve' } : { ok: true, once: process.argv.slice(1) })); process.exit(process.argv[1] === 'serve' ? 1 : 0);`);
  assert.deepEqual((await h.call('list')).once, ['list']);
  assert.equal(h.serveOk, false);
  assert.deepEqual((await h.call('front')).once, ['front']);
  h.stop();
});

test('serve: 도우미가 도중에 끝나면 그 명령은 한 번 실행으로 다시 하고, 다음 명령은 새로 켠 도우미가 받는다', async () => {
  const h = serving();
  const first = await h.call('list');
  const r = await h.call('die');
  assert.equal(r.mode, 'once');
  const next = await h.call('list');
  assert.equal(next.mode, 'serve');
  assert.notEqual(next.pid, first.pid);
  h.stop();
});
