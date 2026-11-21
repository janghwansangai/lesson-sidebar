// 창 관리 도우미(winctl) 연결. 규격: docs/poc/helper-protocol.md
// - 맥: 빌드한 실행 파일 하나 (poc/mac-helper/.build/release/winctl)
// - 윈도우: node winctl.js — 실제 앱에서는 Electron 자신을 Node로 실행한다 (ELECTRON_RUN_AS_NODE=1, 따로 Node 설치 불필요)
import { execFile, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';

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

  /** 명령 하나 실행 → 마지막 줄 JSON. ok:false면 오류. */
  call(...args){
    return new Promise((resolve, reject) => {
      execFile(this.bin, [...this.pre, ...args.map(String)], { ...this.opts, timeout: 20000, maxBuffer: 8 << 20 }, (err, stdout) => {
        const last = String(stdout || '').trim().split(/\r?\n/).pop();
        let res = null;
        try { res = JSON.parse(last); } catch { /* 아래에서 처리 */ }
        if (!res) return reject(new Error(err ? err.message : '도우미 응답을 읽지 못했습니다'));
        if (res.ok === false) return reject(new Error(res.error || '도우미 오류'));
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

  stop(){
    this.stopped = true;
    this.watcher?.kill();
  }
}
