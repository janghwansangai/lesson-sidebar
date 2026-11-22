// 발표자 화면·휴대폰 리모컨의 판단: 시간 재기, 지금·다음 자료, 진행 메모, 접속 주소
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Timing, liveView, memoFor, hms, lanAddress, REMOTE_ACTIONS } from '../src/core/live.js';

const it = (id, type = 'pptx', o = {}) => ({ id, title: id, type, abs: `/l/${id}`, problem: null, ...o });
function lesson(){
  const s1 = { id: 's1', title: '도입', minutes: 10, items: [it('메모1', 'memo'), it('영상', 'youtube')] };
  const s2 = { id: 's2', title: '전개', minutes: 20, items: [it('발표'), it('메모2', 'memo'), it('활동지', 'hwp')] };
  const s3 = { id: 's3', title: '정리', minutes: 5, items: [it('설문', 'gform')] };
  return { root: '/l', title: '연수', sections: [s1, s2, s3], items: [...s1.items, ...s2.items, ...s3.items] };
}

test('자료를 처음 띄울 때 수업 시계가, 다른 구간으로 넘어가면 구간 시계가 새로 간다', () => {
  const L = lesson(), t = new Timing();
  assert.equal(t.update(L, null, 0), false);
  t.update(L, '영상', 1000);
  assert.equal(t.lessonStart, 1000); assert.equal(t.secId, 's1');
  t.update(L, '발표', 5000); t.update(L, '활동지', 9000);      // 같은 구간 안에서는 구간 시계 그대로
  assert.equal(t.secStart, 5000);
  const v = liveView(L, '활동지', t, 5000 + 21 * 60000);
  assert.equal(v.section.title, '전개'); assert.equal(v.section.over, true); assert.equal(v.section.n, 2);
  assert.equal(v.lesson.planMin, 35);
  t.update(L, '설문', 65000);                                   // 정리로 갔다가 (전개에 60초)
  t.update(L, '발표', 75000);                                   // 전개로 돌아오면 이어서 센다
  assert.equal(liveView(L, '발표', t, 80000).section.elapsed, 65000);
  t.restart(100000); assert.equal(t.lessonStart, 100000); assert.equal(t.secSince, 100000);
  t.update({ ...L, root: '/other' }, null, 0);                 // 다른 수업이면 처음부터
  assert.equal(t.lessonStart, null);
});

test('지금·다음·이전 자료는 메모를 건너뛴다, 구간이 바뀌면 다음 구간을 알려 준다', () => {
  const L = lesson(), t = new Timing();
  t.update(L, '발표', 0);
  const v = liveView(L, '발표', t, 1000);
  assert.equal(v.current.title, '발표'); assert.equal(v.next.title, '활동지'); assert.equal(v.prev.title, '영상');
  assert.deepEqual(v.nextSection, { title: '정리', minutes: 5 });
  const end = liveView(L, '설문', t, 0);
  assert.equal(end.next, null); assert.equal(end.nextSection, null);
  const none = liveView(L, null, new Timing(), 0);
  assert.equal(none.current, null); assert.equal(none.next.title, '영상'); assert.equal(none.lesson.started, false);
});

test('진행 메모: 지금 구간의 메모, 없으면 수업의 첫 메모', () => {
  const L = lesson();
  assert.deepEqual(memoFor(L, '활동지').map(m => m.title), ['메모2']);
  assert.deepEqual(memoFor(L, '설문').map(m => m.title), ['메모1']);
  assert.deepEqual(memoFor(L, null).map(m => m.title), ['메모1']);
});

test('시간 글자', () => {
  assert.equal(hms(0), '0:00'); assert.equal(hms(65000), '1:05'); assert.equal(hms(3909000), '1:05:09');
});

test('휴대폰 접속 주소: 와이파이 사설 주소를 먼저, 가상 장치·자기 자신은 빼고', () => {
  const ifaces = {
    lo0: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
    utun3: [{ family: 'IPv4', address: '10.8.0.2', internal: false }],
    bridge100: [{ family: 'IPv4', address: '192.168.64.1', internal: false }],
    en0: [{ family: 'IPv6', address: 'fe80::1', internal: false }, { family: 'IPv4', address: '192.168.0.23', internal: false }],
  };
  assert.deepEqual(lanAddress(ifaces), { name: 'en0', address: '192.168.0.23' });
  assert.deepEqual(lanAddress({ 'vEthernet (WSL)': [{ family: 'IPv4', address: '172.20.0.1', internal: false }], 'Wi-Fi': [{ family: 'IPv4', address: '10.1.2.3', internal: false }] }).name, 'Wi-Fi');
  assert.equal(lanAddress({ lo0: [{ family: 'IPv4', address: '127.0.0.1', internal: true }] }), null);
  assert.ok(!REMOTE_ACTIONS.has('quit') && !REMOTE_ACTIONS.has('closeAll'));
});
