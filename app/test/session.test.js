// 가짜 도우미·가짜 실행기로 수업 진행 로직을 시험한다 (실제 창은 열지 않음).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Session } from '../src/core/session.js';
import { loadLesson } from '../src/core/lesson.js';

const TEACHER = { index: 0, primary: true, builtin: true, x: 0, y: 0, width: 1512, height: 982, visible: { x: 0, y: 33, width: 1512, height: 949 } };
const STUDENT = { index: 1, primary: false, builtin: false, x: -1280, y: 182, width: 1280, height: 800, visible: { x: -1280, y: 212, width: 1280, height: 770 } };

/** 창 목록을 흉내 내는 도우미. 프로그램을 "열면" 창 하나가 생긴다. */
class FakeHelper extends EventEmitter {
  constructor(displays){ super(); this.displays = displays; this.wins = []; this.next = 100; this.minW = {}; this.stuck = new Set(); }
  spawn(app, title){ const w = { wid: this.next++, app, title, x: 100, y: 100, width: 800, height: 600 }; this.wins.push(w); return w; }
  async call(cmd, ...a){
    switch (cmd){
      case 'displays': return { ok: true, displays: this.displays };
      case 'list': { const i = a.indexOf('--app'); const f = i >= 0 ? a[i + 1] : null; return { ok: true, windows: this.wins.filter(w => !f || w.app.includes(f)) }; }
      case 'raise': { const w = this.wins.find(x => x.wid === Number(a[0])); if (!w) throw new Error('없음'); return { ok: true }; }
      case 'move': {
        const w = this.wins.find(x => x.wid === Number(a[0])); const [x, y, width, height] = a.slice(1).map(Number);
        Object.assign(w, { x, y, width: Math.max(width, this.minW[w.app] ?? 0), height });
        return { ok: true, actual: { x: w.x, y: w.y, width: w.width, height: w.height } };
      }
      case 'minimize': return { ok: true };
      case 'close': { const id = Number(a[0]); if (!this.stuck.has(id)) this.wins = this.wins.filter(x => x.wid !== id); return { ok: true }; }
    }
    throw new Error(cmd);
  }
}

function makeLesson(){
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lesson-'));
  mkdirSync(path.join(dir, '2_전개'));
  writeFileSync(path.join(dir, '2_전개', '04_발표자료.pptx'), 'x');
  writeFileSync(path.join(dir, '01_진행메모.md'), '# 메모');
  writeFileSync(path.join(dir, 'lesson.json'), JSON.stringify({ schema: 1, title: '시험 수업', sections: [
    { id: 's1', title: '도입', items: [
      { id: 'memo', type: 'memo', title: '진행 메모', file: '01_진행메모.md' },
      { id: 'web', type: 'web', title: '참고 사이트', url: 'https://example.com/' },
      { id: 'ppt', type: 'pptx', title: '발표 자료', file: '2_전개/04_발표자료.pptx' },
      { id: 'bad', type: 'pdf', title: '밖 파일', file: '../../etc/passwd' },
      { id: 'js', type: 'web', title: '나쁜 주소', url: 'javascript:alert(1)' },
    ] },
  ] }));
  return loadLesson(dir);
}

function makeSession(displays = [TEACHER, STUDENT]){
  const helper = new FakeHelper(displays);
  const launcher = {
    APPS: { powerpoint: { app: 'PP', match: 'PowerPoint', label: '파워포인트' }, text: { app: 'TE', match: 'TextEdit', label: '텍스트 편집기' }, excel: {}, hwp: {} },
    pickBrowser: () => ({ app: 'Chrome', match: 'Chrome', label: '크롬' }),
    appKeyFor: it => ({ pptx: 'powerpoint', memo: 'text' })[it.type] ?? 'browser',
    openInBrowser: async () => { helper.spawn('Chrome', '참고 - Chrome'); },
    openWithApp: async (app, file) => { helper.spawn(app.app === 'PP' ? 'PowerPoint' : 'TextEdit', path.basename(file).replace(/\.pptx$/, '')); },
  };
  const s = new Session({ helper, files: { url: f => `http://127.0.0.1/t/${f}` }, ownPid: 1, launcher });
  return { s, helper };
}

test('수업 폴더 밖 파일과 http/https가 아닌 주소는 막는다', () => {
  const lesson = makeLesson();
  assert.equal(lesson.items.find(i => i.id === 'bad').problem, '수업 폴더 밖의 파일은 열지 않습니다');
  assert.match(lesson.items.find(i => i.id === 'js').problem, /http\/https/);
  assert.equal(lesson.items.find(i => i.id === 'ppt').file, '2_전개/04_발표자료.pptx');
});

