// 가짜 도우미·가짜 실행기로 수업 진행 로직을 시험한다 (실제 창은 열지 않음).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Session } from '../src/core/session.js';
import { responseError } from '../src/core/helper.js';
import { loadLesson } from '../src/core/lesson.js';

const TEACHER = { index: 0, primary: true, builtin: true, x: 0, y: 0, width: 1512, height: 982, visible: { x: 0, y: 33, width: 1512, height: 949 } };
const STUDENT = { index: 1, primary: false, builtin: false, x: -1280, y: 182, width: 1280, height: 800, visible: { x: -1280, y: 212, width: 1280, height: 770 } };

/**
 * 창 목록을 흉내 내는 도우미. 프로그램을 "열면" 창 하나가 생긴다.
 * 저장 안 된 문서(ask): 닫기 요청을 받으면 목록을 n번 더 읽은 뒤에야 저장 창(waiting)이 뜬다 — 저장 창이 늦게 뜨는 것을 흉내.
 * 저장 창이 떠 있는 동안 닫기 요청을 또 받으면 저장 창이 하나 더 생긴다 (맥 한글처럼).
 * 탭 메모장 흉내: 창에 tabs(파일 이름들)가 있으면 제목은 보이는 탭(tabs[0])이고, closetab이 그 이름의 탭만 뺀다.
 * dirty에 든 탭은 닫을 때 저장 여부를 묻는다(waiting). notepadTabs=false면 탭 없는 메모장(윈도우 10).
 */
