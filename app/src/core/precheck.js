// 사전 점검: 수업 전에 자료 파일·여는 프로그램·링크·PC 상태를 한 번에 확인한다 (docs/PLAN.md 13 3단계, 시안 "사전 점검").
// 여기에는 "무엇을 어떻게 판단할지"만 있고, 실제 확인(프로그램 찾기, 파일 읽기, 링크 열기, 모니터·권한)은 deps로 받는다.
// → 화면·인터넷 없이 시험한다 (test/precheck.test.js)
import { appKeyFor } from './launcher.js';
import { fmtBytes } from './bundle.js';

export const LEVELS = { ok: '정상', warn: '주의', bad: '문제' };
const RANK = { ok: 0, warn: 1, bad: 2 };
const worse = (a, b) => (RANK[b] > RANK[a] ? b : a);

// 프로그램이 없을 때 대안 (docs/PLAN.md 2: 한글 뷰어, PDF·그림·영상은 브라우저)
const ALT = {
  powerpoint: 'PDF로 저장해 넣으면 브라우저로 열 수 있습니다',
  excel: 'PDF로 저장해 넣으면 브라우저로 열 수 있습니다',
  hwp: '한컴오피스 한글 뷰어(무료)를 설치하거나 PDF로 저장해 넣으세요',
};

// 링크를 확인할 때 쓰는 이름. 브라우저 모양으로 보내야 일부 사이트가 자동 확인을 막지 않는다 (개인 정보는 넣지 않음)
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const LOGIN = /(^|\.)accounts\.google\.com$|^(www\.)?canva\.com\/login|\/(signin|login)(\/|$|\?)/i;

/**
 * 링크 하나 확인. 로그인 없이(쿠키 없이) 열어 본다 → "받는 사람·이 PC에서 그냥 열리는지"를 본다.
 * 넘겨주기(redirect)는 따라가고, 마지막에 도착한 주소가 로그인 화면이면 "로그인해야 열림"으로 본다.
 * 실제 앱은 fetchFn에 Electron net.fetch를 넣는다 (학교 프록시 등 이 PC의 인터넷 설정을 그대로 씀).
 * @returns {{ level, detail, net?: boolean }}  net: 인터넷 연결 자체가 안 됨
 */
