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

function render(){
  if (!S) return;
  $('#strip').hidden = !S.collapsed;
  $('#panel').hidden = !!S.collapsed;
  document.body.classList.toggle('collapsed', !!S.collapsed);
  const L = S.lesson;
  $('#title').textContent = L ? L.title : '수업 폴더를 열어 주세요';
  const openN = Object.values(S.state).filter(s => s.status === 'open' || s.status === 'blocked').length;
  $('#meta').textContent = L ? `${L.date ? L.date + ' · ' : ''}${L.sections.reduce((a, s) => a + (s.minutes || 0), 0)}분 · 열린 창 ${openN}개` : '';
  $('#btn-hide').setAttribute('aria-pressed', String(!!S.autoHide));

  $('#screens').innerHTML = S.dual
    ? `<div class="scr-line"><i class="scr-dot"></i>학생 화면: ${esc(S.studentName)}</div>
       <div class="seg" role="group" aria-label="새로 여는 자료를 띄울 곳"><span>여는 곳</span>
         <button data-to="student" aria-pressed="${S.openTo === 'student'}">학생 화면</button>
         <button data-to="teacher" aria-pressed="${S.openTo === 'teacher'}">교사 화면에서 먼저</button></div>`
    : `<div class="scr-line"><i class="scr-dot off"></i>모니터 1개 · 학생도 이 화면을 봅니다</div>`;

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
    dock.innerHTML = `<div class="dock-h"><b>나란히 보는 중</b></div><button class="dbtn" data-dock="untile">나란히 보기 풀기</button>`;
  } else if (S.sel.length){
    dock.hidden = false;
    dock.innerHTML = `<div class="dock-h"><b>${S.sel.length}개 선택</b><button class="link" data-dock="clear">선택 해제</button></div>` +
      (S.sel.length === 2 ? `<button class="dbtn" data-dock="split">${S.dual ? '학생 화면에 ' : ''}반반으로 나란히</button>` : '<p>하나 더 고르면 반반으로 나란히 놓습니다</p>');
  } else dock.hidden = true;

  $('#msg').textContent = S.msg || '';
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
$('#screens').addEventListener('click', e => { const b = e.target.closest('[data-to]'); if (b) api.act('openTo', b.dataset.to); });
$('#dock').addEventListener('click', e => {
  const d = e.target.closest('[data-dock]')?.dataset.dock;
  if (d === 'split') api.act('split');
  else if (d === 'untile') api.act('untile');
  else if (d === 'clear') S.sel.forEach(id => api.act('toggleSel', id));
});
$('#next').addEventListener('click', () => api.act('next'));
$('#btn-hide').addEventListener('click', () => api.act('autoHide', !S.autoHide));
$('#openall').addEventListener('click', () => api.act('openAll'));
$('#hideothers').addEventListener('click', () => api.act('hideOthers'));
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
    msg: "'발표 자료'를 학생 화면에 열었습니다 · 0.8초" };
  return { state: async () => s, act: async () => true, onState: () => () => {} };
}
