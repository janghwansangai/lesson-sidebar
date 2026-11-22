// 사이드바 화면. 상태는 메인 프로세스가 보내 주고, 화면은 그리기와 누르기만 한다.
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const BADGE = {
  web: ['웹', '--t-slate'], youtube: ['YT', '--t-red'], gdoc: ['문서', '--t-blue'], gsheet: ['시트', '--t-green'], gslides: ['슬라', '--t-orange'],
  gdrive: ['드라', '--t-teal'], canva: ['캔바', '--t-violet'], pdf: ['PDF', '--t-rose'], img: ['사진', '--t-cyan'],
  pptx: ['PPT', '--t-orange'], ppt: ['PPT', '--t-orange'], xlsx: ['XLS', '--t-green2'], xls: ['XLS', '--t-green2'],
  hwp: ['한글', '--t-blue2'], hwpx: ['한글', '--t-blue2'], audio: ['음악', '--t-pink'], video: ['영상', '--t-purple'],
  memo: ['메모', '--t-slate2'], folder: ['폴더', '--t-stone'], file: ['파일', '--t-stone'],
};

const api = window.sidebar ?? demoApi();
let S = null;
let prefsOpen = false;

function renderPrefs(){
  const P = S.prefs ?? { opacity: 100, steps: [100, 90, 80, 70], aside: false, asideAvailable: false };
  // 펼친 사이드바 배경 투명도 (CSSOM으로 바꾸므로 보안 정책(CSP)에 걸리지 않음)
  document.documentElement.style.setProperty('--sb-alpha', String(P.opacity / 100));
  $('#btn-prefs').setAttribute('aria-pressed', String(prefsOpen));
  $('#btn-prefs').setAttribute('aria-expanded', String(prefsOpen));
  $('#prefs').hidden = !prefsOpen;
  $('#opacity').innerHTML = P.steps.map(v => `<button data-op="${v}" aria-pressed="${P.opacity === v}">${v === 100 ? '불투명' : v + '%'}</button>`).join('');
  $('#aside-row').hidden = !P.asideAvailable;
  $('#aside').checked = !!P.aside;
  $('#trustbar').hidden = S.trusted !== false;
}

