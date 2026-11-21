// 수업 진행 상태: 자료 ↔ 창 짝짓기, 열기·앞으로·학생 화면으로 보내기·나란히·닫기, 모니터 변화 처리.
// 화면(Electron)과 떨어져 있어 가짜 도우미로 시험할 수 있다 (app/test/session.test.js).
import { EventEmitter } from 'node:events';
import * as M from '../../../poc/lib/match.js';
import * as L from './launcher.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const OPEN_TIMEOUT = 30000;
const ALIVE_GRACE = 4000;   // 막 연결한 창은 잠시 "사라짐" 판단에서 뺀다 (목록이 늦게 도착할 수 있어서)
// 닫기 요청 뒤 저장 여부를 묻는 창이 뜰 때까지 기다리는 시간. 윈도우 엑셀은 2.5초 넘게 걸렸다 (docs/poc/windows.md 12)
const CLOSE_WAIT = 6000;

export class Session extends EventEmitter {
  /**
   * sidebarWidth는 Electron 화면 단위(맥 포인트, 윈도우 DIP). physicalPixels: 도우미가 물리 픽셀을 쓰면 true (윈도우) —
   * 사이드바 폭에 교사 화면 배율을 곱해 도우미 단위로 바꾼다.
   */
  constructor({ helper, files, ownPid, launcher = L, sidebarWidth = 280, physicalPixels = false, closeWait = CLOSE_WAIT }){
    super();
    this.closeWait = closeWait;
    this.helper = helper;
    this.files = files;
    this.ownPid = ownPid;
    this.launcher = launcher;
    this.sidebarWidth = sidebarWidth;
    this.physicalPixels = physicalPixels;
    this.lesson = null;
    this.state = new Map();
    this.displays = [];
    this.teacher = null;
    this.student = null;
    this.openTo = 'student';
    this.autoHide = false;
    this.highlight = null;
    this.sel = [];
    this.tile = null;
    this.msg = '';
    this.browser = launcher.pickBrowser();
    helper.on('front', f => this.onFront(f));
    helper.on('alive', s => this.onAlive(s));
  }

  // ---------- 상태 알리기 ----------
  say(msg){ this.msg = msg; this.changed(); }
  changed(){ this.emit('change', this.snapshot()); }

  load(lesson){
    this.lesson = lesson;
    this.state = new Map(lesson.items.map(it => [it.id, { status: 'closed', wid: null, disp: null, home: null, note: it.problem ?? '', linkedAt: 0 }]));
    this.highlight = null; this.sel = []; this.tile = null;
    this.say(`'${lesson.title}' 수업을 열었습니다`);
  }
  /** 같은 수업을 준비 화면에서 고쳤을 때: 열린 창 연결은 자료 번호(id)로 이어 간다. */
  reload(lesson){
    const old = this.state;
    this.lesson = lesson;
    this.state = new Map(lesson.items.map(it => {
      const prev = old.get(it.id);
      if (prev){ if (!prev.wid) prev.note = it.problem ?? ''; return [it.id, prev]; }
      return [it.id, { status: 'closed', wid: null, disp: null, home: null, note: it.problem ?? '', linkedAt: 0 }];
    }));
    if (this.highlight && !this.state.has(this.highlight)) this.highlight = null;
    this.sel = this.sel.filter(id => this.state.has(id));
    if (this.tile && !this.tile.ids.every(id => this.state.has(id))) this.tile = null;
    this.changed();
  }
  item(id){ return this.lesson?.items.find(i => i.id === id) ?? null; }
  /** 자료를 여는 프로그램 (브라우저면 고른 브라우저). */
  appFor(it){
    const key = this.launcher.appKeyFor(it);
    return key === 'browser' ? this.browser : this.launcher.APPS[key];
  }