test('듀얼 모니터: 자료는 학생 화면에, 진행 메모는 교사 화면에 연다', async () => {
  const { s, helper } = makeSession();
  await s.refreshDisplays(); s.load(makeLesson());
  await s.open('ppt'); await s.open('memo');
  const ppt = helper.wins.find(w => w.app === 'PowerPoint'), memo = helper.wins.find(w => w.app === 'TextEdit');
  assert.deepEqual([ppt.x, ppt.y, ppt.width, ppt.height], [-1280, 212, 1280, 770]);
  assert.equal(memo.x, 280);   // 교사 화면, 사이드바 오른쪽
  assert.equal(s.state.get('ppt').disp, 'student');
  assert.equal(s.state.get('memo').disp, 'teacher');
});

test('"교사 화면에서 먼저"면 교사 화면에 열고 ⇄로 학생 화면에 보낸다', async () => {
  const { s, helper } = makeSession();
  await s.refreshDisplays(); s.load(makeLesson());
  s.setOpenTo('teacher');
  await s.open('web');
  assert.equal(s.state.get('web').disp, 'teacher');
  await s.move('web');
  assert.equal(s.state.get('web').disp, 'student');
  assert.equal(helper.wins[0].x, -1280);
});

test('모니터 한 대면 사이드바를 뺀 영역에 연다', async () => {
  const { s, helper } = makeSession([TEACHER]);
  await s.refreshDisplays(); s.load(makeLesson());
  await s.open('ppt');
  assert.deepEqual([helper.wins[0].x, helper.wins[0].width], [280, 1232]);
});

test('나란히 놓을 때 최소 폭이 넓은 창이면 비율을 조정한다', async () => {
  const { s, helper } = makeSession();
  helper.minW = { Chrome: 700 };
  await s.refreshDisplays(); s.load(makeLesson());
  s.toggleSel('ppt'); s.toggleSel('web');
  await s.split();
  const ppt = helper.wins.find(w => w.app === 'PowerPoint'), web = helper.wins.find(w => w.app === 'Chrome');
  assert.equal(web.width, 700);
  assert.equal(ppt.width + web.width, 1280);
  assert.equal(ppt.x + ppt.width, web.x);
});

test('닫기가 무시되면 "답을 기다리는 창"으로 표시한다', async () => {
  const { s, helper } = makeSession();
  await s.refreshDisplays(); s.load(makeLesson());
  await s.open('ppt');
  helper.stuck.add(s.state.get('ppt').wid);
  await s.close('ppt');
  assert.equal(s.state.get('ppt').status, 'blocked');
  helper.stuck.clear();
  await s.close('ppt');
  assert.equal(s.state.get('ppt').status, 'closed');
});

test('학생 화면 연결이 끊기면 교사 화면으로 모으고, 다시 연결되면 돌려놓는다', async () => {
  const { s, helper } = makeSession();
  await s.refreshDisplays(); s.load(makeLesson());
  await s.open('ppt');
  helper.displays = [TEACHER];
  await s.onDisplaysChanged();
  assert.equal(s.state.get('ppt').disp, 'teacher');
  assert.match(s.msg, /끊겼습니다/);
  helper.displays = [TEACHER, STUDENT];
  await s.onDisplaysChanged();
  assert.equal(s.state.get('ppt').disp, 'student');
});

test('다시 켜면 이미 열린 문서 창을 다시 연결하고, 브라우저 창은 연결하지 않는다', async () => {
  const { s, helper } = makeSession();
  helper.spawn('PowerPoint', '04_발표자료');
  Object.assign(helper.wins[0], { x: -1200, y: 300 });
  helper.spawn('Chrome', '참고 - Chrome');
  await s.refreshDisplays(); s.load(makeLesson());
  assert.equal(await s.relink(), 1);
  assert.equal(s.state.get('ppt').status, 'open');
  assert.equal(s.state.get('ppt').disp, 'student');
  assert.equal(s.state.get('web').status, 'closed');
});

test('다른 창 숨기기는 학생 화면의 자료만 숨기고 교사 화면 메모는 둔다', async () => {
  const { s, helper } = makeSession();
  const mins = [];
  const orig = helper.call.bind(helper);
  helper.call = async (cmd, ...a) => { if (cmd === 'minimize') mins.push(Number(a[0])); return orig(cmd, ...a); };
  await s.refreshDisplays(); s.load(makeLesson());
  await s.open('memo'); await s.open('web'); await s.open('ppt');
  await s.hideOthers();
  assert.deepEqual(mins, [s.state.get('web').wid]);
});

test('사용자가 직접 닫은 창은 목록에서 닫힘으로 바뀐다 (막 연 창은 잠시 기다림)', async () => {
  const { s } = makeSession();
  await s.refreshDisplays(); s.load(makeLesson());
  await s.open('ppt');
  s.onAlive(new Set());
  assert.equal(s.state.get('ppt').status, 'open');   // 막 연결한 창
  s.state.get('ppt').linkedAt = Date.now() - 10000;
  s.onAlive(new Set());
  assert.equal(s.state.get('ppt').status, 'closed');
});
