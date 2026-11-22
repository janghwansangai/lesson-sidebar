// 사전 점검 시험: 프로그램·파일·링크·PC 상태를 가짜로 넣어 판단만 본다 (인터넷·화면 없음).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { precheck, checkLink, cloudOf } from '../src/core/precheck.js';

const APPS = { powerpoint: { label: '파워포인트' }, excel: { label: '엑셀' }, hwp: { label: '한글' }, text: { label: '텍스트 편집기' }, default: { label: '기본 프로그램' } };
const item = (id, type, o = {}) => ({ id, type, title: id, url: null, abs: null, problem: null, ...o });

/** 가짜 인터넷: 주소별 응답 [status, location?]. 넘겨주기는 브라우저처럼 따라가고 마지막 주소를 url에 담는다 */
function fakeFetch(map){
  const find = u => Object.entries(map).filter(([k]) => u.startsWith(k)).sort((a, b) => b[0].length - a[0].length)[0]?.[1];
  return async (u) => {
    for (let hop = 0; hop < 20; hop++){
      const v = find(u);
      if (!v) throw new TypeError('fetch failed');
      if (v === 'timeout'){ const e = new Error('timeout'); e.name = 'TimeoutError'; throw e; }
      const [status, location] = v;
      if (status >= 300 && status < 400 && location){ u = new URL(location, u).href; continue; }
      return { status, ok: status >= 200 && status < 300, url: u };
    }
    throw new TypeError('fetch failed', { cause: new Error('redirect count exceeded') });
  };
}

function deps(o = {}){
  return {
    apps: APPS, browser: { label: '크롬' },
    appInstalled: async app => app.label !== '한글',          // 이 PC에 한글이 없다고 침
    readThrough: async () => ({ bytes: 2048, ms: 10 }),
    checkLink: async () => ({ level: 'ok', detail: '열립니다' }),
    screens: { count: 2, student: { name: '프로젝터', width: 1920, height: 1080 } },
    trusted: true, freeBytes: 50 * 1024 ** 3, lockedBy: null, cloud: null, ...o,
  };
}

test('자료마다 파일·여는 프로그램을 보고, 없는 프로그램은 대안을 알려 준다', async () => {
  const lesson = { items: [
    item('발표', 'pptx', { abs: '/x/a.pptx' }),
    item('활동지', 'hwp', { abs: '/x/b.hwp' }),
    item('없는 파일', 'pdf', { problem: '파일이 없습니다 (아직 동기화 중일 수 있습니다)' }),
    item('워드', 'file', { abs: '/x/c.docx' }),
    item('메모', 'memo', { abs: '/x/m.md' }),
  ] };
  const r = await precheck(lesson, deps());
  const by = Object.fromEntries(r.rows.map(x => [x.title, x]));
  assert.equal(by['발표'].level, 'ok');
  assert.match(by['발표'].detail, /파일 있음 \(2KB\) · 파워포인트 있음/);
  assert.equal(by['활동지'].level, 'bad');
  assert.match(by['활동지'].detail, /한글이\(가\) 이 PC에 없습니다 · 한컴오피스 한글 뷰어/);
  assert.equal(by['없는 파일'].level, 'bad');
  assert.equal(by['워드'].level, 'warn');
  assert.equal(by['메모'].level, 'ok');
  assert.equal(r.counts.bad, 2);
  assert.match(r.summary, /문제 2개.*문제를 먼저 고쳐/);
});

test('읽을 수 없는 파일, 오래 걸린 내려받기, 브라우저 없음', async () => {
  const lesson = { items: [item('잠긴 파일', 'pdf', { abs: '/x/a.pdf' }), item('큰 영상', 'video', { abs: '/x/v.mp4' })] };
  const r = await precheck(lesson, deps({
    browser: null,
    readThrough: async f => { if (f.endsWith('a.pdf')){ const e = new Error('x'); e.code = 'EACCES'; throw e; } return { bytes: 3 * 1024 ** 3, ms: 9000 }; },
  }));
  const by = Object.fromEntries(r.rows.map(x => [x.title, x]));
  assert.match(by['잠긴 파일'].detail, /읽지 못했습니다 \(EACCES\)/);
  assert.match(by['큰 영상'].detail, /3\.0GB, 받는 데 9초/);
  assert.match(by['큰 영상'].detail, /열 브라우저가 없습니다/);
  assert.equal(by['브라우저'].level, 'warn');   // 링크 자료가 없으면 주의
});