  // ---------- 화면 ----------
  async refreshDisplays(){
    const hadStudent = !!this.student;
    const ds = (await this.helper.call('displays')).displays;
    this.displays = ds;
    this.teacher = ds.find(d => d.primary) ?? ds[0];
    this.student = M.pickStudentDisplay(ds);
    return { hadStudent, hasStudent: !!this.student };
  }
  get dual(){ return !!this.student; }
  /** 자료의 원래 자리: 진행 메모·수업 폴더는 교사 화면, 나머지는 학생 화면 (자료마다 바꿀 수 있음). */
  home(it){ return it.screen ?? (['memo', 'folder'].includes(it.type) ? 'teacher' : 'student'); }
  /** 이번에 열 곳: 모니터 한 대이거나 "교사 화면에서 먼저"면 교사 화면. */
  target(it){ return !this.dual || this.openTo === 'teacher' ? 'teacher' : this.home(it); }
  /** 교사 화면에서 사이드바가 차지하는 폭 (도우미 단위). */
  sidebarSpan(){
    if (this.autoHide) return 0;
    return Math.round(this.sidebarWidth * (this.physicalPixels ? (this.teacher?.scale ?? 1) : 1));
  }
  area(where){
    return where === 'student' && this.student
      ? M.workArea(this.student)
      : M.workArea(this.teacher, this.sidebarSpan());
  }
  rectFor(where){
    const a = this.area(where);
    // 듀얼 모니터의 교사 화면에서는 바탕화면이 조금 보이게 60%만 쓴다
    return where === 'teacher' && this.dual ? { ...a, width: Math.round(a.width * 0.6) } : a;
  }

  // ---------- 도우미 감싸기 ----------
  async list(match){ return (await this.helper.call('list', ...(match ? ['--app', match] : []))).windows; }
  async moveWid(wid, r){
    const res = await this.helper.call('move', wid, ...[r.x, r.y, r.width, r.height].map(v => Math.round(v)));
    return res.actual;
  }
  /**
   * state: 'ok' | 'notfront'(창은 있는데 맨 앞이 안 됨) | 'gone'(창이 없음)
   * waiting: 답을 기다리는 창 {wid, title} 또는 null. 도우미가 알려 주지 않으면 undefined.
   */
  async raiseInfo(wid){
    try { const r = await this.helper.call('raise', wid); return { state: r.ok ? 'ok' : 'notfront', waiting: r.detail?.waiting }; }
    catch { return { state: 'gone' }; }
  }
  async raiseWid(wid){ return (await this.raiseInfo(wid)).state; }
  /** 목록에서 창 하나 (없으면 null). 규격의 waiting(답을 기다리는 창)을 함께 본다. */
  async findWid(wid, match){ return (await this.list(match)).find(w => w.wid === wid) ?? null; }
  async place(id, where){
    const st = this.state.get(id);
    if (!st?.wid) return;
    await this.moveWid(st.wid, this.rectFor(where));
    st.disp = where;
  }

  // ---------- 목록 누르기 ----------
  async activate(id){
    const st = this.state.get(id);
    if (!st || st.status === 'opening') return;
    if (st.wid && (st.status === 'open' || st.status === 'blocked')) return this.raise(id);
    return this.open(id);
  }

  async open(id, { raise = true, quiet = false } = {}){
    const it = this.item(id), st = this.state.get(id);
    if (!it || !st) return;
    if (it.problem) return this.say(`'${it.title}': ${it.problem}`);
    const key = this.launcher.appKeyFor(it);
    const app = this.appFor(it);
    if (!app) return this.say('자료를 열 브라우저가 없습니다 (크롬·엣지·웨일 중 하나가 필요합니다)');

    st.status = 'opening'; st.note = ''; this.changed();
    const t0 = Date.now();
    try {
      const before = await this.list(app.match);
      const page = key === 'browser' && it.type === 'pdf' && parseInt(it.start, 10) > 0 ? `#page=${parseInt(it.start, 10)}` : '';
      const target = it.url ?? (it.abs ? (key === 'browser' ? this.files.url(it.file) + page : it.abs) : null);
      if (key === 'browser') await this.launcher.openInBrowser(app, target);
      else await this.launcher.openWithApp(app, target);

      const stem = key !== 'browser' && it.abs ? M.stem(it.abs) : null;
      const taken = new Set([...this.state.values()].map(s => s.wid).filter(Boolean));
      let w = null;
      while (!w && Date.now() - t0 < OPEN_TIMEOUT){
        await sleep(350);
        const now = (await this.list(app.match)).filter(x => !taken.has(x.wid));
        const fresh = M.newWindows(before, now);
        if (stem){
          // 파일은 제목으로 짝짓기. 이미 열려 있던 문서면 새 창이 안 생기므로 잠시 뒤 전체에서 찾는다
          w = M.findByTitle(fresh, stem)[0] ?? (Date.now() - t0 > 3000 ? M.findByTitle(now, stem)[0] : null) ?? null;
        } else if (fresh.length){
          await sleep(500);   // 이전 창 복원 등으로 여러 개가 생길 수 있어 잠깐 더 본다
          const again = M.newWindows(before, (await this.list(app.match)).filter(x => !taken.has(x.wid)));
          w = M.pickNewWindow(again.length ? again : fresh);
        }
      }
      if (!w) throw new Error('창을 찾지 못했습니다 (30초)');

      st.wid = w.wid; st.status = 'open'; st.home = this.home(it); st.linkedAt = Date.now();
      // 열기 전부터 있던 창이면 (이미 열려 있던 문서, 또는 윈도우 메모장이 기존 창에 탭으로 연 경우) 기억해 둔다 → close()
      st.adopted = before.some(x => x.wid === w.wid);
      const where = this.target(it);
      await this.place(id, where);
      if (raise){ await this.raiseWid(w.wid); this.highlight = id; }
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      if (quiet) this.changed();
      else this.say(`'${it.title}'을(를) ${this.dual ? (where === 'student' ? '학생 화면에 ' : '교사 화면에 ') : ''}열었습니다 · ${secs}초`);
    } catch (e){
      st.status = 'closed'; st.wid = null; st.disp = null; st.note = e.message;
      this.say(`'${it.title}' 열기 실패: ${e.message}`);
    }
  }

