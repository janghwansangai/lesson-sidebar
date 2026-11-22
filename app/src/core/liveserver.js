// 수업 중 화면을 보내는 작은 웹 서버: 발표자 화면(이 PC 안, 127.0.0.1)과 휴대폰 리모컨(같은 와이파이)이 같은 페이지를 본다.
// - 주소마다 따로 만든 긴 열쇠(token)가 경로에 있어야 한다. 휴대폰 열쇠는 리모컨을 켤 때마다 새로 만든다 (끄거나 "새 주소"면 이전 휴대폰은 끊김).
// - 받는 요청은 REMOTE_ACTIONS 뿐 (다음·이전·자료 띄우기·정지·가리기 등). 파일 열기·설정·끝내기는 안 된다.
// - 상태는 SSE(서버가 보내는 이벤트)로 보낸다. 내용이 같으면 다시 보내지 않는다.
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REMOTE_ACTIONS } from './live.js';

const MAX_SSE = 8;
const STATIC = { 'live.js': 'text/javascript; charset=utf-8', 'live.css': 'text/css; charset=utf-8' };
const HEAD = {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
};

export class LiveServer {
  /**
   * @param {{ dir: string, getState: () => object, onAct: (action, arg, kind) => any, getThumb?: () => Buffer|null, onClients?: () => void }} o
   *   dir: live.html·live.js·live.css가 있는 폴더
   */
  constructor({ dir, getState, onAct, getThumb = () => null, onClients = () => {} }){
    Object.assign(this, { dir, getState, onAct, getThumb, onClients });
    this.ls = new Map();     // kind('local'|'lan') → { server, token, port, sse:Set, sockets:Set }
    this.last = null;
    this.ports = new Map();  // kind → 지난번 포트. "새 주소"로 열쇠만 바꿀 때 같은 포트를 써서, 이전 휴대폰이 "끊겼다"(404)를 바로 알게 한다
  }

  async listen(kind, host){
    if (this.ls.has(kind)) return this.ls.get(kind);
    const l = { token: randomBytes(16).toString('hex'), sse: new Set(), sockets: new Set(), host };
    l.server = http.createServer((req, res) => this.handle(l, kind, req, res).catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); }));
    l.server.on('connection', s => { l.sockets.add(s); s.on('close', () => l.sockets.delete(s)); });
    const tryListen = port => new Promise((resolve, reject) => { l.server.once('error', reject); l.server.listen(port, host, resolve); });
    const prev = this.ports.get(kind);
    if (prev){ try { await tryListen(prev); } catch { await tryListen(0); } }
    else await tryListen(0);
    this.ports.set(kind, l.server.address().port);
    l.port = l.server.address().port;
    this.ls.set(kind, l);
    return l;
  }

  close(kind){
    const l = this.ls.get(kind); if (!l) return;
    this.ls.delete(kind);
    for (const r of l.sse) r.end();
    l.server.close();
    for (const s of l.sockets) s.destroy();
    this.onClients();
  }
  closeAll(){ for (const k of [...this.ls.keys()]) this.close(k); }

  url(kind, address){ const l = this.ls.get(kind); return l ? `http://${address ?? l.host}:${l.port}/${l.token}/` : null; }
  clients(kind){ return this.ls.get(kind)?.sse.size ?? 0; }

  /** 상태가 바뀌었으면 모든 화면에 보낸다 (force: 같아도 보냄) */
  broadcast(force = false){
    if (!this.ls.size) return;
    const body = JSON.stringify(this.getState());
    if (!force && body === this.last) return;
    this.last = body;
    for (const l of this.ls.values()) for (const r of l.sse) this.send(r, body);
  }
  send(res, body){ res.write(`data: {"now":${Date.now()},"s":${body}}\n\n`); }

  async handle(l, kind, req, res){
    const u = new URL(req.url, 'http://x');
    const [t, name = ''] = u.pathname.split('/').filter(Boolean);
    if (t !== l.token){ res.writeHead(404, HEAD); res.end(); return; }
    if (req.method === 'GET' && name === ''){
      if (!u.pathname.endsWith('/')){ res.writeHead(302, { ...HEAD, Location: `/${t}/` }); res.end(); return; }
      res.writeHead(200, { ...HEAD, 'Content-Type': 'text/html; charset=utf-8' });
      res.end(readFileSync(path.join(this.dir, 'live.html'))); return;
    }
    if (req.method === 'GET' && Object.hasOwn(STATIC, name)){
      res.writeHead(200, { ...HEAD, 'Content-Type': STATIC[name] });
      res.end(readFileSync(path.join(this.dir, name))); return;
    }
    if (req.method === 'GET' && name === 'events'){
      if (l.sse.size >= MAX_SSE){ res.writeHead(429, HEAD); res.end(); return; }
      res.writeHead(200, { ...HEAD, 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
      res.write('retry: 2000\n\n');
      l.sse.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 20000);
      req.on('close', () => { clearInterval(ping); l.sse.delete(res); this.onClients(); });
      this.send(res, this.last ?? (this.last = JSON.stringify(this.getState())));
      this.onClients();
      return;
    }
    if (req.method === 'GET' && name === 'thumb'){
      const b = this.getThumb();
      if (!b){ res.writeHead(204, HEAD); res.end(); return; }
      res.writeHead(200, { ...HEAD, 'Content-Type': 'image/jpeg' }); res.end(b); return;
    }
    if (req.method === 'POST' && name === 'act'){
      let raw = '';
      for await (const c of req){ raw += c; if (raw.length > 1024){ res.writeHead(413, HEAD); res.end(); return; } }
      let p; try { p = JSON.parse(raw); } catch { p = null; }
      const action = p?.do, arg = p?.arg;
      if (typeof action !== 'string' || !REMOTE_ACTIONS.has(action) || (arg !== undefined && typeof arg !== 'string' && typeof arg !== 'boolean')){
        res.writeHead(403, HEAD); res.end(); return;
      }
      res.writeHead(204, HEAD); res.end();
      await this.onAct(action, arg, kind);
      return;
    }
    res.writeHead(404, HEAD); res.end();
  }
}
