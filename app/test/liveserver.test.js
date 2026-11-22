// 발표자 화면·휴대폰 리모컨 서버: 열쇠 없는 요청 막기, 허용한 요청만, 상태 보내기 (이 PC 안 127.0.0.1에서만 시험)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LiveServer } from '../src/core/liveserver.js';

const dir = mkdtempSync(path.join(os.tmpdir(), 'live-'));
writeFileSync(path.join(dir, 'live.html'), '<p>live</p>');
writeFileSync(path.join(dir, 'live.js'), '1');
writeFileSync(path.join(dir, 'live.css'), 'p{}');

/** SSE 첫 메시지 하나 읽기 */
async function firstEvent(url){
  const ac = new AbortController();
  const r = await fetch(url, { signal: ac.signal });
  const rd = r.body.getReader(); let buf = '';
  while (!buf.includes('data: ')  || !buf.slice(buf.indexOf('data: ')).includes('\n\n')){ const { value } = await rd.read(); buf += Buffer.from(value).toString(); }
  ac.abort();
  return JSON.parse(buf.slice(buf.indexOf('data: ') + 6).split('\n\n')[0]);
}

test('열쇠가 맞아야 열리고, 허용한 요청만 받는다', async () => {
  const acts = []; let st = { n: 1 };
  const s = new LiveServer({ dir, getState: () => st, onAct: (a, v, k) => acts.push([a, v, k]) });
  await s.listen('local', '127.0.0.1');
  const base = s.url('local');
  try {
    assert.equal((await fetch(base.replace(/[0-9a-f]{32}/, 'x'.repeat(32)))).status, 404);
    const page = await fetch(base);
    assert.equal(page.status, 200); assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(await page.text(), '<p>live</p>');
    assert.equal((await fetch(base + 'live.css')).status, 200);
    assert.equal((await fetch(base + '../package.json')).status, 404);
    const post = body => fetch(base + 'act', { method: 'POST', body: JSON.stringify(body) }).then(r => r.status);
    assert.equal(await post({ do: 'next' }), 204);
    assert.equal(await post({ do: 'activate', arg: 'it1' }), 204);
    assert.equal(await post({ do: 'quit' }), 403);
    assert.equal(await post({ do: 'closeAll' }), 403);
    assert.equal(await post({ do: 'next', arg: { x: 1 } }), 403);
    assert.equal((await fetch(base + 'act', { method: 'POST', body: 'x'.repeat(2000) })).status, 413);
    await new Promise(r => setTimeout(r, 20));
    assert.deepEqual(acts, [['next', undefined, 'local'], ['activate', 'it1', 'local']]);
    const ev = await firstEvent(base + 'events');
    assert.deepEqual(ev.s, { n: 1 }); assert.ok(Math.abs(ev.now - Date.now()) < 5000);
    assert.equal((await fetch(base + 'thumb')).status, 204);
  } finally { s.closeAll(); }
});

test('끄면 이전 주소는 더 이상 열리지 않고, 다시 켜면 새 열쇠', async () => {
  const s = new LiveServer({ dir, getState: () => ({}), onAct: () => {} });
  await s.listen('lan', '127.0.0.1');
  const a = s.url('lan');
  s.close('lan');
  await assert.rejects(fetch(a));
  await s.listen('lan', '127.0.0.1');
  assert.notEqual(s.url('lan').split('/')[3], a.split('/')[3]);
  assert.equal(new URL(s.url('lan')).port, new URL(a).port);            // 같은 포트 → 이전 주소는 404 (끊김을 바로 안다)
  assert.equal((await fetch(a)).status, 404);
  s.closeAll();
});