  async raise(id){
    const it = this.item(id), st = this.state.get(id);
    const { state: r, waiting } = await this.raiseInfo(st.wid);
    if (r === 'gone'){
      st.status = 'closed'; st.wid = null; st.disp = null;
      this.say(`'${it.title}' 창이 닫혀 있어 다시 엽니다`);
      return this.open(id);
    }
    this.highlight = id;
    // 도우미가 답을 기다리는 창을 알려 주면 그대로 따른다 (선생님이 "취소"로 답했으면 다시 열림으로)
    if (waiting) st.status = 'blocked';
    else if (waiting === null && st.status === 'blocked') st.status = 'open';
    if (st.status === 'blocked') this.say(`'${it.title}': 프로그램이 답을 기다리는 창을 띄웠습니다. 그 창에서 답해 주세요`);
    else if (r === 'notfront') this.say(`'${it.title}'을(를) 맨 앞으로 가져오지 못했습니다 (프로그램이 다른 창을 띄웠을 수 있음)`);
    else this.say(`'${it.title}'을(를) 앞으로 가져왔습니다`);
  }

  /** 열린 창을 다른 화면으로 보낸다 (⇄). */
  async move(id){
    const it = this.item(id), st = this.state.get(id);
    if (!this.dual || !st?.wid) return;
    const to = st.disp === 'student' ? 'teacher' : 'student';
    if (this.tile?.ids.includes(id)) this.tile = null;
    await this.place(id, to);
    st.home = to;
    await this.raiseWid(st.wid);
    this.highlight = id;
    this.say(`'${it.title}' 창을 ${to === 'student' ? '학생' : '교사'} 화면으로 보냈습니다`);
  }

  unlink(id){
    const st = this.state.get(id);
    st.status = 'closed'; st.wid = null; st.disp = null; st.adopted = false;
    if (this.highlight === id) this.highlight = null;
    if (this.tile?.ids.includes(id)) this.tile = null;
    this.sel = this.sel.filter(x => x !== id);
  }

