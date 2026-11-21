#!/usr/bin/env node
// 수업 사이드바 0단계 기술 검증 실행기 (맥·윈도우 공통)
// OS별 창 관리 도우미(docs/poc/helper-protocol.md)를 불러 시나리오를 차례로 실행하고 결과를 남긴다.
// 실행기는 자기가 연 창만 옮기고 닫는다.
//
//   node runner/run.js                         전체
//   node runner/run.js --only=P0,P1,B          일부 (B = 브라우저, F = 문서 프로그램)
//   node runner/run.js --browsers=chrome,edge,whale
//   node runner/run.js --keep                  끝나고 창을 닫지 않음

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import * as M from '../lib/match.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLES = path.join(ROOT, 'samples');
const OUT = path.join(ROOT, 'out');
const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';
const SIDEBAR_WIDTH = 272;   // 사이드바 고정 폭 (모니터 한 대일 때 분할 영역에서 뺀다)

const argv = process.argv.slice(2);
const opt = name => argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const ONLY = opt('only')?.split(',');
const BROWSERS = (opt('browsers') ?? 'chrome').split(',');
const KEEP = argv.includes('--keep');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const want = id => !ONLY || ONLY.some(o => id === o || id.startsWith(o));

// ---------- 도우미 ----------
function helper(...a){
  const [cmd, cargs] = IS_MAC
    ? [path.join(ROOT, 'mac-helper/.build/release/winctl'), a]
    : [process.execPath, [path.join(ROOT, 'win-helper/winctl.js'), ...a]];
  if (IS_MAC && !existsSync(cmd)) throw new Error('맥 도우미가 없습니다. 먼저 npm run build:mac');
  if (IS_WIN && !existsSync(cargs[0])) throw new Error('윈도우 도우미(win-helper/winctl.js)가 아직 없습니다');
  let out;
  try { out = execFileSync(cmd, cargs, { encoding: 'utf8', timeout: 20000 }); }
  catch (e) { out = e.stdout || ''; if (!out.trim()) throw new Error(`도우미 실행 실패: ${e.message}`); }
  const last = out.trim().split(/\r?\n/).pop();
  const res = JSON.parse(last);
  if (res.ok === false) throw new Error(res.error || '도우미 오류');
  return res;
}
const list = app => helper('list', ...(app ? ['--app', app] : [])).windows;