function render(){
  if (!S) return;
  $('#strip').hidden = !S.collapsed;
  $('#panel').hidden = !!S.collapsed;
  document.body.classList.toggle('collapsed', !!S.collapsed);
  renderPrefs();
  const L = S.lesson;
  $('#title').textContent = L ? L.title : '수업 폴더를 열어 주세요';
  const openN = Object.values(S.state).filter(s => s.status === 'open' || s.status === 'blocked').length;
  $('#meta').textContent = L ? `${L.date ? L.date + ' · ' : ''}${L.sections.reduce((a, s) => a + (s.minutes || 0), 0)}분 · 열린 창 ${openN}개` : '';
  $('#btn-hide').setAttribute('aria-pressed', String(!!S.autoHide));
  $('#tool-pointer').setAttribute('aria-pressed', String(!!S.tools?.pointer));
  $('#tool-spot').setAttribute('aria-pressed', String(!!S.tools?.spot));
  $('#tool-zoom').setAttribute('aria-pressed', String(S.tools?.grab === 'zoom'));
  $('#tool-pin').setAttribute('aria-pressed', String(S.tools?.grab === 'pick'));
  $('#pins-close').hidden = !S.tools?.pins;

  $('#screens').innerHTML = S.dual
    ? `<div class="scr-line"><i class="scr-dot"></i>학생 화면: ${esc(S.studentName)}</div>
       <div class="seg" role="group" aria-label="새로 여는 자료를 띄울 곳"><span>여는 곳</span>
         <button data-to="student" aria-pressed="${S.openTo === 'student'}">학생 화면</button>
         <button data-to="teacher" aria-pressed="${S.openTo === 'teacher'}">교사 화면에서 먼저</button></div>
       <div class="stu" role="group" aria-label="학생 화면">
         <button class="stu-b" data-cover="freeze" aria-pressed="${S.cover === 'freeze'}" title="학생 화면을 지금 장면으로 멈춥니다 (그동안 창을 정리해도 학생에게 안 보임)">정지</button>
         <button class="stu-b" data-cover="blank" aria-pressed="${S.cover === 'blank'}" title="학생 화면을 '잠시 후 계속합니다'로 가립니다">가리기</button>
         <button class="stu-b" data-preview="${!S.preview}" aria-pressed="${!!S.preview}" title="학생 화면을 작게 미리 봅니다">미리보기</button></div>`
    : `<div class="scr-line"><i class="scr-dot off"></i>모니터 1개 · 학생도 이 화면을 봅니다</div>
       <div class="stu"><button class="stu-b" data-cover="blank" aria-pressed="${S.cover === 'blank'}" title="화면을 '잠시 후 계속합니다'로 가립니다 (사이드바는 보임)">화면 가리기</button></div>`;
  $('#preview').hidden = !(S.dual && S.preview);
  $('#preview-tag').textContent = S.cover === 'freeze' ? '정지 중 · 학생에게는 멈춘 장면' : S.cover === 'blank' ? '가리는 중 · 학생에게는 검은 화면' : '학생 화면';

  const flat = L ? L.sections.flatMap(s => s.items) : [];
  const i = flat.findIndex(it => it.id === S.highlight);
  const nx = flat[i + 1];
  $('#next').innerHTML = nx ? `<span class="nx-k">다음</span><span class="nx-t">${esc(nx.title)}</span><span aria-hidden="true">▸</span>` : '<span class="nx-k">마지막 자료까지 왔습니다</span>';
  $('#next').disabled = !nx;

  const list = $('#list'), top = list.scrollTop;
  list.classList.toggle('selecting', S.sel.length > 0);
  list.innerHTML = L ? L.sections.map(s => `<div class="sec"><span>${esc(s.title)}</span><span>${s.minutes ? s.minutes + '분' : ''}</span></div>` + s.items.map(row).join('')).join('') : '';
  list.scrollTop = top;

  const dock = $('#dock');
  if (S.tile){
    dock.hidden = false;
    const opts = (S.layouts?.[S.tile.ids.length] ?? []).map(l => `<button class="seg-b" data-lay="${l.id}" aria-pressed="${S.tile.layout === l.id}">${esc(l.label)}</button>`).join('');
    dock.innerHTML = `<div class="dock-h"><b>나란히 보는 중</b></div><p>창 사이 노란 막대를 끌면 폭이 바뀝니다</p>` +
      (opts ? `<div class="lays" data-mode="relayout">${opts}</div>` : '') +
      `<button class="dbtn" data-dock="saveLayout">이 배치 수업에 저장</button><button class="dbtn" data-dock="untile">원래대로 (나란히 보기 풀기)</button>`;
  } else if (S.sel.length){
    dock.hidden = false;
    dock.innerHTML = `<div class="dock-h"><b>${S.sel.length}개 선택</b><button class="link" data-dock="clear">선택 해제</button></div>` +
      (S.sel.length >= 2 ? `<p>${S.dual ? '학생 화면에 ' : ''}어떻게 놓을까요?</p><div class="lays" data-mode="split">${(S.layouts?.[S.sel.length] ?? []).map(l => `<button class="seg-b" data-lay="${l.id}">${esc(l.label)}</button>`).join('')}</div>`
        : '<p>하나 더 고르면 나란히 놓을 수 있습니다 (네 개까지)</p>');
  } else if (S.saved?.length){
    // 저장한 배치: 누르면 그 자료들을 그 배치·비율로 다시 놓는다
    dock.hidden = false;
    dock.innerHTML = `<div class="dock-h"><b>저장한 배치</b></div>` + S.saved.map(l =>
      `<div class="saved"><button class="dbtn" data-apply="${esc(l.id)}" title="이 배치로 다시 놓기">${esc(l.name)}</button><button class="act x" data-unsave="${esc(l.id)}" title="저장한 배치 지우기" aria-label="${esc(l.name)} 지우기">✕</button></div>`).join('');
  } else dock.hidden = true;

  $('#msg').textContent = S.msg || '';
  // 안내 옆 단추 (예: 메모장에서 이 탭만 닫기)
  $('#offer').hidden = !S.offer;
  $('#offer').textContent = S.offer?.label ?? '';
}