  async close(id){
    const it = this.item(id), st = this.state.get(id);
    if (!st?.wid) return;
    const wid = st.wid, app = this.appFor(it), match = app?.match;
    let w = await this.findWid(wid, match);
    if (!w){ this.unlink(id); return this.say(`'${it.title}'을(를) 닫았습니다`); }
    if (app?.tabbed && it.abs && (st.adopted || !M.titleMatches(w.title, M.stem(it.abs)))){
      // 윈도우 11 메모장은 한 창에 여러 파일을 탭으로 연다. 창을 닫으면 다른 탭(선생님 파일)까지 닫히므로,
      // 사이드바가 만든 창이고 지금 보이는 탭이 이 메모일 때만 닫는다 (docs/poc/windows.md 체험판 8)
      this.unlink(id);
      return this.say(`'${it.title}'은(는) 다른 파일과 같은 ${app.label} 창에 탭으로 열려 있어, 다른 탭까지 닫히지 않도록 창을 닫지 않았습니다. ${app.label}에서 이 탭만 닫아 주세요`);
    }
    // 이미 답을 기다리는 창(저장 여부·로그인 등)이 있으면 닫기 요청을 또 보내지 않는다.
    // 맥 한글은 저장 창이 하나 더 생기고, 그 창은 문서가 닫힌 뒤에도 남아 다른 한글 창까지 막는다 (docs/poc/mac.md 24)
    if (!w.waiting){
      try { await this.helper.call('close', wid); } catch { /* 아래에서 남았는지 본다 */ }
      // 도우미가 창마다 waiting을 알려 주면 뜨는 즉시 알리고, 그때까지 closeWait만큼 기다린다 (저장 창은 2.5초 넘게 걸려 뜨기도 한다).
      // waiting을 모르는 도우미면 예전처럼 2.4초 뒤 판단한다
      const knows = 'waiting' in w;
      const limit = knows ? this.closeWait : 2400;
      const t0 = Date.now();
      let raised = false, told = false;
      do {
        await sleep(300);
        w = await this.findWid(wid, match);
        if (!w || w.waiting) break;
        // 윈도우 엑셀은 뒤에 있는 동안 저장 창을 띄우지 않는다 (8초 넘게 기다려도 안 뜸, 앞으로 가져오면 0.2초, docs/poc/windows.md).
        // 1초쯤 지나도 창이 남아 있으면 앞으로 가져와 프로그램이 묻게 한다
        if (knows && !raised && Date.now() - t0 > 900){ raised = true; await this.raiseWid(wid); }
        if (!told && Date.now() - t0 > 1500){ told = true; this.say(`'${it.title}'을(를) 닫는 중입니다…`); }
      } while (Date.now() - t0 < limit);
    }
    if (!w){ this.unlink(id); return this.say(`'${it.title}'을(를) 닫았습니다`); }
    // 저장 여부·로그인 같은 확인 창이 떠 있으면 닫기 요청이 무시된다 → 그 창을 앞으로 가져와 선생님이 답하게.
    // 바탕 창을 앞으로 가져오면 도우미가 그 창(시트·대화상자)도 함께 앞으로 가져온다 (윈도우·맥 모두 확인)
    st.status = 'blocked';
    await this.raiseWid(wid);
    this.highlight = id;
    this.say(w.waiting
      ? `'${it.title}': 프로그램이 답을 기다리는 창(저장 여부 등)을 띄웠습니다. 그 창에서 답해 주세요`
      : `'${it.title}'이(가) 닫히지 않았습니다. 프로그램이 답을 기다리는 창(저장 여부 등)을 띄웠는지 확인해 주세요`);
  }

  // ---------- 나란히 보기 ----------
  toggleSel(id){
    if (!this.state.has(id)) return;
    if (this.sel.includes(id)) this.sel = this.sel.filter(x => x !== id);
    else if (this.sel.length >= 2) return this.say('체험판에서는 두 개까지 나란히 놓을 수 있습니다');
    else this.sel = [...this.sel, id];
    this.changed();
  }

  async split(){
    const ids = this.sel.slice(0, 2);
    if (ids.length < 2) return this.say('나란히 놓을 자료 두 개를 고르세요');
    for (const id of ids){
      if (this.state.get(id).status !== 'open') await this.open(id, { raise: false, quiet: true });
    }
    const wids = ids.map(id => this.state.get(id).wid);
    if (wids.some(w => !w)) return this.say('나란히 놓을 창을 열지 못했습니다');
    const where = this.dual ? 'student' : 'teacher';
    const area = this.area(where);
    let [ra, rb] = M.tileRects(area, 'half');
    let a = await this.moveWid(wids[0], ra), b = await this.moveWid(wids[1], rb);
    let note = '';
    if (!(M.rectClose(a, ra, 24) && M.rectClose(b, rb, 24))){
      // 프로그램 최소 폭보다 좁게는 안 줄어든다 → 그 폭에서 멈추게 비율 조정
      const minA = a.width > ra.width + 24 ? a.width : 0, minB = b.width > rb.width + 24 ? b.width : 0;
      const f = M.fitRatio(area.width, 0.5, minA, minB);
      if (f !== null){
        [ra, rb] = M.tileRects(area, 'half', [f]);
        await this.moveWid(wids[0], ra); await this.moveWid(wids[1], rb);
        note = ' (프로그램 최소 폭 때문에 비율을 조정)';
      }
    }
    for (const id of ids){ const st = this.state.get(id); st.disp = where; st.home = where; }
    await this.raiseWid(wids[1]);
    await this.raiseWid(wids[0]);
    this.tile = { ids, where };
    this.sel = [];
    this.highlight = ids[0];
    this.say(`두 창을 ${this.dual ? '학생 화면에 ' : ''}나란히 놓았습니다${note}`);
  }

