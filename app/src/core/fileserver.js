// 수업 폴더 파일을 브라우저에 건네는 내부 주소 (127.0.0.1).
// file:// 은 맥 폴더 보호 권한 창이 뜨고 학교 관리 브라우저가 막을 수 있어 이 방식을 쓴다 (docs/poc/mac.md).
// 이 PC 안에서만 열리고, 실행할 때마다 바뀌는 토큰이 맞아야 하며, 수업 폴더 밖 파일은 주지 않는다.
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav',
  '.mp4': 'video/mp4', '.webm': 'video/webm',
};

export async function startFileServer(getRoot){
  const token = randomBytes(16).toString('hex');
  const server = http.createServer((req, res) => {
    const root = getRoot();
    const parts = new URL(req.url, 'http://127.0.0.1').pathname.split('/').filter(Boolean);
    if (!root || parts[0] !== token || parts.length < 2){ res.writeHead(404); res.end(); return; }
    let rel;
    try { rel = parts.slice(1).map(decodeURIComponent).join('/').normalize('NFC'); }
    catch { res.writeHead(400); res.end(); return; }
    const abs = path.resolve(root, rel);
    if (!abs.startsWith(root + path.sep)){ res.writeHead(403); res.end(); return; }
    let st;
    try { st = statSync(abs); } catch { res.writeHead(404); res.end(); return; }
    if (!st.isFile()){ res.writeHead(404); res.end(); return; }
    const head = {
      'Content-Type': MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Accept-Ranges': 'bytes',
    };
    // 음악·영상을 원하는 곳부터 재생할 수 있게 일부 구간 요청(Range)을 받는다
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    if (m && st.size > 0){
      let start = m[1] === '' ? st.size - Number(m[2]) : Number(m[1]);
      let end = m[1] !== '' && m[2] !== '' ? Number(m[2]) : st.size - 1;
      start = Math.max(0, start); end = Math.min(st.size - 1, end);
      if (start > end){ res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); res.end(); return; }
      res.writeHead(206, { ...head, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
      createReadStream(abs, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { ...head, 'Content-Length': st.size });
    createReadStream(abs).pipe(res);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  return {
    url: rel => `http://127.0.0.1:${port}/${token}/` + rel.split('/').map(encodeURIComponent).join('/'),
    close: () => server.close(),
  };
}
