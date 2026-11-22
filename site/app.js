// 소개 사이트: 최신 설치 파일 연결 · 이 컴퓨터에 맞는 단추 강조 · 유튜브 영상 넣기
(() => {
  const REPO = 'janghwansangai/lesson-sidebar';
  const RELEASES = `https://github.com/${REPO}/releases`;
  const $ = id => document.getElementById(id);
  const mb = n => `${Math.round(n / 1048576)}MB`;

  // ---------- 최신 설치 파일 ----------
  // 초안·사전 공개가 아닌 Release 중, 파일 종류마다 그 파일이 있는 가장 새 것을 고른다 (맥·윈도우 파일이 다른 Release에 있어도 됨)
  const KINDS = {
    mac: a => /-mac-arm64\.dmg$/i.test(a.name),
    win: a => /-win-setup\.exe$/i.test(a.name),
    portable: a => /-win-portable\.exe$/i.test(a.name),
  };
  const ASSET_PREFIX = `https://github.com/${REPO}/releases/download/`;
  function pick(releases){
    const out = {};
    for (const rel of releases){
      if (rel.draft || rel.prerelease) continue;
      for (const [kind, test] of Object.entries(KINDS)){
        if (out[kind]) continue;
        const a = (rel.assets ?? []).find(x => test(x) && String(x.browser_download_url).startsWith(ASSET_PREFIX));
        if (a) out[kind] = { url: a.browser_download_url, size: a.size, version: String(rel.tag_name).replace(/^v/i, '') };
      }
    }
    return out;
  }
  async function releases(){
    const KEY = 'ls-releases', now = Date.now();
    try { const c = JSON.parse(sessionStorage.getItem(KEY) ?? 'null'); if (c && now - c.at < 10 * 60000) return c.data; } catch { /* 저장소를 못 쓰면 그냥 받기 */ }
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=10`, { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = (await r.json()).map(x => ({ tag_name: x.tag_name, draft: x.draft, prerelease: x.prerelease, assets: (x.assets ?? []).map(a => ({ name: a.name, size: a.size, browser_download_url: a.browser_download_url })) }));
    try { sessionStorage.setItem(KEY, JSON.stringify({ at: now, data })); } catch { /* 괜찮음 */ }
    return data;
  }
  function fill(found){
    const set = (id, f, sub, text) => {
      const a = $(id); if (!a) return;
      if (f){ a.href = f.url; if (sub && $(sub)) $(sub).textContent = text(f); }
      else { a.href = RELEASES; if (sub && $(sub)) $(sub).textContent = '준비 중 · 모든 버전 보기'; }
    };
    set('dl-mac', found.mac, 'dl-mac-sub', f => `Apple Silicon(M1~M4) · ${f.version} · ${mb(f.size)}`);
    set('dl-win', found.win, 'dl-win-sub', f => `윈도우 10·11 설치 파일 · ${f.version} · ${mb(f.size)}`);
    set('dl-portable', found.portable);
    const vs = [found.mac?.version, found.win?.version].filter(Boolean).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    $('dl-ver').textContent = vs.length ? `최신 ${vs[0]} · 무료` : '무료';
  }
  releases().then(rs => fill(pick(rs))).catch(() => { $('dl-ver').textContent = '무료 · 버전 목록은 GitHub에서'; });

  // ---------- 이 컴퓨터에 맞는 단추를 앞에 ----------
  const ua = navigator.userAgent;
  const os = /Mac OS X|Macintosh/.test(ua) && !/iPhone|iPad/.test(ua) ? 'mac' : /Windows/.test(ua) ? 'win' : null;
  if (os){
    const mine = $(os === 'mac' ? 'dl-mac' : 'dl-win'), other = $(os === 'mac' ? 'dl-win' : 'dl-mac');
    mine.parentNode.insertBefore(mine, mine.parentNode.firstChild);
    other.classList.add('dim');
  }

  // ---------- 유튜브 영상 ----------
  // SITE.youtube에 영상 ID나 주소(youtu.be/…, watch?v=…, shorts/…)를 넣으면 개인 정보 보호 모드(youtube-nocookie)로 넣는다
  function videoId(v){
    const s = String(v ?? '').trim();
    if (/^[\w-]{11}$/.test(s)) return s;
    const m = s.match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})/);
    return m ? m[1] : null;
  }
  const id = videoId(window.SITE?.youtube);
  if (id){
    const f = document.createElement('iframe');
    f.src = `https://www.youtube-nocookie.com/embed/${id}?rel=0`;
    f.title = '수업 사이드바 소개 · 사용법 영상';
    f.loading = 'lazy';
    f.allow = 'accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    f.allowFullscreen = true;
    f.referrerPolicy = 'strict-origin-when-cross-origin';
    $('video-box').replaceChildren(f);
  }
})();