  async untile(){
    if (!this.tile) return;
    const { ids, where } = this.tile;
    this.tile = null;
    for (const id of ids){ if (this.state.get(id)?.wid) await this.place(id, where); }
    this.say('나란히 보기를 풀었습니다');
  }

  // ---------- 그 밖 ----------
  async openAll(){
    const items = this.lesson.items.filter(it => !it.problem);
    const t0 = Date.now();
    this.say(`자료 ${items.length}개를 미리 여는 중…`);
    for (const it of items){
      if (this.state.get(it.id).status !== 'open') await this.open(it.id, { raise: false, quiet: true });
    }
    // 학생 화면(모니터 한 대면 그 화면)에는 첫 자료만 보이게 하고 나머지는 최소화
    const main = this.dual ? 'student' : 'teacher';
    const first = items.find(it => this.state.get(it.id).wid && this.state.get(it.id).disp === main);
    for (const it of items){
      const st = this.state.get(it.id);
      if (st.wid && it !== first && st.disp === main){ try { await this.helper.call('minimize', st.wid); } catch { /* 계속 */ } }
    }
    if (first){ await this.raiseWid(this.state.get(first.id).wid); this.highlight = first.id; }
    const ok = items.filter(it => this.state.get(it.id).wid).length;
    this.say(`자료 ${ok}/${items.length}개를 ${Math.round((Date.now() - t0) / 1000)}초 만에 미리 열었습니다 · 목록을 누르면 바로 앞으로 옵니다`);
  }

  async next(){
    const items = this.lesson.items;
    const i = items.findIndex(it => it.id === this.highlight);
    const nx = items[i + 1];
    if (nx) return this.activate(nx.id);
    this.say('마지막 자료입니다');
  }

  /** 학생 화면(모니터 한 대면 그 화면)에서 지금 보는 자료만 남기고 최소화. 교사 화면의 메모 등은 그대로. */
  async hideOthers(){
    const main = this.dual ? 'student' : 'teacher';
    let n = 0;
    for (const [id, st] of this.state){
      if (st.wid && st.disp === main && id !== this.highlight){ try { await this.helper.call('minimize', st.wid); n++; } catch { /* 계속 */ } }
    }
    const keep = this.highlight ? `'${this.item(this.highlight).title}'만 남기고 ` : '';
    this.say(n ? `${keep}${this.dual ? '학생 화면의 ' : ''}다른 자료 창 ${n}개를 숨겼습니다` : '숨길 창이 없습니다');
  }

  /**
   * 사이드바를 다시 켰을 때 이미 열려 있는 문서 창(PPT·엑셀·한글·메모)을 찾아 다시 연결한다.
   * 브라우저 창은 제목만으로 어느 자료인지 알 수 없어 연결하지 않는다.
   */
  async relink(){
    if (!this.lesson) return 0;
    let all;
    try { all = await this.list(); } catch { return 0; }
    let n = 0;
    for (const it of this.lesson.items){
      const st = this.state.get(it.id);
      const key = this.launcher.appKeyFor(it);
      if (st.wid || key === 'browser' || !it.abs) continue;
      const app = this.launcher.APPS[key];
      const taken = new Set([...this.state.values()].map(s => s.wid).filter(Boolean));
      // 윈도우 도우미의 app은 실행 파일 이름(POWERPNT.EXE, Hwp.exe 등)이라 대소문자 없이 비교한다
      const m = (app.match ?? '').toLowerCase();
      const w = m && M.findByTitle(all.filter(x => !taken.has(x.wid) && ((x.app ?? '').toLowerCase().includes(m) || (x.bundle ?? '').toLowerCase().includes(m))), M.stem(it.abs))[0];
      if (!w) continue;
      // 다시 켜기 전에 누가 연 창인지 모르므로 "있던 창"으로 본다 (탭을 쓰는 메모장은 사이드바가 닫지 않음)
      st.wid = w.wid; st.status = 'open'; st.linkedAt = Date.now(); st.adopted = true;
      st.disp = this.student && M.displayOf(w, this.displays) === this.student.index ? 'student' : 'teacher';
      st.home = st.disp;
      n++;
    }
    if (n) this.say(`이미 열려 있던 자료 창 ${n}개를 다시 연결했습니다`);
    return n;
  }

