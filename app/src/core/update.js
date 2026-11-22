// 새 버전 알림: GitHub에 올린 최신 설치판(Releases)을 하루 한 번(또는 "업데이트 확인"으로) 확인하고, 새 버전이면 받을 주소를 알려 준다.
// 받아서 바꿔 까는 것은 core/selfupdate.js (선생님이 "업데이트"를 누를 때). 맥은 이 맥에서 만든 자체 서명이라, 새 앱이 같은 인증서로
// 서명돼 있을 때만 바꾼다 — 다른 곳(자동 검사)에서 만든 설치판은 서명이 달라 권한이 풀리므로 (docs/poc/mac.md 45·63) 브라우저 내려받기로.
export const REPO = 'janghwansangai/lesson-sidebar';
const RELEASES = `https://github.com/${REPO}/releases`;

/** '0.10.1' > '0.9.3' → 1. 앞의 v, 뒤의 -beta 등은 무시 */
export function compareVersions(a, b){
  const p = v => String(v ?? '').replace(/^v/i, '').split(/[-+]/)[0].split('.').map(n => parseInt(n, 10) || 0);
  const x = p(a), y = p(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++){
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

/** 이 PC에 맞는 설치 파일 (맥: arm64 .dmg, 윈도우: 설치 .exe — 설치 없이 켜는 판으로 쓰는 중이면 portable .exe) */
export function pickAsset(assets, platform = process.platform, arch = process.arch, portable = !!process.env.PORTABLE_EXECUTABLE_FILE){
  const list = (assets ?? []).filter(a => typeof a?.browser_download_url === 'string' && a.browser_download_url.startsWith(`https://github.com/${REPO}/releases/download/`));
  if (platform === 'darwin') return list.find(a => /\.dmg$/i.test(a.name) && a.name.includes(arch)) ?? list.find(a => /\.dmg$/i.test(a.name)) ?? null;
  if (platform === 'win32'){
    const exe = list.filter(a => /\.exe$/i.test(a.name) && !/blockmap/i.test(a.name));
    return exe.find(a => /portable/i.test(a.name) === portable) ?? exe[0] ?? null;
  }
  return null;
}

/**
 * 최신 버전 확인. 새 버전이면 { version, url, page, notes, size }, 아니면 null. 연결이 안 되면 오류를 던진다.
 * fetchFn: Electron net.fetch (학교 프록시 설정을 따른다). 보내는 것은 앱 이름뿐이다 (선생님 정보 없음)
 */
export async function checkUpdate(current, { fetchFn = fetch, platform, arch } = {}){
  const r = await fetchFn(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'LessonSidebar-update-check' },
    signal: AbortSignal.timeout(10000),
  });
  if (r.status === 404) return null;              // 아직 올린 설치판이 없음
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const rel = await r.json();
  if (rel.draft || rel.prerelease) return null;
  const version = String(rel.tag_name ?? '').replace(/^v/i, '');
  if (!version || compareVersions(version, current) <= 0) return null;
  const asset = pickAsset(rel.assets, platform, arch);
  const page = typeof rel.html_url === 'string' && rel.html_url.startsWith(`${RELEASES}/`) ? rel.html_url : RELEASES;
  return { version, url: asset?.browser_download_url ?? page, page, size: asset?.size ?? null, notes: String(rel.body ?? '').trim().slice(0, 400) };
}

/** 열어도 되는 주소인지 (이 저장소의 Releases만) */
export const isReleaseUrl = u => typeof u === 'string' && (u === RELEASES || u.startsWith(`${RELEASES}/`));