// ---------- 프로그램 열기 (OS별) ----------
const APPS = IS_MAC ? {
  chrome:     { label: '크롬',       match: 'Google Chrome',  bin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
  edge:       { label: '엣지',       match: 'Microsoft Edge', bin: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' },
  whale:      { label: '웨일',       match: 'Whale',          bin: '/Applications/Whale.app/Contents/MacOS/Whale' },
  powerpoint: { label: '파워포인트', match: 'PowerPoint',     app: 'Microsoft PowerPoint' },
  excel:      { label: '엑셀',       match: 'Excel',          app: 'Microsoft Excel' },
  hwp:        { label: '한글',       match: 'HWP',            app: 'Hancom Office HWP' },
} : {
  // 윈도우 값은 윈도우 Claude가 실제 PC에서 확인하고 고친다.
  chrome:     { label: '크롬',       match: 'chrome',   exe: 'chrome' },
  edge:       { label: '엣지',       match: 'msedge',   exe: 'msedge' },
  whale:      { label: '웨일',       match: 'whale',    exe: 'whale' },
  powerpoint: { label: '파워포인트', match: 'POWERPNT' },
  excel:      { label: '엑셀',       match: 'EXCEL' },
  hwp:        { label: '한글',       match: 'Hwp' },
};

function openBrowserWindow(key, url){
  const a = APPS[key];
  if (IS_MAC){
    if (!existsSync(a.bin)) throw new Error(`${a.label}가 설치되어 있지 않습니다`);
    spawn(a.bin, ['--new-window', url], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('cmd.exe', ['/d', '/s', '/c', 'start', '""', a.exe, '--new-window', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  }
}

function openFile(key, file){
  const a = APPS[key];
  if (IS_MAC) execFileSync('open', file ? ['-a', a.app, file] : ['-a', a.app]);
  else spawn('cmd.exe', ['/d', '/s', '/c', 'start', '""', file], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

async function waitFor(fn, timeout = 15000, every = 300){
  const t0 = Date.now();
  while (Date.now() - t0 < timeout){
    const v = await fn();
    if (v) return { value: v, ms: Date.now() - t0 };
    await sleep(every);
  }
  return { value: null, ms: Date.now() - t0 };
}

// ---------- 결과 ----------
const results = [];
const created = [];   // 실행기가 연 창 { wid, label }
const ctx = {};

async function step(id, name, fn){
  if (!want(id)) return;
  const t0 = Date.now();
  let r;
  try { r = (await fn()) ?? {}; }
  catch (e) { r = { status: 'fail', detail: e.message }; }
  const row = { id, name, status: r.status ?? 'pass', detail: r.detail ?? '', ms: Date.now() - t0, data: r.data };
  results.push(row);
  const mark = { pass: '통과', fail: '실패', skip: '건너뜀', warn: '주의' }[row.status];
  console.log(`[${mark}] ${id} ${name}${row.detail ? ' — ' + row.detail : ''}`);
  return row;
}

const fmtRect = r => `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}×${Math.round(r.height)}`;

async function raiseCheck(wid){
  const res = helper('raise', String(wid));
  return { ok: res.ok, ms: res.ms, front: res.front, detail: res.detail };
}

async function moveCheck(wid, rect){
  const res = helper('move', String(wid), ...[rect.x, rect.y, rect.width, rect.height].map(v => String(Math.round(v))));
  return { ok: M.rectClose(res.actual, rect, 24), actual: res.actual };
}

// ---------- 시나리오 ----------
async function main(){
  console.log(`수업 사이드바 기술 검증 · ${IS_MAC ? 'macOS' : IS_WIN ? 'Windows' : process.platform} ${os.release()} · Node ${process.version}\n`);

  const p0 = await step('P0', '창 제어 권한', () => {
    const t = helper('trusted').trusted;
    return t ? { detail: '있음' } : { status: 'fail', detail: IS_MAC ? '손쉬운 사용 권한이 없습니다 (시스템 설정 → 개인정보 보호 및 보안 → 손쉬운 사용)' : '권한 확인 실패' };
  });
  const canControl = !p0 || p0.status === 'pass';

  await step('P1', '모니터 목록', () => {
    const ds = helper('displays').displays;
    ctx.displays = ds;
    ctx.student = M.pickStudentDisplay(ds);
    ctx.primary = ds.find(d => d.primary) ?? ds[0];
    const desc = ds.map(d => `${d.name}(${d.builtin ? '내장' : '외부'}, ${d.width}×${d.height}, 배율 ${d.scale}${d.primary ? ', 주 모니터' : ''})`).join(' / ');
    return { detail: `${ds.length}개: ${desc}${ctx.student ? ` → 학생 화면 추정: ${ctx.student.name}` : ' → 모니터 한 대'}`, data: ds };
  });
  if (!ctx.displays){ try { const ds = helper('displays').displays; ctx.displays = ds; ctx.student = M.pickStudentDisplay(ds); ctx.primary = ds.find(d => d.primary) ?? ds[0]; } catch {} }

  if (!canControl){
    console.log('\n창 제어 권한이 없어 나머지 시험을 건너뜁니다.');
    return finish();
  }

  // ---- 브라우저 새 창 ----
  for (const b of BROWSERS){
    const A = APPS[b]; if (!A) continue;
    const pages = ['page-a.html', 'page-b.html'].map(f => pathToFileURL(path.join(SAMPLES, f)).href);
    const expect = ['수업 사이드바 시험 A', '수업 사이드바 시험 B'];
    ctx[b] = [];
    for (let i = 0; i < 2; i++){
      await step(`B1-${b}-${i + 1}`, `${A.label} 새 창 열기·연결 (${'AB'[i]})`, async () => {
        const before = list(A.match);
        const t0 = Date.now();
        openBrowserWindow(b, pages[i]);
        const { value: fresh } = await waitFor(() => { const n = M.newWindows(before, list(A.match)); return n.length ? n : null; }, 20000);
        if (!fresh) return { status: 'fail', detail: '새 창을 찾지 못했습니다 (20초)' };
        await sleep(800);   // 제목이 바뀔 시간을 준다
        const now = list(A.match);
        const cands = M.newWindows(before, now);
        const w = M.pickNewWindow(cands, expect[i]);
        created.push({ wid: w.wid, label: `${A.label} ${'AB'[i]}` });
        ctx[b].push(w.wid);
        const extra = cands.length > 1 ? ` · 새 창 ${cands.length}개가 함께 생김(이전 창 복원 등)` : '';
        return { status: cands.length > 1 ? 'warn' : 'pass', detail: `${Date.now() - t0}ms 만에 연결 · 제목 "${w.title}"${extra}`, data: { wid: w.wid, candidates: cands.map(c => c.title) } };
      });
    }
  }

  const [wa, wb] = ctx[BROWSERS[0]] ?? [];

  await step('P2', '앞으로 가져오기 (브라우저 창 A↔B 번갈아)', async () => {
    if (!wa || !wb) return { status: 'skip', detail: '브라우저 창이 없습니다' };
    const rows = [];
    for (const wid of [wa, wb, wa]){
      const r = await raiseCheck(wid);
      rows.push(r);
    }
    const okN = rows.filter(r => r.ok).length;
    return { status: okN === rows.length ? 'pass' : 'fail', detail: `${okN}/${rows.length}번 성공 · 걸린 시간 ${rows.map(r => r.ms + 'ms').join(', ')}`, data: rows };
  });

  await step('P3', '학생 화면으로 옮겨 꽉 채우기', async () => {
    if (!wa) return { status: 'skip', detail: '브라우저 창이 없습니다' };
    if (!ctx.student) return { status: 'skip', detail: '외부 모니터가 없어 건너뜀' };
    const target = M.workArea(ctx.student);
    const r = await moveCheck(wa, target);
    const where = M.displayOf(r.actual, ctx.displays);
    return { status: r.ok && where === ctx.student.index ? 'pass' : 'fail', detail: `요청 ${fmtRect(target)} → 실제 ${fmtRect(r.actual)} (모니터 ${where})` };
  });

  await step('P4', '화면 분할 (반반) + 비율 바꾸기 (7:3)', async () => {
    if (!wa || !wb) return { status: 'skip', detail: '브라우저 창이 둘 필요합니다' };
    const area = ctx.student ? M.workArea(ctx.student) : M.workArea(ctx.primary, SIDEBAR_WIDTH);
    const out = [];
    for (const key of ['half', 'seventy']){
      const [ra, rb] = M.tileRects(area, key);
      const a = await moveCheck(wa, ra), b = await moveCheck(wb, rb);
      out.push({ key, ok: a.ok && b.ok, a: a.actual, b: b.actual, ra, rb });
    }
    const bad = out.filter(o => !o.ok);
    return { status: bad.length ? 'fail' : 'pass',
      detail: out.map(o => `${o.key}: ${o.ok ? '맞음' : `어긋남 A ${fmtRect(o.a)} / B ${fmtRect(o.b)} (요청 ${fmtRect(o.ra)} / ${fmtRect(o.rb)})`}`).join(' · ') + (ctx.student ? ' · 학생 화면' : ' · 사이드바 뺀 영역'),
      data: out };
  });

  // ---- 문서 프로그램 ----
  const docs = [
    { key: 'powerpoint', id: 'F1', file: '샘플_발표자료.pptx' },
    { key: 'excel',      id: 'F2', file: '샘플_모둠편성.xlsx' },
    { key: 'hwp',        id: 'F3', file: pickHwpSample() },
  ];
  for (const d of docs){
    const A = APPS[d.key];
    await step(d.id, `${A.label} 열기·연결·앞으로·옮기기`, async () => {
      const file = d.file ? path.join(SAMPLES, d.file) : null;
      if (d.file && !existsSync(file)) return { status: 'skip', detail: `시험 파일이 없습니다: ${d.file}` };
      const before = list(A.match);
      const t0 = Date.now();
      openFile(d.key, file);
      const stem = file ? M.stem(file) : null;
      const { value: w } = await waitFor(() => {
        const fresh = M.newWindows(before, list(A.match));
        if (!fresh.length) return null;
        return stem ? (M.findByTitle(fresh, stem)[0] ?? null) : fresh[fresh.length - 1];
      }, 40000, 500);
      if (!w) {
        const fresh = M.newWindows(before, list(A.match));
        return { status: 'fail', detail: `창을 찾지 못했습니다 (40초)${fresh.length ? ` · 새 창 제목: ${fresh.map(f => `"${f.title}"`).join(', ')}` : ''}` };
      }
      const openMs = Date.now() - t0;
      created.push({ wid: w.wid, label: A.label });
      const r = await raiseCheck(w.wid);
      const area = ctx.student ? M.workArea(ctx.student) : M.workArea(ctx.primary, SIDEBAR_WIDTH);
      const [half] = M.tileRects(area, 'half');
      const m = await moveCheck(w.wid, half);
      const ok = r.ok && m.ok;
      return { status: ok ? 'pass' : 'fail',
        detail: `연결 ${openMs}ms · 제목 "${w.title}"${stem ? '' : ' (빈 문서로 시험)'} · 앞으로 ${r.ok ? '성공' : '실패'} ${r.ms}ms · 옮기기 ${m.ok ? '맞음' : `어긋남 ${fmtRect(m.actual)} (요청 ${fmtRect(half)})`}`,
        data: { title: w.title, raise: r, move: m } };
    });
  }

  await step('P5', '지금 맨 앞 창 감지', async () => {
    const last = created[created.length - 1];
    if (!last) return { status: 'skip', detail: '연 창이 없습니다' };
    await raiseCheck(last.wid);
    const f = helper('front').front;
    return { status: f.wid === last.wid ? 'pass' : 'fail', detail: `맨 앞: ${f.app} "${f.title ?? ''}"` };
  });

  if (!KEEP){
    await step('P6', '연 창 닫기 (정상 종료 요청)', async () => {
      if (!created.length) return { status: 'skip', detail: '닫을 창이 없습니다' };
      const res = [];
      for (const c of [...created].reverse()){
        try { helper('close', String(c.wid)); res.push({ ...c, sent: true }); }
        catch (e) { res.push({ ...c, sent: false, error: e.message }); }
      }
      await sleep(1500);
      const alive = new Set(list().map(w => w.wid));
      const left = res.filter(c => alive.has(c.wid));
      return { status: left.length ? 'warn' : 'pass',
        detail: left.length ? `남은 창: ${left.map(c => c.label).join(', ')} (저장 여부를 묻는 창일 수 있음)` : `${res.length}개 모두 닫힘`, data: res };
    });
  }
  return finish();
}

function pickHwpSample(){
  const files = existsSync(SAMPLES) ? readdirSync(SAMPLES) : [];
  return files.find(f => /\.(hwp|hwpx)$/i.test(f)) ?? null;   // 없으면 빈 문서로 시험
}

function finish(){
  mkdirSync(OUT, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(OUT, `report-${process.platform}-${stamp}.json`);
  const env = { platform: process.platform, release: os.release(), node: process.version, displays: ctx.displays ?? null };
  writeFileSync(file, JSON.stringify({ env, results }, null, 2));
  const count = s => results.filter(r => r.status === s).length;
  console.log(`\n통과 ${count('pass')} · 주의 ${count('warn')} · 실패 ${count('fail')} · 건너뜀 ${count('skip')}`);
  console.log(`결과 파일: ${path.relative(process.cwd(), file)}`);
  console.log('\n| 항목 | 결과 | 내용 |\n|---|---|---|');
  for (const r of results){
    const mark = { pass: '통과', fail: '**실패**', skip: '건너뜀', warn: '주의' }[r.status];
    console.log(`| ${r.id} ${r.name} | ${mark} | ${String(r.detail).replace(/\|/g, '/')} |`);
  }
}

main().catch(e => { console.error(e); process.exitCode = 1; });
