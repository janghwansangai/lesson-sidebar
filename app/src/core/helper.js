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

export class Helper extends EventEmitter {
  /**
   * @param bin   실행 파일
   * @param pre   명령 앞에 붙일 인자 (윈도우: winctl.js 경로)
   * @param env   더할 환경 변수
   * @param needs 있어야 하는 파일·폴더 (없으면 available()이 false)
   */
  constructor(bin, { pre = [], env = null, needs = [] } = {}){
    super();
    this.bin = bin;
    this.pre = pre;
    this.opts = { windowsHide: true, ...(env ? { env: { ...process.env, ...env } } : {}) };
    this.needs = [bin, ...needs];
    this.watcher = null;
    this.stopped = false;
  }

  available(){ return this.needs.every(p => existsSync(p)); }

  /** 명령 하나 실행 → 마지막 줄 JSON. ok:false면 오류 (응답은 오류의 response). */
  call(...args){
    return new Promise((resolve, reject) => {
      execFile(this.bin, [...this.pre, ...args.map(String)], { ...this.opts, timeout: 20000, maxBuffer: 8 << 20 }, (err, stdout) => {
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
  }
}
