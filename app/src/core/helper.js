// 창 관리 도우미(winctl) 연결. 규격: docs/poc/helper-protocol.md
// - 맥: 빌드한 실행 파일 하나 (poc/mac-helper/.build/release/winctl)
// - 윈도우: node winctl.js — 실제 앱에서는 Electron 자신을 Node로 실행한다 (ELECTRON_RUN_AS_NODE=1, 따로 Node 설치 불필요)
import { execFile, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';

/**
 * 도우미가 ok:false로 답했을 때의 오류. 받은 응답 전체를 response에 붙인다 —
 * raise는 창이 있어도 맨 앞이 안 되면 {ok:false, front, detail}로 답하므로 그 내용(front 등)을 쓸 수 있게.
 */
export function responseError(res){
  const e = new Error(res.error || '도우미 오류');
  e.response = res;
  return e;
}

const CALL_TIMEOUT = 20000;
const SERVE_MAX = 3;          // 계속 켜 두는 도우미는 많아야 3개 (바쁠 때만 늘린다)
const SERVE_IDLE_MS = 20000;  // 첫 번째 말고는 20초 동안 할 일이 없으면 끈다

export class Helper extends EventEmitter {
  /**
   * @param bin   실행 파일
   * @param pre   명령 앞에 붙일 인자 (윈도우: winctl.js 경로)
   * @param env   더할 환경 변수
   * @param needs 있어야 하는 파일·폴더 (없으면 available()이 false)
   * @param serve 도우미를 켜 둔 채로 명령을 보낸다 ('serve', 규격 문서). 도우미가 모르면 저절로 예전처럼 명령마다 실행
   */
  constructor(bin, { pre = [], env = null, needs = [], serve = false } = {}){
    super();
    this.bin = bin;
    this.pre = pre;
    this.opts = { windowsHide: true, ...(env ? { env: { ...process.env, ...env } } : {}) };
    this.needs = [bin, ...needs];
    this.watcher = null;
    this.stopped = false;
    this.serveOk = !!serve;
    this.servers = [];
  }

  available(){ return this.needs.every(p => existsSync(p)); }

  /** 명령 하나 → 응답 JSON. ok:false면 오류 (응답은 오류의 response). */
  call(...args){
    const a = args.map(String);
    if (!this.serveOk || this.stopped) return this.exec(a);
    return this.viaServer(a).catch(e => {
      if (!e.retry) throw e;
      if (e.fallback) this.serveOk = false;   // 'serve'를 모르는 도우미 → 앞으로는 명령마다 실행
      return this.exec(a);
    });
  }

  // ---------- 계속 켜 둔 도우미 ('serve') ----------
  // 명령마다 프로세스를 띄우면 맥 도우미는 시작에만 0.3초쯤 걸리고(AppKit 읽기), 창 목록도 매번 처음부터라 느렸다.
  // 받는 줄 = 인자 배열 JSON, 답 = 한 줄. 도우미 하나는 명령을 차례로 처리하므로, 앞 명령이 오래 걸리면 하나 더 켠다.
  // 사이드바가 꺼지면 입력이 끊겨 도우미도 스스로 끝난다 (남아서 떠도는 프로세스가 없게).
  viaServer(a){
    return new Promise((resolve, reject) => {
      let s = this.servers.reduce((m, x) => (!m || x.queue.length < m.queue.length ? x : m), null);
      if (!s || (s.queue.length && this.servers.length < SERVE_MAX)) s = this.spawnServer();
      if (!s) return reject(Object.assign(new Error('도우미를 켜지 못했습니다'), { retry: true }));
      clearTimeout(s.idle);
      const job = { resolve, reject, timer: setTimeout(() => {
        // 답이 없으면 그 도우미를 끈다 (기다리던 다른 명령은 명령마다 실행으로 다시)
        job.reject(new Error('도우미가 답하지 않습니다')); job.done = true;
        s.p.kill();
      }, CALL_TIMEOUT) };
      s.queue.push(job);
      try { s.p.stdin.write(JSON.stringify(a) + '\n'); } catch { /* 끝난 도우미 — exit에서 처리 */ }
    });
  }

  spawnServer(){
    let p;
    try { p = spawn(this.bin, [...this.pre, 'serve'], { ...this.opts, stdio: ['pipe', 'pipe', 'ignore'] }); } catch { return null; }
    const s = { p, ready: false, queue: [], idle: null };
    this.servers.push(s);
    const settle = () => {
      if (s.queue.length || this.servers[0] === s) return;
      clearTimeout(s.idle);
      s.idle = setTimeout(() => { if (!s.queue.length) s.p.stdin.end(); }, SERVE_IDLE_MS);
    };
    createInterface({ input: p.stdout }).on('line', line => {
      let m;
      try { m = JSON.parse(line); } catch { return; }
      if (!s.ready){
        if (m?.serve) { s.ready = true; return; }
        s.unsupported = true;   // 'serve'를 모름 (예전 도우미·윈도우 도우미) — 끝날 때 명령마다 실행으로 다시
        return;
      }
      const job = s.queue.shift();
      if (!job) return;
      clearTimeout(job.timer);
      if (!job.done){
        if (m?.ok === false) job.reject(responseError(m)); else job.resolve(m);
      }
      if (!s.queue.length) settle();
    });
    p.stdin.on('error', () => {});
    const gone = () => {
      if (s.gone) return;
      s.gone = true;
      clearTimeout(s.idle);
      this.servers = this.servers.filter(x => x !== s);
      const fallback = s.unsupported || !s.ready;
      for (const job of s.queue.splice(0)){
        clearTimeout(job.timer);
        if (!job.done) job.reject(Object.assign(new Error('도우미가 끝났습니다'), { retry: true, fallback }));
      }
    };
    p.on('exit', gone);
    p.on('error', gone);
    return s;
  }

  /** 켜 둔 도우미를 모두 끈다 (손쉬운 사용 권한이 바뀌었을 때·모니터가 바뀌었을 때 새로 켜지게). 하던 명령은 마저 한다. */
  restartServers(){
    for (const s of this.servers.splice(0)){ clearTimeout(s.idle); try { s.p.stdin.end(); } catch { /* 이미 끝남 */ } }
  }

  /** 명령 하나를 새 프로세스로 실행 → 마지막 줄 JSON */
  exec(a){
    return new Promise((resolve, reject) => {
      execFile(this.bin, [...this.pre, ...a], { ...this.opts, timeout: CALL_TIMEOUT, maxBuffer: 8 << 20 }, (err, stdout) => {
        const last = String(stdout || '').trim().split(/\r?\n/).pop();
        let res = null;
        try { res = JSON.parse(last); } catch { /* 아래에서 처리 */ }
        if (!res) return reject(new Error(err ? err.message : '도우미 응답을 읽지 못했습니다'));
        if (res.ok === false) return reject(responseError(res));
        resolve(res);
      });
    });
  }

  /** 맨 앞 창 변화('front')와 살아 있는 창 목록('alive')을 계속 받는다. 꺼지면 1초 뒤 다시 켠다. */
  startWatch(){
    if (this.watcher || this.stopped) return;
    const p = spawn(this.bin, [...this.pre, 'watch'], { ...this.opts, stdio: ['ignore', 'pipe', 'ignore'] });
    this.watcher = p;
    createInterface({ input: p.stdout }).on('line', line => {
      let m;
      try { m = JSON.parse(line); } catch { return; }
      if (m.event === 'front') this.emit('front', m.front);
      else if (m.event === 'alive') this.emit('alive', new Set(m.wids));
    });
    p.on('exit', () => {
      this.watcher = null;
      if (!this.stopped) setTimeout(() => this.startWatch(), 1000);
    });
  }

  /** 감시를 다시 시작한다 (손쉬운 사용 권한을 방금 켰을 때). 꺼지면 startWatch가 1초 뒤 다시 켠다. */
  restartWatch(){ this.watcher?.kill(); }

  /**
   * 클릭 자리를 계속 받는다 ('clicks': {"event":"click","x","y","button"} 한 줄씩, 좌표는 'displays'와 같은 단위).
   * 포인터 강조를 켠 동안만 켠다. 도우미가 'clicks'를 모르면 바로 끝나므로 다시 켜지 않는다 (물결만 없음).
   */
  startClicks(onClick){
    this.onClick = onClick;
    if (this.clicker || this.stopped) return;
    const p = spawn(this.bin, [...this.pre, 'clicks'], { ...this.opts, stdio: ['ignore', 'pipe', 'ignore'] });
    const began = Date.now();
    this.clicker = p;
    createInterface({ input: p.stdout }).on('line', line => {
      let m;
      try { m = JSON.parse(line); } catch { return; }
      if (m.event === 'click' && Number.isFinite(m.x) && Number.isFinite(m.y)) this.onClick?.(m);
    });
    p.on('error', () => {});
    p.on('exit', () => {
      if (this.clicker !== p) return;
      this.clicker = null;
      // 한참 잘 돌다 꺼졌으면(잠자기 등) 다시 켠다
      if (this.onClick && !this.stopped && Date.now() - began > 5000) setTimeout(() => { if (this.onClick) this.startClicks(this.onClick); }, 1000);
    });
  }

  stopClicks(){
    this.onClick = null;
    const p = this.clicker; this.clicker = null;
    p?.kill();
  }

  stop(){
    this.stopped = true;
    this.watcher?.kill();
    this.stopClicks();
    this.restartServers();
  }
}
