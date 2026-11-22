// 수업 진행 상태: 자료 ↔ 창 짝짓기, 열기·앞으로·학생 화면으로 보내기·나란히·닫기, 모니터 변화 처리.
// 화면(Electron)과 떨어져 있어 가짜 도우미로 시험할 수 있다 (app/test/session.test.js).
import { EventEmitter } from 'node:events';
import path from 'node:path';
import * as M from '../../../poc/lib/match.js';
import * as L from './launcher.js';
import { planAside } from './aside.js';

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
    this.offer = null;      // 안내 옆 단추 { act, id, wid, label } (메모장 탭 닫기)
    this.asideTries = new Map();   // 계속 비키기: 창마다 최근 옮긴 시각 (1분에 3번까지)
    this.extras = new Map();   // 열 때 함께 생겼지만 자료와 짝짓지 않은 창 (브라우저가 지난 창을 되살린 경우 등) wid → 프로그램 — '모두 닫기' 때 같이 닫는다
    this.aside = null;      // 사이드바를 고정할 때 옆으로 옮긴 창들 [{ wid, from, to, maximized }]
    this.asideQueue = Promise.resolve();
    this.browser = launcher.pickBrowser();
    helper.on('front', f => this.onFront(f));
    helper.on('alive', s => this.onAlive(s));
  }

  // ---------- 상태 알리기 ----------
  /** 안내 한 줄. offer를 주면 안내 옆에 단추가 붙는다 (다음 안내가 오면 사라짐). */
  say(msg, offer = null){ this.msg = msg; this.offer = offer; this.changed(); }
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
   * front: 'notfront'일 때 도우미가 알려 준 그때 맨 앞 창 (없으면 null).
   */
  async raiseInfo(wid){
    try { const r = await this.helper.call('raise', wid); return { state: r.ok ? 'ok' : 'notfront', waiting: r.detail?.waiting }; }
    catch (e){
      // 도우미는 창이 있어도 맨 앞으로 못 가져오면 ok:false로 답한다 (윈도우: "연결 프로그램 선택" 창이 맨 앞을 막을 때,
      // docs/poc/windows.md 15). 오류만으로는 창이 없어진 것인지 알 수 없으므로 목록에서 그 창이 아직 있는지 본다.
      // 창이 있는데 'gone'으로 보면 raise()가 같은 자료를 한 번 더 연다.
      let w;
      try { w = await this.findWid(wid); } catch { return { state: 'gone' }; }
      if (!w) return { state: 'gone' };
      const res = e?.response;
      return { state: 'notfront', waiting: 'waiting' in w ? w.waiting : res?.detail?.waiting, front: res?.front ?? null };
    }
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
      let opened = null;
      if (key === 'browser') opened = await this.launcher.openInBrowser(app, target);
      else await this.launcher.openWithApp(app, target);
      if (opened?.tab){
        // 새 창을 띄우면 같은 프로필을 두 브라우저가 열게 되는 상태: 하나 더 띄우지 않고 켜진 브라우저에 탭으로 열었다 (launcher.openInBrowser)
        const b = app.label;
        if (opened.reason === 'two'){
          st.status = 'closed'; st.note = `${b}이(가) 두 개 켜져 있음`;
          return this.say(`'${it.title}'을(를) 지금 ${b} 창에 탭으로 열었습니다. ${b}이(가) 두 개 켜져 있어(하나는 창 없이 남은 것일 수 있음) 새 창을 만들지 않았습니다 — 같은 프로필을 둘이 쓰면 로그인이 풀릴 수 있습니다. ${b}을(를) 모두 끈 뒤 다시 켜 주세요 (Dock 아이콘 오른쪽 클릭 → 종료, 그래도 남으면 '활성 상태 보기'에서 ${app.app}을(를) 골라 종료)`);
        }
        st.status = 'closed'; st.note = `${b} 다시 시작 필요`;
        return this.say(`'${it.title}'을(를) 지금 ${b} 창에 탭으로 열었습니다. ${b}이(가) 업데이트를 받고 다시 시작을 기다리고 있어서 하나 더 띄우지 않았습니다 (프로필 문제·로그인 풀림 예방). ${b}을(를) 완전히 껐다 켜면 다시 새 창으로 엽니다`);
      }

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
          // 함께 생긴 다른 창(지난 창 되살리기 등)은 사이드바가 연 창으로 기억해 '모두 닫기' 때 같이 닫는다
          for (const x of again.length ? again : fresh) if (x.wid !== w?.wid) this.extras.set(x.wid, app.match);
        }
      }
      if (!w) throw new Error('창을 찾지 못했습니다 (30초) · 그 프로그램에 확인·오류 창이 떠 있는지 봐 주세요');

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

  /** 맨 앞을 차지한 다른 창의 이름 (안내용, 30자까지). 그 창이 이 자료 창이거나 사이드바 자신이거나 이름이 없으면 null. */
  frontLabel(front, wid){
    if (!front || front.wid == null || front.wid === wid || front.pid === this.ownPid) return null;
    // 엣지 제목의 U+200B 같은 보이지 않는 글자는 뺀다 (docs/poc/windows.md)
    const clean = s => String(s ?? '').replace(/[​-‏‪-‮⁠﻿]/g, '').trim();
    // 윈도우 "연결 프로그램 선택" 창은 제목이 비어 있고 실행 파일 이름(OpenWith.exe)만 알 수 있다 (docs/poc/windows.md 15)
    const known = { 'openwith.exe': '연결 프로그램 선택' }[clean(front.app).toLowerCase()];
    const name = clean(front.title) || known || clean(front.app).replace(/\.exe$/i, '');
    if (!name) return null;
    return name.length > 30 ? `${name.slice(0, 29)}…` : name;
  }

  async raise(id){
    const it = this.item(id), st = this.state.get(id);
    const { state: r, waiting, front } = await this.raiseInfo(st.wid);
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
    else if (r === 'notfront'){
      // 창은 그대로 있으므로 다시 열지 않는다. 다른 창이 맨 앞을 막고 있으면 그 창을 알려 준다
      const name = this.frontLabel(front, st.wid);
      this.say(name
        ? `'${it.title}'을(를) 맨 앞으로 가져오지 못했습니다. 앞에 떠 있는 '${name}' 창을 먼저 닫은 뒤 다시 눌러 주세요`
        : `'${it.title}'을(를) 맨 앞으로 가져오지 못했습니다. 앞을 가리는 창(확인 창 등)이 있으면 먼저 닫은 뒤 다시 눌러 주세요`);
    }
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

  /** 사이드바가 연 창을 모두 닫는다 (정상 닫기 요청만 — 저장할지 묻는 창은 "답 기다림"으로 남긴다). 선생님이 원래 열어 둔 창은 그대로. */
  async closeAll(){
    const ids = [...this.state].filter(([, st]) => st.wid && (st.status === 'open' || st.status === 'blocked')).map(([id]) => id);
    for (const id of ids){ try { await this.close(id); } catch { /* 다음 창 */ } }
    let extra = 0;
    if (this.extras.size){
      let alive = new Set();
      try { alive = new Set((await this.list()).map(w => w.wid)); } catch { /* 모름 */ }
      for (const wid of [...this.extras.keys()]){
        this.extras.delete(wid);
        if (!alive.has(wid)) continue;
        try { await this.helper.call('close', wid); extra++; } catch { /* 다음 창 */ }
      }
    }
    const left = ids.filter(id => this.state.get(id)?.status === 'blocked').length;
    const n = ids.length - left + extra;
    this.say(n || left ? `사이드바가 연 창 ${n}개를 닫았습니다${left ? ` · ${left}개는 저장할지 묻고 있어 답을 기다립니다` : ''}` : '사이드바가 연 창이 없습니다');
  }

  async close(id){
    const it = this.item(id), st = this.state.get(id);
    if (!st?.wid) return;
    const app = this.launcher.APPS[this.launcher.appKeyFor(it)];
    if (app?.tabbed && it.abs){
      // 윈도우 11 메모장은 한 창에 여러 파일을 탭으로 연다 (켤 때 지난번 탭도 되살린다). 창을 닫으면 다른 탭(선생님 파일)까지
      // 닫히므로 창은 닫지 않고 이 메모 탭만 닫는다 (도우미 closetab, docs/poc/windows.md 체험판 8·14·15).
      // 사이드바가 연 창이면 바로 닫고, 열기 전부터 있던 창(선생님 메모장)이나 다시 켰을 때 연결한 창이면
      // 같은 이름의 다른 파일일 수도 있으므로 안내와 함께 단추를 보여 선생님이 누를 때 닫는다.
      const cur = (await this.list()).find(w => w.wid === st.wid);
      if (cur){
        if (!st.adopted) return this.closeTab(id);
        const wid = st.wid;
        this.unlink(id);
        return this.say(`'${it.title}'은(는) 다른 파일과 같은 ${app.label} 창에 탭으로 열려 있어 창을 닫지 않았습니다. 이 탭만 닫으려면 아래 단추를 누르세요`,
          { act: 'closeTab', id, wid, label: '사이드바에서 이 탭만 닫기' });
      }
    }
    return this.closeWindow(id);
  }

  /**
   * 탭을 쓰는 메모장에서 이 메모 탭만 닫는다 (윈도우 도우미 closetab — 다른 탭은 건드리지 않음).
   * 연결된 창이 없으면 close()가 보여 준 안내 단추(offer)의 창 번호를 쓴다.
   */
  async closeTab(id){
    const it = this.item(id), st = this.state.get(id);
    const app = it && this.launcher.APPS[this.launcher.appKeyFor(it)];
    if (!st || !it?.abs || !app?.tabbed) return;
    const offered = this.offer?.act === 'closeTab' && this.offer.id === id ? this.offer.wid : null;
    const wid = st.wid ?? offered;
    if (!wid) return;
    const name = path.basename(it.abs), label = app.label;
    const again = { act: 'closeTab', id, wid, label: '사이드바에서 이 탭만 닫기' };
    const drop = () => { if (st.wid === wid) this.unlink(id); };
    this.offer = null;
    let r;
    try { r = await this.helper.call('closetab', wid, name); }
    catch (e){ drop(); return this.say(`'${it.title}' 탭을 닫지 못했습니다 (${e.message}). ${label}에서 직접 닫아 주세요`); }
    if (r.tabs === false){
      // 탭이 없는 메모장(윈도우 10 등): 창 하나에 파일 하나이므로, 창 제목이 이 메모면 창을 닫는다
      if (!r.found){ drop(); return this.say(`${label} 창에 '${it.title}'이(가) 보이지 않아 닫지 않았습니다`); }
      Object.assign(st, { wid, status: 'open', linkedAt: Date.now(), adopted: false });
      return this.closeWindow(id);
    }
    if (r.closed){
      drop();
      return this.say(`'${it.title}' 탭을 닫았습니다${r.windowClosed ? '' : ` (${label}의 다른 탭은 그대로)`}`);
    }
    if (r.found && r.waiting){
      // 저장하지 않은 글이 있어 메모장이 저장할지 묻는다 → "답 기다림"
      Object.assign(st, { wid, status: 'blocked', linkedAt: Date.now(), adopted: true });
      this.highlight = id;
      this.say(`'${it.title}' 탭을 닫기 전에 ${label}이(가) 저장할지 묻고 있습니다. ${label}에서 답해 주세요`);
      this.followTab(id, wid, name);
      return;
    }
    if (r.waiting){ drop(); return this.say(`${label}이(가) 다른 확인 창을 띄우고 있어 아무 탭도 닫지 않았습니다. 그 창에서 답한 뒤 다시 눌러 주세요`, again); }
    drop();
    if (r.count > 1) return this.say(`${label}에 '${name}' 탭이 ${r.count}개 있어 어느 것인지 알 수 없어 닫지 않았습니다. ${label}에서 직접 닫아 주세요`);
    if (!r.found) return this.say(`${label}에서 '${it.title}' 탭을 찾지 못했습니다 (이미 닫혔을 수 있습니다)`);
    return this.say(`'${it.title}' 탭을 닫지 못했습니다 (${label}이(가) 맨 앞에 오지 않았을 수 있습니다). 다시 누르거나 ${label}에서 직접 닫아 주세요`, again);
  }

  /**
   * 저장 여부에 답할 때까지 지켜본다 (최대 약 1분 반, 1.5초마다 창 목록만 — 계속 도는 감시는 아님).
   * 보이는 탭이 바뀌거나 창이 닫히면 한 번만 탭이 남았는지 확인한다.
   */
  async followTab(id, wid, name){
    const it = this.item(id), st = this.state.get(id);
    const still = () => this.state.get(id) === st && st.wid === wid && st.status === 'blocked';
    const shows = t => { const s = String(t ?? '').replace(/^[*•●]\s*/, ''); return s === name || s.startsWith(`${name} - `); };
    for (let i = 0; i < 60; i++){
      await sleep(1500);
      if (!still()) return;
      let w;
      try { w = (await this.list()).find(x => x.wid === wid); } catch { continue; }
      if (w && shows(w.title)) continue;   // 아직 묻는 중이거나, 취소하고 그 탭을 보고 있음
      let r = null;
      if (w){ try { r = await this.helper.call('findtab', wid, name); } catch { /* 아래 */ } }
      if (!still()) return;
      if (r?.dialog) continue;
      this.unlink(id);
      if (!w || r?.count === 0) return this.say(`'${it.title}' 탭을 닫았습니다`);
      return this.say(`'${it.title}' 탭은 닫지 않고 그대로 두었습니다 (취소). 닫으려면 아래 단추를 누르세요`, { act: 'closeTab', id, wid, label: '사이드바에서 이 탭만 닫기' });
    }
  }

  /** 창 닫기 (정상 종료 요청). 저장 여부 등을 물으면 "답 기다림". */
  async closeWindow(id){
    const it = this.item(id), st = this.state.get(id);
    if (!st?.wid) return;
    const wid = st.wid, match = this.appFor(it)?.match;
    let w = await this.findWid(wid, match);
    // 이미 답을 기다리는 창(저장 여부·로그인 등)이 있으면 닫기 요청을 또 보내지 않는다.
    // 맥 한글은 저장 창이 하나 더 생기고, 그 창은 문서가 닫힌 뒤에도 남아 다른 한글 창까지 막는다 (docs/poc/mac.md 29)
    if (w && !w.waiting){
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

  // ---------- 사이드바를 고정할 때 가려지는 창 비키기 (설정, 윈도우) ----------
  // 고정으로 펼치는 순간 한 번 옮기고, 고정을 풀거나(자동 숨김) 설정을 끄거나 끝낼 때 한 번 돌려놓는다. 계속 지켜보지 않는다.
  // 선생님이 원래 열어 둔 창도 옮긴다 (선생님 결정, 2026-11-22). 순서가 섞이지 않게 하나씩 한다.
  aside_(fn){ const p = this.asideQueue.then(fn, fn); this.asideQueue = p.catch(() => {}); return p; }

  /** 교사 화면에서 사이드바에 가려지는 창을 사이드바 오른쪽으로 옮긴다. 옮긴 창 수. */
  stepAside(){
    return this.aside_(async () => {
      if (this.aside || !this.teacher) return 0;
      const span = Math.round(this.sidebarWidth * (this.physicalPixels ? (this.teacher.scale ?? 1) : 1));
      const plan = planAside(await this.list(), this.teacher, span, { ownPid: this.ownPid, displays: this.displays });
      const moved = [];
      for (const p of plan){
        try { moved.push({ ...p, to: (await this.moveWid(p.wid, p.to)) ?? p.to }); }
        catch { /* 옮길 수 없는 창(관리자 권한 등)은 그대로 */ }
      }
      this.aside = moved;
      return moved.length;
    });
  }

  /**
   * 고정해 둔 동안 계속 비키기 (맥, 2026-11-22 선생님 요청 — "고정 순간에만"으로는 새로 열거나 옮긴 창이 가려졌다).
   * main.js가 2초마다 부른다. 사이드바 아래로 들어온 창을 옮기고 돌려놓을 기록(this.aside)에 더한다.
   * 어떤 프로그램이 스스로 제자리로 돌아가도 서로 밀고 당기지 않게, 한 창은 1분에 3번까지만 옮긴다.
   * @returns 이번에 옮긴 창 수
   */
  keepAside(){
    return this.aside_(async () => {
      if (!this.teacher) return 0;
      const span = Math.round(this.sidebarWidth * (this.physicalPixels ? (this.teacher.scale ?? 1) : 1));
      let wins;
      try { wins = await this.list(); } catch { return 0; }
      const plan = planAside(wins, this.teacher, span, { ownPid: this.ownPid, displays: this.displays });
      if (!plan.length) return 0;
      const now = Date.now();
      const moved = this.aside ?? [];
      let n = 0;
      for (const p of plan){
        const tries = (this.asideTries.get(p.wid) ?? []).filter(t => now - t < 60000);
        if (tries.length >= 3) continue;
        tries.push(now); this.asideTries.set(p.wid, tries);
        try {
          const to = (await this.moveWid(p.wid, p.to)) ?? p.to;
          const prev = moved.find(m => m.wid === p.wid);
          if (prev) prev.to = to;            // 또 옮긴 창: 돌려놓을 곳은 처음 자리 그대로
          else moved.push({ ...p, to });
          n++;
        } catch { /* 옮길 수 없는 창은 그대로 */ }
      }
      this.aside = moved;
      return n;
    });
  }

  /** stepAside로 옮긴 창을 원래 자리·크기로 (최대화였으면 다시 최대화). 그사이 선생님이 옮기거나 최소화한 창은 그대로 둔다. */
  restoreAside(){
    return this.aside_(async () => {
      const moved = this.aside ?? [];
      this.aside = null;
      if (!moved.length) return 0;
      let wins;
      try { wins = await this.list(); } catch { return 0; }
      let n = 0;
      for (const m of moved){
        const w = wins.find(x => x.wid === m.wid);
        if (!w || w.minimized || w.maximized || !M.rectClose(w, m.to, 24)) continue;
        try {
          if (m.maximized) await this.helper.call('maximize', m.wid);
          else await this.moveWid(m.wid, m.from);
          n++;
        } catch { /* 계속 */ }
      }
      return n;
    });
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
      offer: this.offer ? { act: this.offer.act, id: this.offer.id, label: this.offer.label } : null,
    };
  }
}