test('PC 점검: 모니터 1개·권한 없음·공간 부족·다른 PC·클라우드 폴더', async () => {
  const r = await precheck({ items: [] }, deps({ screens: { count: 1, student: null }, trusted: false, freeBytes: 500 * 1024 ** 2, lockedBy: '교실 윈도우 PC', cloud: '구글 드라이브', screenRec: 'denied' }));
  const by = Object.fromEntries(r.rows.map(x => [x.title, x]));
  assert.equal(by['모니터'].level, 'warn');
  assert.match(by['모니터'].detail, /자동 숨김/);
  assert.equal(by['창 제어 권한'].level, 'bad');
  assert.match(by['화면 기록 권한'].detail, /확대·캡처 핀에 필요/);
  assert.equal(by['저장 공간'].level, 'warn');
  assert.match(by['다른 PC'].detail, /교실 윈도우 PC/);
  assert.match(by['클라우드 폴더'].detail, /오프라인 사용/);
});

test('모든 링크가 연결되지 않으면 "인터넷 연결 안 됨"을 따로 알린다', async () => {
  const lesson = { items: [item('유튜브', 'youtube', { url: 'https://youtu.be/a' }), item('사이트', 'web', { url: 'https://example.com/' })] };
  const r = await precheck(lesson, deps({ checkLink: async () => ({ level: 'bad', detail: '연결되지 않습니다', net: true }) }));
  assert.equal(r.rows.find(x => x.title === '인터넷').level, 'bad');
});

test('링크 판단: 구글 문서 공유 꺼짐·켜짐, 유튜브 비공개·퍼가기 막힘, 없는 페이지, 느린 사이트, 인터넷 없음', async () => {
  const f = fakeFetch({
    'https://docs.google.com/document/d/private': [302, 'https://accounts.google.com/ServiceLogin?continue=x'],
    'https://docs.google.com/document/d/public': [200],
    'https://docs.google.com/spreadsheets/d/hop': [307, '/spreadsheets/d/hop2'],
    'https://docs.google.com/spreadsheets/d/hop2': [302, 'https://accounts.google.com/v3/signin/identifier'],
    'https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fyoutu.be%2Fgone': [404],
    'https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fyoutu.be%2Fnoembed': [401],
    'https://www.youtube.com/oembed': [200],
    'https://www.canva.com/design/x/view': [302, 'https://www.canva.com/login?redirect=x'],
    'https://accounts.google.com/': [200],
    'https://www.canva.com/login': [200],
    'https://example.com/old': [404],
    'https://example.com/slow': 'timeout',
    'https://example.com/': [301, 'https://www.example.com/'],
    'https://www.example.com/': [200],
  });
  const c = (u, t) => checkLink(u, t, { fetchFn: f });
  assert.match((await c('https://docs.google.com/document/d/private/edit', 'gdoc')).detail, /로그인해야 열립니다 \(구글 링크 공유/);
  assert.equal((await c('https://docs.google.com/document/d/public/edit', 'gdoc')).level, 'ok');
  assert.equal((await c('https://docs.google.com/spreadsheets/d/hop', 'gsheet')).level, 'warn');   // 넘겨주기 두 번 뒤 로그인
  assert.equal((await c('https://youtu.be/gone', 'youtube')).level, 'bad');
  assert.equal((await c('https://youtu.be/noembed', 'youtube')).level, 'ok');
  assert.equal((await c('https://youtu.be/ok', 'youtube')).detail, '공개 영상');
  assert.match((await c('https://www.canva.com/design/x/view', 'canva')).detail, /캔바 링크 공유/);
  assert.equal((await c('https://example.com/old', 'web')).level, 'bad');
  assert.match((await c('https://example.com/slow', 'web')).detail, /느립니다/);
  assert.equal((await c('https://example.com/', 'web')).level, 'ok');
  assert.equal((await c('https://nowhere.invalid/', 'web')).net, true);
  const loop = fakeFetch({ 'https://loop.example/': [302, 'https://loop.example/'] });
  assert.match((await checkLink('https://loop.example/', 'web', { fetchFn: loop })).detail, /넘겨주기가 끝나지 않습니다/);
});

test('클라우드 폴더 알아보기 (맥·윈도우 경로)', () => {
  assert.equal(cloudOf('/Users/t/Library/CloudStorage/GoogleDrive-a@b.c/내 드라이브/수업 사이드바/x'), '구글 드라이브');
  assert.equal(cloudOf('G:\\내 드라이브\\수업 사이드바\\x'), '구글 드라이브');
  assert.equal(cloudOf('/Users/t/Documents/수업 사이드바/x'), null);
  // 윈도우 구글 드라이브의 공유 드라이브·다른 컴퓨터·바로 가기 폴더 (드라이브 맨 위일 때만)
  assert.equal(cloudOf('G:\\공유 드라이브\\3학년\\수업 사이드바\\x'), '구글 드라이브');
  assert.equal(cloudOf('H:\\Shared drives\\Grade 3\\x'), '구글 드라이브');
  assert.equal(cloudOf('G:\\다른 컴퓨터\\내 노트북\\x'), '구글 드라이브');
  assert.equal(cloudOf('G:\\.shortcut-targets-by-id\\1abc\\수업\\x'), '구글 드라이브');
  assert.equal(cloudOf('C:\\자료\\공유 드라이브\\x'), null);
});