  setOpenTo(v){
    this.openTo = v === 'teacher' ? 'teacher' : 'student';
    this.say(this.openTo === 'teacher' ? '새로 여는 자료를 교사 화면에서 먼저 엽니다 · 확인한 뒤 ⇄로 학생 화면에 보내세요' : '새로 여는 자료를 학생 화면에 바로 띄웁니다');
  }

  // ---------- 도우미 알림 ----------
  onFront(f){
    if (!f?.wid || f.pid === this.ownPid) return;   // 사이드바 자신은 무시
    for (const [id, st] of this.state){
      if (st.wid === f.wid){
        if (this.highlight !== id){ this.highlight = id; this.changed(); }
        return;
      }
    }
  }

  onAlive(alive){
    let changed = false;
    const answered = [];   // 답을 기다리던 창에서 선생님이 답해 닫힌 자료
    const now = Date.now();
    for (const [id, st] of this.state){
      if (st.wid && st.status !== 'opening' && now - st.linkedAt > ALIVE_GRACE && !alive.has(st.wid)){
        if (st.status === 'blocked') answered.push(this.item(id)?.title);
        st.status = 'closed'; st.wid = null; st.disp = null; changed = true;
        if (this.highlight === id) this.highlight = null;
        if (this.tile?.ids.includes(id)) this.tile = null;
      }
    }
    if (answered.length) this.say(`${answered.map(t => `'${t}'`).join(', ')}을(를) 닫았습니다`);
    else if (changed) this.changed();
  }

  /** 모니터를 꽂거나 뺐을 때. */
  async onDisplaysChanged(){
    const { hadStudent, hasStudent } = await this.refreshDisplays();
    if (hadStudent && !hasStudent){
      let n = 0;
      for (const [id, st] of this.state){
        if (st.wid && st.disp === 'student'){ st.home = 'student'; await this.place(id, 'teacher'); n++; }
      }
      this.tile = null;
      this.say(`학생 화면 연결이 끊겼습니다${n ? ` · 창 ${n}개를 교사 화면으로 모았습니다` : ''} · 다시 연결하면 원래대로 돌려놓습니다`);
    } else if (!hadStudent && hasStudent){
      let n = 0;
      for (const [id, st] of this.state){
        if (st.wid && st.home === 'student'){ await this.place(id, 'student'); n++; }
      }
      this.say(`학생 화면이 연결됐습니다${n ? ` · 창 ${n}개를 학생 화면으로 돌려놓았습니다` : ''}`);
    } else this.changed();
  }

  // ---------- 화면에 보낼 상태 ----------
  appLabel(it){
    const key = this.launcher.appKeyFor(it);
    return key === 'browser' ? (this.browser?.label ?? '브라우저') : this.launcher.APPS[key].label;
  }
  snapshot(){
    const Ls = this.lesson;
    return {
      lesson: Ls ? {
        title: Ls.title, date: Ls.date, folder: Ls.root,
        sections: Ls.sections.map(s => ({ id: s.id, title: s.title, minutes: s.minutes,
          items: s.items.map(it => ({ id: it.id, title: it.title, type: it.type, start: it.start, app: this.appLabel(it), home: this.home(it), problem: it.problem })) })),
      } : null,
      state: Object.fromEntries([...this.state].map(([id, st]) => [id, { status: st.status, disp: st.disp, note: st.note }])),
      highlight: this.highlight, sel: this.sel, tile: this.tile ? { ids: this.tile.ids } : null,
      dual: this.dual, studentName: this.student?.name ?? null, teacherName: this.teacher?.name ?? null,
      openTo: this.openTo, autoHide: this.autoHide, msg: this.msg,
    };
  }
}
