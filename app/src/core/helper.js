// 창 관리 도우미(winctl) 연결. 규격: docs/poc/helper-protocol.md
import { execFile, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';

export class Helper extends EventEmitter {
  constructor(bin){
    super();
    this.bin = bin;
    this.watcher = null;
    this.stopped = false;
  }

  available(){ return existsSync(this.bin); }

  /** 명령 하나 실행 → 마지막 줄 JSON. ok:false면 오류. */
  call(...args){
    return new Promise((resolve, reject) => {
      execFile(this.bin, args.map(String), { timeout: 20000, maxBuffer: 8 << 20 }, (err, stdout) => {
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
    const p = spawn(this.bin, ['watch'], { stdio: ['ignore', 'pipe', 'ignore'] });
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