function row(it){
  const st = S.state[it.id] ?? { status: 'closed' };
  const open = st.status === 'open' || st.status === 'blocked';
  const front = S.highlight === it.id && open;
  const sel = S.sel.includes(it.id);
  const [b, c] = BADGE[it.type] ?? BADGE.file;
  const where = S.dual ? ' · ' + (open ? (st.disp === 'student' ? '학생 화면' : '교사 화면') : (S.openTo === 'teacher' ? '교사 화면' : (it.home === 'teacher' ? '교사 화면' : '학생 화면'))) : '';
  const sub = it.problem ? it.problem
    : st.status === 'opening' ? `${it.app} 여는 중…`
    : st.status === 'blocked' ? '답을 기다리는 창이 있습니다'
    : st.note && !open ? st.note
    : `${it.app}${it.start ? ' · ' + it.start + '부터' : ''}${where}`;
  const state = st.status === 'opening' ? '<i class="spin" aria-label="여는 중"></i>'
    : st.status === 'blocked' ? '<span class="chip wait">답 기다림</span>'
    : front ? '<span class="chip now">보는 중</span>'
    : open ? '<i class="dot" title="열림"></i>' : '';
  const acts = open ? (S.dual ? `<button class="act" data-act="move" title="${st.disp === 'student' ? '교사' : '학생'} 화면으로 보내기" aria-label="${esc(it.title)} 다른 화면으로 보내기">⇄</button>` : '') +
    `<button class="act x" data-act="close" title="창 닫기" aria-label="${esc(it.title)} 창 닫기">✕</button>` : '';
  return `<div class="it${open ? ' open' : ''}${front ? ' front' : ''}${sel ? ' sel' : ''}${it.problem ? ' bad' : ''}${open && S.dual && st.disp === 'teacher' ? ' on-t' : ''}" data-id="${esc(it.id)}" role="button" tabindex="0">` +
    `<button class="check" data-act="sel" aria-label="${esc(it.title)} 선택" aria-pressed="${sel}">${sel ? '✓' : ''}</button>` +
    `<span class="badge" style="--c:var(${c})">${b}</span>` +
    `<span class="it-text"><span class="it-title">${esc(it.title)}</span><span class="it-sub${it.problem || st.status === 'blocked' || (st.note && !open) ? ' warn' : ''}">${esc(sub)}</span></span>` +
    `<span class="state">${state}</span>${acts}</div>`;
}