class FakeHelper extends EventEmitter {
  constructor(displays){
    super(); this.displays = displays; this.wins = []; this.next = 100; this.minW = {}; this.stuck = new Set();
    this.ask = new Map(); this.pending = new Map(); this.waiting = new Map(); this.dialogs = 0; this.lists = 0; this.closes = []; this.raises = [];
    this.dirty = new Set(); this.notepadTabs = true; this.calls = [];
    this.blockFront = null; this.failList = false;
  }
  spawn(app, title){ const w = { wid: this.next++, app, title, x: 100, y: 100, width: 800, height: 600 }; this.wins.push(w); return w; }
  tabsOf(w){ return w.tabs ?? [w.title.replace(/ - 메모장$/, '')]; }
  closeTab(w, name){
    w.tabs = this.tabsOf(w).filter(t => t !== name);
    if (!w.tabs.length){ this.wins = this.wins.filter(x => x !== w); return true; }
    w.title = `${w.tabs[0]} - 메모장`;
    return false;
  }
  async call(cmd, ...a){
    this.calls.push(cmd);
    switch (cmd){
      case 'closetab': case 'findtab': {
        const w = this.wins.find(x => x.wid === Number(a[0])); if (!w) throw new Error('없음');
        const name = a[1], count = this.tabsOf(w).filter(t => t === name).length;
        if (!this.notepadTabs) return { ok: true, tabs: false, found: w.title.startsWith(name), count };
        if (cmd === 'findtab') return { ok: true, tabs: true, found: count === 1, count, dialog: !!w.asking };
        if (count !== 1) return { ok: true, tabs: true, found: false, count, closed: false, waiting: null };
        if (this.dirty.has(name)){ w.asking = name; w.tabs = [name, ...this.tabsOf(w).filter(t => t !== name)]; w.title = `*${name} - 메모장`; return { ok: true, tabs: true, found: true, count, closed: false, waiting: { wid: null, title: '메모장 안의 확인 창' } }; }
        const windowClosed = this.closeTab(w, name);
        return { ok: true, tabs: true, found: true, count, closed: true, windowClosed, waiting: null };
      }
      case 'maximize': { const w = this.wins.find(x => x.wid === Number(a[0])); w.maximized = true; return { ok: true }; }
      case 'displays': return { ok: true, displays: this.displays };
      case 'list': {
        if (this.failList) throw new Error('목록 실패');
        this.lists++;
        for (const [wid, at] of this.pending) if (this.lists >= at){ this.pending.delete(wid); this.waiting.set(wid, { wid: 900 + this.dialogs++, title: '저장' }); }
        const i = a.indexOf('--app'); const f = i >= 0 ? a[i + 1] : null;
        return { ok: true, windows: this.wins.filter(w => !f || w.app.includes(f)).map(w => ({ ...w, waiting: this.waiting.get(w.wid) ?? w.waiting ?? null })) };
      }
      case 'raise': {
        // 진짜 Helper.call처럼 ok:false 응답은 오류로 바꾸고 응답을 붙인다 (창이 없을 때도 도우미는 ok:false + error)
        const w = this.wins.find(x => x.wid === Number(a[0])); if (!w) throw responseError({ ok: false, error: '없음' });
        this.raises.push(w.wid);
        const waiting = this.waiting.get(w.wid) ?? w.waiting ?? null;
        // blockFront: 다른 창이 맨 앞을 막아 앞으로 못 가져옴 (윈도우 "연결 프로그램 선택" 창, docs/poc/windows.md 15)
        if (this.blockFront) throw responseError({ ok: false, front: this.blockFront, ms: 2400, detail: { waiting, tried: [] } });
        return { ok: true, detail: { waiting } };
      }
      case 'move': {
        const w = this.wins.find(x => x.wid === Number(a[0])); const [x, y, width, height] = a.slice(1).map(Number);
        Object.assign(w, { x, y, width: Math.max(width, this.minW[w.app] ?? 0), height, maximized: false });
        return { ok: true, actual: { x: w.x, y: w.y, width: w.width, height: w.height } };
      }
      case 'minimize': return { ok: true };
      case 'close': {
        const id = Number(a[0]); this.closes.push(id);
        if (this.waiting.has(id)){ this.dialogs++; return { ok: true }; }   // 저장 창이 하나 더 생김
        if (this.ask.has(id)){ this.pending.set(id, this.lists + this.ask.get(id)); this.ask.delete(id); return { ok: true }; }
        if (!this.stuck.has(id)) this.wins = this.wins.filter(x => x.wid !== id);
        return { ok: true };
      }
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

/** realCloseWait: 닫기 뒤 저장 창을 기다리는 시간을 실제 값(6초)으로. 아니면 시험이 빨리 끝나게 1.2초. */
function makeSession(displays = [TEACHER, STUDENT], { realCloseWait = false, ...opts } = {}){
  const helper = new FakeHelper(displays);
  const launcher = {
    APPS: { powerpoint: { app: 'PP', match: 'PowerPoint', label: '파워포인트' }, text: { app: 'TE', match: 'TextEdit', label: '텍스트 편집기' }, excel: {}, hwp: {} },
    pickBrowser: () => ({ app: 'Chrome', match: 'Chrome', label: '크롬' }),
    appKeyFor: it => ({ pptx: 'powerpoint', memo: 'text' })[it.type] ?? 'browser',
    openInBrowser: async () => { helper.spawn('Chrome', '참고 - Chrome'); },
    openWithApp: async (app, file) => { helper.spawn(app.app === 'PP' ? 'PowerPoint' : 'TextEdit', path.basename(file).replace(/\.pptx$/, '')); },
  };
  const s = new Session({ helper, files: { url: f => `http://127.0.0.1/t/${f}` }, ownPid: 1, launcher, closeWait: realCloseWait ? undefined : 1200, ...opts });
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

test('윈도우(물리 픽셀): 사이드바 폭에 교사 화면 배율을 곱해 뺀다', async () => {
  const T = { index: 0, primary: true, builtin: true, scale: 1.5, x: 0, y: 0, width: 2880, height: 1800, visible: { x: 0, y: 0, width: 2880, height: 1728 } };
  const { s, helper } = makeSession([T], { physicalPixels: true });
  await s.refreshDisplays(); s.load(makeLesson());
  await s.open('ppt');
  assert.deepEqual([helper.wins[0].x, helper.wins[0].width, helper.wins[0].height], [420, 2460, 1728]);
});

test('윈도우: 실행 파일 이름(POWERPNT.EXE)의 대소문자가 달라도 다시 연결한다', async () => {
  const { s, helper } = makeSession();
  s.launcher.APPS.powerpoint.match = 'powerpnt.exe';
  helper.spawn('POWERPNT.EXE', '04_발표자료.pptx - PowerPoint');
  await s.refreshDisplays(); s.load(makeLesson());
  assert.equal(await s.relink(), 1);
  assert.equal(s.state.get('ppt').status, 'open');
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

test('닫기 뒤 저장 창이 2.5초 넘게 늦게 떠도 "답을 기다리는 창"으로 표시하고 그 창을 앞으로 가져온다', async () => {
  const { s, helper } = makeSession(undefined, { realCloseWait: true });
  await s.refreshDisplays(); s.load(makeLesson());
  await s.open('ppt');
  const wid = s.state.get('ppt').wid;
  helper.ask.set(wid, 10);           // 닫기 요청 뒤 목록을 10번 읽은 뒤(약 3초 뒤)에 저장 창이 뜬다
  helper.raises = [];
  const t0 = Date.now();
  await s.close('ppt');
  assert.ok(Date.now() - t0 > 2500, '저장 창이 뜰 때까지 기다렸어야 한다');
  assert.equal(s.state.get('ppt').status, 'blocked');
  assert.match(s.msg, /답을 기다리는 창\(저장 여부 등\)을 띄웠습니다/);
  assert.equal(helper.raises.at(-1), wid);   // 그 창을 앞으로 가져왔다 (1초쯤 뒤에도 한 번: 윈도우 엑셀은 뒤에 있으면 저장 창을 안 띄움)
  assert.equal(s.highlight, 'ppt');
});

test('답을 기다리는 창이 이미 있으면 닫기 요청을 또 보내지 않고 바로 그 창을 보여 준다 (맥 한글: 저장 창이 하나 더 생김)', async () => {
  const { s, helper } = makeSession();
  await s.refreshDisplays(); s.load(makeLesson());
  await s.open('ppt');
  const wid = s.state.get('ppt').wid;
  helper.waiting.set(wid, { wid: 800, title: '로그인' });   // 프로그램이 이미 확인 창을 띄워 둠
  const t0 = Date.now();
  await s.close('ppt');
  assert.ok(Date.now() - t0 < 1000, '기다리지 않고 바로');
  assert.deepEqual(helper.closes, []);
  assert.equal(helper.dialogs, 0);
  assert.equal(s.state.get('ppt').status, 'blocked');
  assert.ok(helper.raises.includes(wid));
});

test('선생님이 저장 창에서 "취소"로 답하면, 목록을 눌렀을 때 다시 "열림"으로 돌아온다', async () => {
  const { s, helper } = makeSession();
  await s.refreshDisplays(); s.load(makeLesson());
  await s.open('ppt');
  const wid = s.state.get('ppt').wid;
  helper.ask.set(wid, 1);
  await s.close('ppt');
  assert.equal(s.state.get('ppt').status, 'blocked');
  await s.activate('ppt');           // 저장 창이 아직 있으면 그대로
  assert.equal(s.state.get('ppt').status, 'blocked');
  helper.waiting.delete(wid);        // "취소"
  await s.activate('ppt');
  assert.equal(s.state.get('ppt').status, 'open');
  assert.match(s.msg, /앞으로 가져왔습니다/);
});

test('선생님이 저장 창에서 답해 창이 닫히면 "닫았습니다"로 알린다', async () => {
  const { s, helper } = makeSession();
  await s.refreshDisplays(); s.load(makeLesson());
  await s.open('ppt');
  const wid = s.state.get('ppt').wid;
  helper.ask.set(wid, 1);
  await s.close('ppt');
  assert.equal(s.state.get('ppt').status, 'blocked');
  s.state.get('ppt').linkedAt = Date.now() - 10000;
  s.onAlive(new Set());              // "저장 안 함"으로 답해 창이 닫힘
  assert.equal(s.state.get('ppt').status, 'closed');
  assert.match(s.msg, /'발표 자료'을\(를\) 닫았습니다/);
});

test('윈도우: 도우미가 waiting(저장 창)을 알려 주면 기다리지 않고 바로 "답 기다림"으로 표시한다', async () => {
  const { s, helper } = makeSession();
  await s.refreshDisplays(); s.load(makeLesson());
  await s.open('ppt');
  const w = helper.wins.find(x => x.wid === s.state.get('ppt').wid);
  helper.stuck.add(w.wid);
  w.waiting = { wid: 999, title: 'Microsoft PowerPoint' };
  const t0 = Date.now();
  await s.close('ppt');
  assert.equal(s.state.get('ppt').status, 'blocked');
  assert.ok(Date.now() - t0 < 1500, `너무 오래 기다림: ${Date.now() - t0}ms`);
  assert.match(s.msg, /답을 기다리는 창/);
});

test('윈도우 메모장(탭): 열기 전부터 있던 창(선생님 메모장)이면 창을 닫지 않고, 안내 단추를 누르면 이 탭만 닫는다', async () => {
  const { s, helper } = makeSession();
  s.launcher.APPS.text.tabbed = true;
  const mine = helper.spawn('TextEdit', '선생님 메모.txt - 메모장');    // 선생님이 미리 열어 둔 메모장 창
  s.launcher.openWithApp = async () => { mine.tabs = ['01_진행메모.md', '선생님 메모.txt']; mine.title = '01_진행메모.md - 메모장'; };   // 새 창 없이 그 창의 새 탭으로
  await s.refreshDisplays(); s.load(makeLesson());
  await s.open('memo');
  assert.equal(s.state.get('memo').status, 'open');
  await s.close('memo');
  assert.equal(helper.wins.length, 1, '선생님 메모장 창은 남아 있어야 함');
  assert.deepEqual(mine.tabs, ['01_진행메모.md', '선생님 메모.txt'], '단추를 누르기 전에는 아무 탭도 닫지 않음');
  assert.equal(s.state.get('memo').status, 'closed');
  assert.match(s.msg, /탭만 닫으려면/);
  assert.deepEqual(s.snapshot().offer, { act: 'closeTab', id: 'memo', label: '사이드바에서 이 탭만 닫기' });
  assert.ok(!helper.calls.includes('close'), '창 닫기 요청을 보내지 않음');
  await s.closeTab('memo');                                  // 안내 옆 단추
  assert.deepEqual(mine.tabs, ['선생님 메모.txt'], '선생님 탭은 그대로');
  assert.match(s.msg, /탭을 닫았습니다.*다른 탭은 그대로/);
  assert.equal(s.snapshot().offer, null);
});

test('윈도우 메모장(탭): 사이드바가 연 창은 ✕로 이 메모 탭만 닫는다 (지난번 탭이 되살아나 함께 있어도)', async () => {
  const { s, helper } = makeSession();
  s.launcher.APPS.text.tabbed = true;
  await s.refreshDisplays(); s.load(makeLesson());
  await s.open('memo');
  const w = helper.wins[0];
  w.tabs = ['다른 파일.txt', '01_진행메모.md']; w.title = '다른 파일.txt - 메모장';   // 다른 탭이 앞에 보임
  await s.close('memo');
  assert.deepEqual(w.tabs, ['다른 파일.txt']);
  assert.equal(helper.wins.length, 1);
  assert.equal(s.state.get('memo').status, 'closed');
  assert.ok(!helper.calls.includes('close'), '창 닫기(WM_CLOSE)를 쓰지 않음');
});

test('윈도우 메모장(탭): 메모 탭 하나뿐이면 창도 닫힌다', async () => {
  const { s, helper } = makeSession();
  s.launcher.APPS.text.tabbed = true;
  await s.refreshDisplays(); s.load(makeLesson());
  await s.open('memo');
  await s.close('memo');
  assert.equal(helper.wins.length, 0);
  assert.equal(s.state.get('memo').status, 'closed');
  assert.ok(helper.calls.includes('closetab'));
});

test('윈도우 메모장(탭): 저장 안 한 메모면 "답 기다림"으로 표시하고, 답해서 탭이 닫히면 닫힘으로 바꾼다', async () => {
  const { s, helper } = makeSession();
  s.launcher.APPS.text.tabbed = true;
  await s.refreshDisplays(); s.load(makeLesson());
  await s.open('memo');
  const w = helper.wins[0];
  w.tabs = ['01_진행메모.md', '다른 파일.txt'];
  helper.dirty.add('01_진행메모.md');
  await s.close('memo');
  assert.equal(s.state.get('memo').status, 'blocked');
  assert.match(s.msg, /저장할지 묻고 있습니다/);
  // 선생님이 "저장하지 않음"을 누름 → 탭이 닫히고 보이는 탭이 바뀜
  w.asking = null; helper.closeTab(w, '01_진행메모.md');
  await new Promise(r => setTimeout(r, 1800));
  assert.equal(s.state.get('memo').status, 'closed');
  assert.match(s.msg, /탭을 닫았습니다/);
  assert.deepEqual(w.tabs, ['다른 파일.txt']);
});

test('윈도우 메모장(탭): 같은 이름의 탭이 둘이면 어느 것인지 몰라 닫지 않는다', async () => {
  const { s, helper } = makeSession();
  s.launcher.APPS.text.tabbed = true;
  await s.refreshDisplays(); s.load(makeLesson());
  await s.open('memo');
  const w = helper.wins[0];
  w.tabs = ['01_진행메모.md', '01_진행메모.md'];
  await s.close('memo');
  assert.equal(w.tabs.length, 2);
  assert.match(s.msg, /탭이 2개/);
});

test('탭 없는 메모장(윈도우 10): 창에 이 메모만 있으므로 창을 닫는다', async () => {
  const { s, helper } = makeSession();
  s.launcher.APPS.text.tabbed = true;
  helper.notepadTabs = false;
  await s.refreshDisplays(); s.load(makeLesson());
  await s.open('memo');
  await s.close('memo');
  assert.equal(helper.wins.length, 0);
  assert.ok(helper.calls.includes('close'));
  assert.equal(s.state.get('memo').status, 'closed');
});

test('사이드바를 고정하면 교사 화면에서 가려지는 창을 옆으로 옮기고, 풀면 돌려놓는다 (그사이 옮긴 창은 그대로)', async () => {
  const { s, helper } = makeSession();
  await s.refreshDisplays(); s.load(makeLesson());
  const max = Object.assign(helper.spawn('Chrome', '업무 - Chrome'), { x: 0, y: 33, width: 1512, height: 949, maximized: true });
  const half = Object.assign(helper.spawn('Explorer', '문서'), { x: 0, y: 100, width: 700, height: 500 });
  const moved = Object.assign(helper.spawn('Kakao', '메신저'), { x: 100, y: 200, width: 400, height: 500 });
  const far = Object.assign(helper.spawn('Hwp', '보고서'), { x: 600, y: 100, width: 800, height: 600 });
  const stu = Object.assign(helper.spawn('PowerPoint', '발표'), { x: -1280, y: 212, width: 1280, height: 770 });
  const n = await s.stepAside();
  assert.equal(n, 3);
  assert.deepEqual([max.x, max.y, max.width, max.height, max.maximized], [280, 33, 1232, 949, false]);
  assert.deepEqual([half.x, half.width], [280, 480], '오른쪽 끝(700)이 너무 왼쪽이면 480은 남긴다');
  assert.deepEqual([far.x, far.width], [600, 800], '가려지지 않은 창은 그대로');
  assert.deepEqual([stu.x, stu.width], [-1280, 1280], '학생 화면 창은 그대로');
  assert.equal(await s.stepAside(), 0, '두 번 옮기지 않음');
  Object.assign(moved, { x: 900, y: 50 });                   // 선생님이 직접 옮김
  const back = await s.restoreAside();
  assert.equal(back, 2);
  assert.equal(max.maximized, true);
  assert.deepEqual([half.x, half.y, half.width, half.height], [0, 100, 700, 500]);
  assert.deepEqual([moved.x, moved.y], [900, 50], '선생님이 옮긴 창은 그대로');
  assert.equal(await s.restoreAside(), 0);
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

test('이미 열려 있던 문서는 새 창이 안 생겨도 같은 이름의 창을 찾아 연결한다 (맥 한글·오피스)', async () => {
  const { s, helper } = makeSession();
  helper.spawn('PowerPoint', '04_발표자료');           // 선생님이 미리 열어 둔 같은 문서
  s.launcher.openWithApp = async () => {};            // 프로그램은 새 창 없이 그 창을 앞으로 가져옴
  await s.refreshDisplays(); s.load(makeLesson());
  await s.open('ppt');
  assert.equal(s.state.get('ppt').status, 'open');
  assert.equal(s.state.get('ppt').wid, helper.wins[0].wid);
  assert.equal(s.state.get('ppt').disp, 'student');
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

test('준비 화면에서 고쳐 다시 읽어도 열린 창 연결은 그대로, 뺀 자료는 빠진다', async () => {
  const { s } = makeSession();
  await s.refreshDisplays();
  const lesson = makeLesson();
  s.load(lesson);
  await s.open('ppt');
  const wid = s.state.get('ppt').wid;
  s.highlight = 'web';
  s.reload({ ...lesson, items: lesson.items.filter(i => i.id !== 'web') });
  assert.equal(s.state.get('ppt').wid, wid);
  assert.equal(s.state.has('web'), false);
  assert.equal(s.highlight, null);
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

test('브라우저가 업데이트 뒤 다시 시작을 기다리면 새로 띄우지 않고 탭으로 연 것을 알린다 (기다리지 않음)', async () => {
  const { s, helper } = makeSession();
  s.launcher.openInBrowser = async () => ({ tab: true, reason: 'stale' });
  await s.refreshDisplays(); s.load(makeLesson());
  const t0 = Date.now();
  await s.open('web');
  assert.ok(Date.now() - t0 < 2000);
  assert.equal(s.state.get('web').status, 'closed');
  assert.match(s.msg, /탭으로 열었습니다.*다시 시작/);
  assert.equal(helper.wins.length, 0);
});

test('열 때 브라우저 창이 여러 개 생기면 하나만 짝짓고 나머지는 기억했다가 "모두 닫기"로 함께 닫는다 (선생님 창은 그대로)', async () => {
  const { s, helper } = makeSession();
  helper.spawn('Chrome', '선생님이 원래 쓰던 창');
  const mine = helper.wins[0].wid;
  s.launcher.openInBrowser = async () => { for (let i = 0; i < 3; i++) helper.spawn('Chrome', `되살아난 창 ${i}`); };
  await s.refreshDisplays(); s.load(makeLesson());
  await s.open('web');
  await s.open('ppt');
  assert.equal(s.extras.size, 2);
  await s.closeAll();
  assert.deepEqual(helper.wins.map(w => w.wid), [mine]);
  assert.match(s.msg, /사이드바가 연 창 4개를 닫았습니다/);
  assert.equal(s.state.get('web').status, 'closed');
  assert.equal(s.extras.size, 0);
});

test('앞으로 가져오기가 막혀도(도우미 raise가 ok:false) 창이 남아 있으면 다시 열지 않고, 앞을 막은 창을 알려 준다', async () => {
  const { s, helper } = makeSession();
  await s.refreshDisplays(); s.load(makeLesson());
  await s.open('ppt');
  const wid = s.state.get('ppt').wid, count = helper.wins.length;
  // 윈도우: "연결 프로그램 선택" 창이 맨 앞에 떠 있으면 어떤 창도 앞으로 오지 않는다 (docs/poc/windows.md 15)
  helper.blockFront = { wid: 777, pid: 55, app: 'OpenWith.exe', title: '' };
  await s.activate('ppt');
  assert.equal(helper.wins.length, count);              // 같은 자료를 한 번 더 열지 않음
  assert.equal(s.state.get('ppt').wid, wid);            // 처음 창과 연결 그대로
  assert.equal(s.state.get('ppt').status, 'open');
  assert.equal(s.highlight, 'ppt');
  assert.match(s.msg, /맨 앞으로 가져오지 못했습니다/);
  assert.match(s.msg, /앞에 떠 있는 '연결 프로그램 선택' 창을 먼저 닫은 뒤 다시 눌러 주세요/);
  assert.doesNotMatch(s.msg, /다시 엽니다/);
  // 제목이 있으면 제목으로 알리고, 맨 앞이 사이드바 자신이면 이름 없이 알린다
  helper.blockFront = { wid: 778, pid: 56, app: 'chrome.exe', title: '\u200B참고 사이트 - Chrome' };
  await s.activate('ppt');
  assert.match(s.msg, /'참고 사이트 - Chrome' 창을/);
  helper.blockFront = { wid: 780, pid: 57, app: 'SomeTool.exe', title: '' };   // 제목이 없으면 프로그램 이름
  await s.activate('ppt');
  assert.match(s.msg, /'SomeTool' 창을/);
  helper.blockFront = { wid: 779, pid: 1, app: 'LessonSidebar.exe', title: '수업 사이드바' };
  await s.activate('ppt');
  assert.match(s.msg, /맨 앞으로 가져오지 못했습니다\. 앞을 가리는 창/);
  assert.equal(helper.wins.length, count);
  // 막힌 것이 풀리면 다시 앞으로 가져온다
  helper.blockFront = null;
  await s.activate('ppt');
  assert.match(s.msg, /앞으로 가져왔습니다/);
});

test('앞으로 가져오기가 막혔을 때 그 창이 답을 기다리고 있으면 "답 기다림"으로 표시한다', async () => {
  const { s, helper } = makeSession();
  await s.refreshDisplays(); s.load(makeLesson());
  await s.open('ppt');
  const wid = s.state.get('ppt').wid;
  helper.waiting.set(wid, { wid: 901, title: '저장' });
  helper.blockFront = { wid: 777, pid: 55, app: 'OpenWith.exe', title: '' };
  await s.activate('ppt');
  assert.equal(s.state.get('ppt').status, 'blocked');
  assert.equal(s.state.get('ppt').wid, wid);
  assert.match(s.msg, /답을 기다리는 창/);
});

test('앞으로 가져오려는데 창이 정말 없으면(직접 닫음) 다시 연다', async () => {
  const { s, helper } = makeSession();
  await s.refreshDisplays(); s.load(makeLesson());
  await s.open('ppt');
  const wid = s.state.get('ppt').wid;
  helper.wins = helper.wins.filter(w => w.wid !== wid);   // 사이드바가 알기 전에 선생님이 직접 닫음
  await s.activate('ppt');
  assert.equal(helper.wins.filter(w => w.app === 'PowerPoint').length, 1);
  assert.notEqual(s.state.get('ppt').wid, wid);
  assert.equal(s.state.get('ppt').status, 'open');
  assert.match(s.msg, /열었습니다/);
});

test('앞으로 가져오기가 실패하고 창 목록도 못 읽으면 예전처럼 "창 없음"으로 본다', async () => {
  const { s, helper } = makeSession();
  await s.refreshDisplays(); s.load(makeLesson());
  await s.open('ppt');
  const wid = s.state.get('ppt').wid;
  helper.blockFront = { wid: 777, pid: 55, app: 'OpenWith.exe', title: '' };
  helper.failList = true;
  assert.deepEqual(await s.raiseInfo(wid), { state: 'gone' });
  helper.failList = false;
  assert.equal((await s.raiseInfo(wid)).state, 'notfront');
  helper.blockFront = null;
  assert.equal((await s.raiseInfo(wid)).state, 'ok');
  assert.equal((await s.raiseInfo(12345)).state, 'gone');
});

test('계속 비키기(맥): 고정해 둔 동안 새로 가려진 창도 옮기고, 스스로 되돌아가는 창은 1분에 3번까지만, 돌려놓기는 처음 자리로', async () => {
  const { s, helper } = makeSession([TEACHER]);
  await s.refreshDisplays(); s.load(makeLesson());
  helper.spawn('Finder', '선생님 창 1'); Object.assign(helper.wins[0], { x: 0, y: 200, width: 900, height: 500 });
  assert.equal(await s.keepAside(), 1);
  assert.deepEqual([helper.wins[0].x, helper.wins[0].width], [280, 620]);
  helper.spawn('Notes', '나중에 연 창'); Object.assign(helper.wins[1], { x: 40, y: 100, width: 600, height: 400 });
  assert.equal(await s.keepAside(), 1);                  // 새로 가려진 창
  assert.equal(helper.wins[1].x, 280);
  assert.equal(await s.keepAside(), 0);                  // 이미 비킨 창은 그대로
  for (let i = 0; i < 3; i++){ helper.wins[1].x = 40; await s.keepAside(); }   // 스스로 제자리로 돌아가는 창
  helper.wins[1].x = 40;
  assert.equal(await s.keepAside(), 0);                  // 1분에 3번 넘게는 옮기지 않음
  helper.wins[1].x = 280;
  assert.equal(await s.restoreAside(), 2);
  assert.deepEqual([helper.wins[0].x, helper.wins[0].width], [0, 900]);
  assert.deepEqual([helper.wins[1].x, helper.wins[1].width], [40, 600]);
});

test('손쉬운 사용 권한이 없으면 30초 기다리지 않고 바로 알리고, 창 비키기도 하지 않는다', async () => {
  const { s, helper } = makeSession([TEACHER]);
  await s.refreshDisplays(); s.load(makeLesson());
  s.trusted = false;
  const t0 = Date.now();
  await s.open('ppt');
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(s.state.get('ppt').status, 'closed');
  assert.match(s.msg, /손쉬운 사용 권한이 꺼져 있어/);
  helper.spawn('Finder', '선생님 창'); Object.assign(helper.wins.at(-1), { x: 0, width: 900 });
  assert.equal(await s.keepAside(), 0);
  s.trusted = true;
  assert.ok(await s.keepAside() >= 1);            // 권한이 켜지면 바로 비킨다 (앞에서 연 PPT 창도 사이드바 아래라 함께)
  assert.equal(helper.wins.find(w => w.app === 'Finder').x, 280);
});