export async function checkLink(url, type, { fetchFn = fetch, timeoutMs = 8000 } = {}){
  const get = u => fetchFn(u, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': UA, 'accept-language': 'ko,en;q=0.8' } });
  try {
    if (type === 'youtube'){
      const r = await get(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`);
      if (r.ok) return { level: 'ok', detail: '공개 영상' };
      if (r.status === 401 || r.status === 403) return { level: 'ok', detail: '유튜브에서 열림 (다른 곳에 퍼가기만 막힘)' };
      if (r.status === 404) return { level: 'bad', detail: '영상이 없거나 비공개입니다' };
      return { level: 'warn', detail: `유튜브가 확인해 주지 않았습니다 (${r.status}) · 직접 열어 보세요` };
    }
    const r = await get(url);
    let end = null;
    try { end = new URL(r.url || url); } catch { /* 그대로 */ }
    if (end && (LOGIN.test(end.hostname) || LOGIN.test(end.hostname + end.pathname))){
      const who = type === 'canva' ? '캔바' : type.startsWith('g') ? '구글' : '이 사이트';
      return { level: 'warn', detail: `로그인해야 열립니다 (${who} 링크 공유가 꺼져 있을 수 있음) · 이 PC 브라우저에 그 계정으로 로그인해 두거나 공유를 "링크가 있는 모든 사용자"로 바꾸세요` };
    }
    if (r.ok) return { level: 'ok', detail: type.startsWith('g') || type === 'canva' ? '링크로 누구나 볼 수 있습니다' : '열립니다' };
    if (r.status === 404 || r.status === 410) return { level: 'bad', detail: '페이지가 없습니다 (주소가 바뀌었거나 지워짐)' };
    if (r.status === 401 || r.status === 403) return { level: 'warn', detail: '로그인이 필요하거나 사이트가 자동 확인을 막습니다 · 직접 열어 보세요' };
    return { level: 'warn', detail: `사이트가 오류를 냈습니다 (${r.status}) · 직접 열어 보세요` };
  } catch (e){
    if (e?.name === 'TimeoutError') return { level: 'warn', detail: '응답이 느립니다 · 수업 중에 늦게 열릴 수 있습니다' };
    if (/redirect/i.test(`${e?.message} ${e?.cause?.message ?? ''}`)) return { level: 'warn', detail: '넘겨주기가 끝나지 않습니다 · 직접 열어 보세요' };
    return { level: 'bad', detail: '연결되지 않습니다 (인터넷 연결이나 주소를 확인하세요)', net: true };
  }
}

/** 동시에 n개씩 */
async function mapLimit(list, n, fn){
  const out = new Array(list.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => { while (i < list.length){ const k = i++; out[k] = await fn(list[k], k); } }));
  return out;
}

/**
 * 수업 하나를 점검한다.
 * @param lesson loadLesson() 결과
 * @param d { apps, browser, appInstalled(app), readThrough(abs)→{bytes,ms}, checkLink(url,type), screens:{count, student:{name,width,height}|null},
 *            trusted, freeBytes, lockedBy, cloud, onProgress(phase, done, total) }
 * @returns {{ rows: [{level, title, detail, id?}], counts: {ok, warn, bad}, summary }}
 */
export async function precheck(lesson, d){
  const items = lesson.items;
  const progress = d.onProgress ?? (() => {});

  // 1) 링크는 오래 걸릴 수 있어 먼저 4개씩 함께 확인한다
  const links = items.filter(it => it.url && !it.problem);
  let linkDone = 0;
  const linkRes = new Map((await mapLimit(links, 4, async it => {
    const r = await d.checkLink(it.url, it.type);
    progress('링크', ++linkDone, links.length);
    return [it.id, r];
  })));

  // 2) 자료마다: 파일(끝까지 한 번 읽어 둠 — 클라우드 폴더면 이때 이 PC로 내려받는다) → 여는 프로그램 → 링크
  const rows = [];
  const installed = new Map();
  let n = 0;
  for (const it of items){
    progress('파일', ++n, items.length);
    if (it.problem){ rows.push({ level: 'bad', title: it.title, detail: it.problem, id: it.id }); continue; }
    let level = 'ok';
    const parts = [];
    if (it.abs){
      try {
        const r = await d.readThrough(it.abs);
        parts.push(`파일 있음 (${fmtBytes(r.bytes)}${r.ms > 2000 ? `, 받는 데 ${(r.ms / 1000).toFixed(0)}초` : ''})`);
      } catch (e){
        rows.push({ level: 'bad', title: it.title, detail: `파일을 읽지 못했습니다 (${e.code ?? e.message})`, id: it.id });
        continue;
      }
    }
    const key = appKeyFor(it);
    if (key === 'browser'){
      if (!d.browser){ level = 'bad'; parts.push('열 브라우저가 없습니다 (크롬·엣지·웨일 중 하나 필요)'); }
      else if (!it.url) parts.push(`${d.browser.label}에서 엽니다`);
    } else if (key === 'default'){
      level = worse(level, 'warn'); parts.push('이 PC의 기본 프로그램으로 엽니다 · 수업 전에 한 번 열어 보세요');
    } else {
      const app = d.apps[key];
      if (!installed.has(key)) installed.set(key, await d.appInstalled(app));
      const ok = installed.get(key);
      if (ok === false){ level = 'bad'; parts.push(`${app.label}이(가) 이 PC에 없습니다 · ${ALT[key] ?? '다른 PC에서 PDF로 바꿔 넣으세요'}`); }
      else if (ok) parts.push(`${app.label} 있음`);
    }
    const lr = linkRes.get(it.id);
    if (lr){ level = worse(level, lr.level); parts.push(lr.detail); }
    rows.push({ level, title: it.title, detail: parts.join(' · '), id: it.id });
  }

  // 3) 이 PC
  const sys = [];
  if (links.length && links.every(it => linkRes.get(it.id)?.net)) sys.push({ level: 'bad', title: '인터넷', detail: '연결되지 않았습니다 · 링크 자료가 열리지 않습니다' });
  sys.push(d.browser ? { level: 'ok', title: '브라우저', detail: `${d.browser.label} · 평소 로그인 그대로 씁니다` }
                     : { level: links.length ? 'bad' : 'warn', title: '브라우저', detail: '크롬·엣지·웨일이 없습니다' });
  const s = d.screens ?? { count: 1, student: null };
  sys.push(s.student
    ? { level: 'ok', title: '모니터', detail: `${s.count}개 · 학생 화면: ${s.student.name || '외부 모니터'} ${s.student.width}×${s.student.height}` }
    : { level: 'warn', title: '모니터', detail: '1개 · 학생도 사이드바를 보게 됩니다 · 자동 숨김을 켜 두세요 (프로젝터를 복제 모드로 연결했다면 확장 모드로 바꾸면 학생 화면을 따로 쓸 수 있습니다)' });
  sys.push(d.trusted ? { level: 'ok', title: '창 제어 권한', detail: '허용됨' }
                     : { level: 'bad', title: '창 제어 권한', detail: "없습니다 · 시스템 설정 → 개인정보 보호 및 보안 → 손쉬운 사용에서 '수업 사이드바'를 켜 주세요" });
  if (d.freeBytes != null) sys.push(d.freeBytes < 1024 ** 3
    ? { level: 'warn', title: '저장 공간', detail: `남은 공간 ${fmtBytes(d.freeBytes)} · 녹화나 자료 추가에 모자랄 수 있습니다` }
    : { level: 'ok', title: '저장 공간', detail: `남은 공간 ${fmtBytes(d.freeBytes)}` });
  if (d.lockedBy) sys.push({ level: 'warn', title: '다른 PC', detail: `${d.lockedBy}에서 이 수업을 열고 있습니다 · 동시에 고치면 내용이 부딪힐 수 있습니다` });
  if (d.cloud) sys.push({ level: 'ok', title: '클라우드 폴더', detail: `${d.cloud} 폴더 · 자료 파일을 모두 한 번씩 읽어 이 PC에 받아 두었습니다 · 드라이브에서 이 수업 폴더를 "오프라인 사용"으로 해 두면 더 안전합니다` });

  const all = [...rows, ...sys];
  const counts = { ok: 0, warn: 0, bad: 0 };
  for (const r of all) counts[r.level]++;
  const summary = `점검 ${all.length}개 · ` + (counts.bad ? `문제 ${counts.bad}개` + (counts.warn ? ` · 주의 ${counts.warn}개` : '') + ' · 문제를 먼저 고쳐 주세요'
    : counts.warn ? `주의 ${counts.warn}개 · 주의 항목을 확인하면 바로 수업할 수 있습니다` : '모두 정상 · 바로 수업할 수 있습니다');
  return { rows: all, counts, summary };
}

/** 수업 폴더가 클라우드 동기화 폴더인지 (이름만, 경로는 돌려주지 않음) */
export function cloudOf(root){
  const p = String(root).normalize('NFC');
  if (/[\\/]CloudStorage[\\/]GoogleDrive-|[\\/]Google Drive[\\/]|[\\/](내 드라이브|My Drive)[\\/]/i.test(p)) return '구글 드라이브';
  // 윈도우 구글 드라이브(G: 같은 드라이브 문자) 맨 위의 다른 폴더: 공유 드라이브, 다른 컴퓨터, 바로 가기로 넣은 폴더
  if (/^[a-z]:[\\/](공유 드라이브|Shared drives|다른 컴퓨터|Other computers|\.shortcut-targets-by-id)[\\/]/i.test(p)) return '구글 드라이브';
  if (/[\\/]CloudStorage[\\/]OneDrive|[\\/]OneDrive[\\/ -]/i.test(p)) return 'OneDrive';
  if (/[\\/]Dropbox[\\/]/i.test(p)) return 'Dropbox';
  return null;
}