// ---------- 누르기 ----------
$('#list').addEventListener('click', e => {
  const r = e.target.closest('.it'); if (!r) return;
  const id = r.dataset.id;
  const a = e.target.closest('[data-act]')?.dataset.act;
  if (a === 'sel' || (!a && (e.metaKey || e.ctrlKey || e.shiftKey))) return api.act('toggleSel', id);
  if (a === 'move') return api.act('move', id);
  if (a === 'close') return api.act('close', id);
  if (!r.classList.contains('bad')) api.act('activate', id);
});
$('#list').addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('it')){ e.preventDefault(); api.act('activate', e.target.dataset.id); }
});
$('#screens').addEventListener('click', e => {
  const b = e.target.closest('[data-to]'); if (b) return api.act('openTo', b.dataset.to);
  const c = e.target.closest('[data-cover]'); if (c) return api.act(c.dataset.cover);
  const p = e.target.closest('[data-preview]'); if (p) return api.act('preview', p.dataset.preview);
});
api.onPreview?.(src => { if (src) $('#preview-img').src = src; });
$('#dock').addEventListener('click', e => {
  const ap = e.target.closest('[data-apply]'); if (ap) return api.act('applyLayout', ap.dataset.apply);
  const un = e.target.closest('[data-unsave]'); if (un) return api.act('removeLayout', un.dataset.unsave);
  const lay = e.target.closest('[data-lay]');
  if (lay) return api.act(lay.closest('[data-mode]').dataset.mode, lay.dataset.lay);
  const d = e.target.closest('[data-dock]')?.dataset.dock;
  if (d === 'split') api.act('split');
  else if (d === 'saveLayout') api.act('saveLayout');
  else if (d === 'untile') api.act('untile');
  else if (d === 'clear') S.sel.forEach(id => api.act('toggleSel', id));
});
$('#next').addEventListener('click', () => api.act('next'));
$('#btn-hide').addEventListener('click', () => api.act('autoHide', !S.autoHide));
$('#btn-prefs').addEventListener('click', () => { prefsOpen = !prefsOpen; render(); });
$('#opacity').addEventListener('click', e => { const b = e.target.closest('[data-op]'); if (b) api.act('opacity', b.dataset.op); });
$('#aside').addEventListener('change', e => api.act('aside', e.target.checked));
$('#offer').addEventListener('click', () => { if (S.offer) api.act(S.offer.act, S.offer.id); });
$('#openall').addEventListener('click', () => api.act('openAll'));
$('#hideothers').addEventListener('click', () => api.act('hideOthers'));
$('#tool-pointer').addEventListener('click', () => api.act('pointer', !S.tools?.pointer));
$('#tool-spot').addEventListener('click', () => api.act('spot', !S.tools?.spot));
$('#tool-zoom').addEventListener('click', () => api.act('zoom'));
$('#tool-pin').addEventListener('click', () => api.act('pin'));
$('#pins-close').addEventListener('click', () => api.act('closePins'));
$('#ax-open').addEventListener('click', () => api.act('axSettings'));
// 모두 닫기는 한 번 더 눌러야 한다 (실수로 수업 중 창을 다 닫지 않게)
let closeArm = 0;
$('#closeall').addEventListener('click', e => {
  const b = e.currentTarget;
  if (Date.now() - closeArm < 4000){ closeArm = 0; b.textContent = '사이드바가 연 창 모두 닫기'; b.classList.remove('arm'); return api.act('closeAll'); }
  closeArm = Date.now(); b.textContent = '한 번 더 누르면 모두 닫습니다'; b.classList.add('arm');
  setTimeout(() => { if (Date.now() - closeArm >= 3900){ b.textContent = '사이드바가 연 창 모두 닫기'; b.classList.remove('arm'); } }, 4000);
});
$('#folder').addEventListener('click', () => api.act('prep'));
$('#quit').addEventListener('click', () => api.act('quit'));

api.onState(s => { S = s; render(); });
api.state().then(s => { S = s; render(); });

// 브라우저로 이 파일만 열었을 때(디자인 확인용) 쓰는 예시 상태
function demoApi(){
  const lesson = { title: '체험용 수업: AI 활용 연수', date: '2026-11-28', sections: [
    { id: 's1', title: '도입', minutes: 10, items: [
      { id: 'a', title: '진행 메모', type: 'memo', app: '텍스트 편집기', home: 'teacher' },
      { id: 'b', title: '자료 A (시험 페이지)', type: 'web', app: '크롬', home: 'student' },
      { id: 'c', title: '참고 사이트', type: 'web', app: '크롬', home: 'student' } ] },
    { id: 's2', title: '전개', minutes: 30, items: [
      { id: 'd', title: '발표 자료', type: 'pptx', app: '파워포인트', home: 'student', start: '3번 슬라이드' },
      { id: 'e', title: '모둠 편성표', type: 'xlsx', app: '엑셀', home: 'student' },
      { id: 'f', title: '없는 파일 예시', type: 'pdf', app: '크롬', home: 'student', problem: '파일이 없습니다 (아직 동기화 중일 수 있습니다)' } ] } ] };
  const s = { lesson, state: { a: { status: 'open', disp: 'teacher' }, b: { status: 'open', disp: 'student' }, d: { status: 'open', disp: 'student' }, e: { status: 'blocked', disp: 'student' }, c: { status: 'opening' } },
    highlight: 'd', sel: [], tile: null, dual: true, studentName: 'MB16NCG', openTo: 'student', autoHide: false, collapsed: false,
    msg: "'진행 메모'은(는) 다른 파일과 같은 메모장 창에 탭으로 열려 있어 창을 닫지 않았습니다. 이 탭만 닫으려면 아래 단추를 누르세요",
    offer: { act: 'closeTab', id: 'a', label: '사이드바에서 이 탭만 닫기' },
    prefs: { opacity: 90, steps: [100, 90, 80, 70], aside: false, asideAvailable: true } };
  return { state: async () => s, act: async () => true, onState: () => () => {} };
}
