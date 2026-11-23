// 수업 준비 창. 상태는 메인 프로세스가 보내 주고, 화면은 그리기와 요청만 한다.
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = window.prep;

const BADGE = {
  web: ['웹', '--t-slate'], youtube: ['YT', '--t-red'], gdoc: ['문서', '--t-blue'], gsheet: ['시트', '--t-green'], gslides: ['슬라', '--t-orange'],
  gdrive: ['드라', '--t-teal'], canva: ['캔바', '--t-violet'], pdf: ['PDF', '--t-rose'], img: ['사진', '--t-cyan'],
  pptx: ['PPT', '--t-orange'], xlsx: ['XLS', '--t-green2'], hwp: ['한글', '--t-blue2'], audio: ['음악', '--t-pink'], video: ['영상', '--t-purple'],
  memo: ['메모', '--t-slate2'], folder: ['폴더', '--t-stone'], file: ['파일', '--t-stone'],
};
const NAME = { web: '웹사이트', youtube: '유튜브', gdoc: '구글 문서', gsheet: '구글 시트', gslides: '구글 슬라이드', gdrive: '구글 드라이브', canva: '캔바' };
const START_HINT = { youtube: '0:45', video: '1:20', pdf: '3쪽', pptx: '3번 슬라이드' };

let S = null;
let addSec = null;
let msgTimer = 0, lastMsg = '';

function render(){
  if (!S) return;
  if (S.platform === 'win32') $('#reveal').textContent = '탐색기에서 보기';
  renderLibrary();
  const d = S.doc;
  $('#empty').hidden = !!d;
  $('#editor').hidden = !d;
  if (d) renderDoc(d);
  if (S.msg && S.msg !== lastMsg){ lastMsg = S.msg; toast(S.msg); }
}

function renderLibrary(){
  const L = S.library;
  // 처음에는 짧은 위치 (전체 경로에는 사용자 이름·이메일이 들어 있음) · 누르면 전체 경로
  $('#lib-path').textContent = L.root ? (S.fullPath ? L.root : L.where) : '아직 정하지 않았습니다';
  $('#lib-path').disabled = !L.root;
  $('#lib-setup').hidden = !!L.root;
  $('#new-btn').disabled = !L.root;
  if (!L.root){
    $('#lib-setup').innerHTML = `<p><b>수업 보관함 위치를 정해 주세요.</b> 수업 폴더들이 이곳에 모입니다. 구글 드라이브 안에 두면 윈도우·맥에서 함께 쓸 수 있습니다.</p>` +
      L.suggestions.map((s, i) => `<button class="btn" data-sug="${i}" type="button">${esc(s.label)}<small>${esc(s.where)}</small></button>`).join('') +
      `<button class="btn" data-sug="pick" type="button">다른 위치 고르기</button>`;
  }
  const cur = S.doc?.root;
  const q = $('#lib-search').value.normalize('NFC').toLowerCase().split(/\s+/).filter(Boolean);
  const shown = L.lessons.filter(l => q.every(w => (l.search ?? l.title.toLowerCase()).includes(w)));
  $('#lib-search').hidden = !L.root || L.lessons.length < 2;
  $('#lib-list').innerHTML = L.root && !L.lessons.length ? '<li class="lib-empty">아직 수업이 없습니다. "새 수업"을 눌러 만드세요.</li>'
    : L.root && !shown.length ? '<li class="lib-empty">찾는 수업이 없습니다</li>'
    : shown.map(l => `<li class="${l.folder === cur ? 'cur' : ''}" data-folder="${esc(l.folder)}" tabindex="0" role="button">` +
      `<span class="lt">${esc(l.title)}</span><span class="ld">${esc(l.date || '날짜 없음')} · 자료 ${l.count}개</span>` +
      (l.folder === S.running ? '<span class="tag run">사이드바에서 진행 중</span>' : '') +
      (l.lockedBy ? `<span class="tag lock">${esc(l.lockedBy)}에서 열림</span>` : '') +
      (l.conflicts ? `<span class="tag lock">충돌 사본 ${l.conflicts}개</span>` : '') + '</li>').join('');
  $('#lib-hidden').hidden = !L.root || !L.hidden;
  $('#lib-hidden').textContent = `목록에서 뺀 수업 ${L.hidden}개 · 폴더는 그대로 있고, "다른 폴더 열기"로 열면 다시 나옵니다`;
}

function renderDoc(d){
  const active = document.activeElement;
  const keep = active && active.id ? active.id : null;
  if (keep !== 'title') $('#title').value = d.title;
  if (keep !== 'date') $('#date').value = d.date;
  if (keep !== 'review') $('#review').value = d.review ?? '';
  const total = d.sections.reduce((a, s) => a + (s.minutes || 0), 0);
  const count = d.sections.reduce((a, s) => a + s.items.length, 0);
  const saved = d.updatedAt ? new Date(d.updatedAt).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' }) : '';
  // 이 PC에서 저장했으면 PC 이름 대신 "이 PC" (PC 이름에 선생님 이름이 들어 있는 경우가 많다)
  const by = d.device && d.device !== S.device ? ` (${d.device})` : d.device ? ' (이 PC)' : '';
  $('#summary').textContent = [`자료 ${count}개`, `총 ${total}분`, saved && `마지막 저장 ${saved}${by}`].filter(Boolean).join(' · ');
  $('#doc-path').textContent = S.fullPath ? d.root : `${d.where} (눌러서 전체 경로)`;
  $('#run').textContent = S.running === d.root ? '사이드바에서 진행 중' : '사이드바로 수업 진행';
  // 충돌 사본: 두 PC에서 동시에 고쳐 드라이브가 만든 사본 → 고르게 한다
  const cs = S.conflicts ?? [];
  $('#conflictbar').hidden = !cs.length;
  if (cs.length){
    const when = t => t ? new Date(t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '시각 모름';
    $('#conflictbar').innerHTML = `<b>다른 PC와 동시에 고쳐 사본이 생겼습니다.</b> 쓸 것을 고르세요 (나머지는 .sidebar/backup에 남습니다)` +
      `<div class="cf">${cs.map(c => `<div class="cf-i"><b>${c.file === 'lesson.json' ? '지금 내용' : esc(c.file)}</b><span>${esc(c.title)} · 자료 ${c.items ?? '?'}개 · ${esc(c.device ?? '어느 PC인지 모름')} · ${when(c.updatedAt)}</span>` +
      `<button class="btn sm" type="button" data-pick="${esc(c.file)}">이것 쓰기</button></div>`).join('')}</div>`;
  }
  $('#lockbar').hidden = !d.lockedBy;
  if (d.lockedBy) $('#lockbar').innerHTML = `<b>${esc(d.lockedBy)}</b>에서도 이 수업을 열고 있습니다. 동시에 고치면 내용이 부딪힐 수 있으니 한쪽에서만 고쳐 주세요.`;

  renderChecks(S.check);

  if (!d.sections.some(s => s.id === addSec)) addSec = d.sections[1]?.id ?? d.sections[0]?.id ?? null;
  $('#add-sec').innerHTML = d.sections.map(s => `<option value="${esc(s.id)}"${s.id === addSec ? ' selected' : ''}>${esc(s.title)}</option>`).join('');

  // 입력 중인 칸이 있으면 목록을 다시 그리지 않는다 (글자가 사라지지 않게)
  if (active && $('#flow').contains(active) && active.tagName === 'INPUT') return;
  const open = new Set(S.openIds);
  $('#flow').innerHTML = d.sections.map(s => `<div class="sec" data-sec="${esc(s.id)}">
    <div class="sec-h"><input class="st" data-f="sec-title" value="${esc(s.title)}" maxlength="40" aria-label="구간 이름">
      <label class="mins"><input type="number" min="0" max="600" data-f="sec-min" value="${s.minutes || 0}" aria-label="${esc(s.title)} 시간">분</label>
      <span class="cnt">${s.items.length}개</span>
      ${s.items.length ? '' : '<button class="x" data-do="del-sec" title="구간 지우기" aria-label="구간 지우기" type="button">✕</button>'}</div>
    ${s.items.map(it => row(it, open.has(it.id))).join('') || '<div class="empty-sec">자료를 여기로 끌어다 놓으세요</div>'}</div>`).join('');
}

const CK = { ok: '정상', warn: '주의', bad: '문제' };
function renderChecks(c){
  $('#checks').hidden = !c;
  if (!c) return;
  const t = new Date(c.at).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
  $('#ck-sum').textContent = `${c.summary} · ${t}`;
  // 문제 → 주의 → 정상 순서로 (같은 단계 안에서는 수업 순서)
  const order = { bad: 0, warn: 1, ok: 2 };
  const rows = c.rows.map((r, i) => ({ ...r, i })).sort((a, b) => order[a.level] - order[b.level] || a.i - b.i);
  $('#ck-list').innerHTML = rows.map(r => `<li class="ck ${r.level}"><span class="st">${CK[r.level]}</span><span class="ck-t"><b>${esc(r.title)}</b><span>${esc(r.detail)}</span></span></li>`).join('');
}

function row(it, isOpen){
  const [b, c] = BADGE[it.type] ?? BADGE.file;
  const src = it.problem ? `<span class="src warn">${esc(it.problem)}</span>` : `<span class="src">${esc(it.url ?? it.file ?? '')}</span>`;
  const hint = START_HINT[it.type];
  return `<div class="it" data-id="${esc(it.id)}">
    <span class="grip" draggable="true" title="끌어서 순서 바꾸기">⋮⋮</span>
    <span class="badge" style="--c:var(${c})">${b}</span>
    <div class="it-t"><input data-f="title" value="${esc(it.title)}" maxlength="80" aria-label="자료 이름">${src}</div>
    <input class="start" data-f="start" value="${esc(it.start)}" placeholder="${hint ? '시작: ' + hint : '시작 위치 없음'}"${hint ? '' : ' disabled'} aria-label="시작 위치">
    <select class="scr" data-f="screen" aria-label="띄울 화면">
      <option value=""${!it.screen ? ' selected' : ''}>자동 (${it.type === 'memo' ? '교사' : '학생'} 화면)</option>
      <option value="student"${it.screen === 'student' ? ' selected' : ''}>학생 화면</option>
      <option value="teacher"${it.screen === 'teacher' ? ' selected' : ''}>교사 화면</option></select>
    <span class="extra">${it.type === 'memo' ? '<button class="btn sm" data-do="edit-memo" type="button">편집</button>' : ''}${it.type === 'web' ? '<button class="btn sm" data-do="snapshot" type="button" title="이 페이지를 PDF로 찍어 바로 아래에 넣습니다 (인터넷이 끊겼을 때 대비)">PDF 저장본</button>' : ''}${isOpen ? ' <small title="사이드바에서 열려 있음">열림</small>' : ''}</span>
    <button class="x" data-do="del" title="흐름에서 빼기 (파일은 휴지통 폴더로)" aria-label="${esc(it.title)} 빼기" type="button">✕</button></div>`;
}

function toast(m){
  const el = $('#msg'); el.textContent = m; el.classList.add('on');
  clearTimeout(msgTimer); msgTimer = setTimeout(() => el.classList.remove('on'), 4200);
}

// ---------- 보관함 ----------
$('#lib-setup').addEventListener('click', e => {
  const b = e.target.closest('[data-sug]'); if (!b) return;
  if (b.dataset.sug === 'pick') return api.act('chooseLibrary');
  api.act('setLibrary', { path: S.library.suggestions[Number(b.dataset.sug)].path });
});
$('#lib-change').addEventListener('click', () => api.act('chooseLibrary'));
for (const b of ['#lib-path', '#doc-path']) $(b).addEventListener('click', () => api.act('togglePath'));
$('#lib-list').addEventListener('click', e => { const li = e.target.closest('[data-folder]'); if (li) api.act('openLesson', { folder: li.dataset.folder }); });
$('#lib-list').addEventListener('keydown', e => { const li = e.target.closest('[data-folder]'); if (li && (e.key === 'Enter' || e.key === ' ')){ e.preventDefault(); api.act('openLesson', { folder: li.dataset.folder }); } });
$('#new-btn').addEventListener('click', () => {
  $('#new-form').hidden = false;
  $('#new-date').value = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  $('#new-title').focus();
});
$('#new-cancel').addEventListener('click', () => { $('#new-form').hidden = true; });
$('#new-form').addEventListener('submit', e => {
  e.preventDefault();
  api.act('newLesson', { title: $('#new-title').value, date: $('#new-date').value });
  $('#new-form').hidden = true; $('#new-title').value = '';
});
$('#open-other').addEventListener('click', () => api.act('openOther'));

// ---------- 글자 칸 저장 ----------
// 수업 이름·날짜·구간·자료 칸은 따로 저장 버튼이 없다. 이렇게 저장한다:
//   ① 치다가 잠깐(1.2초) 멈추면  ② Enter·다른 곳 누르기(change)  ③ 다른 창으로 갈 때  ④ 창을 닫을 때(동기로 확실히)
const IDLE_MS = 1200;
let dirty = null, idleTimer = 0, sent = { el: null, value: null };

function editOf(el){
  if (!(el instanceof HTMLElement)) return null;
  if (el.id === 'title') return ['info', { title: el.value }];
  if (el.id === 'date') return ['info', { date: el.value }];
  if (el.id === 'review') return ['info', { review: el.value }];
  const f = el.dataset.f; if (!f || !$('#flow').contains(el)) return null;
  const sec = el.closest('[data-sec]')?.dataset.sec, id = el.closest('[data-id]')?.dataset.id;
  switch (f){
    case 'sec-title': return ['updateSection', { id: sec, title: el.value }];
    case 'sec-min': return ['updateSection', { id: sec, minutes: Number(el.value) }];
    case 'title': return ['updateItem', { id, title: el.value }];
    case 'start': return ['updateItem', { id, start: el.value }];
    case 'screen': return ['updateItem', { id, screen: el.value || null }];
  }
  return null;
}
function commit(el, sync = false){
  if (el === dirty){ dirty = null; clearTimeout(idleTimer); }
  if (sent.el === el && sent.value === el.value) return;   // 방금 보낸 그대로면 또 저장하지 않는다
  const e = editOf(el); if (!e) return;
  sent = { el, value: el.value };
  if (sync) api.actSync(...e); else api.act(...e);
}
const flushTyping = sync => { if (dirty) commit(dirty, sync); };
document.addEventListener('input', e => {
  if (!editOf(e.target)) return;
  if (sent.el === e.target) sent = { el: null, value: null };
  dirty = e.target;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => flushTyping(false), IDLE_MS);
});
document.addEventListener('change', e => commit(e.target));
window.addEventListener('blur', () => flushTyping(false));
window.addEventListener('beforeunload', () => flushTyping(true));

// ---------- 수업 정보 ----------
$('#run').addEventListener('click', () => api.act('run'));
$('#tidy').addEventListener('click', () => api.act('tidy'));
$('#reveal').addEventListener('click', () => api.act('reveal'));
$('#export').addEventListener('click', () => api.act('exportBundle'));
$('#guide').addEventListener('click', () => api.act('guide'));
$('#del-lesson').addEventListener('click', () => api.act('removeLesson'));
$('#dup').addEventListener('click', () => {
  $('#dup-form').hidden = false;
  $('#dup-title').value = `${S.doc?.title ?? '수업'} (2차)`;
  $('#dup-date').value = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  $('#dup-title').focus(); $('#dup-title').select();
});
$('#dup-cancel').addEventListener('click', () => { $('#dup-form').hidden = true; });
$('#dup-form').addEventListener('submit', e => { e.preventDefault(); api.act('duplicate', { title: $('#dup-title').value, date: $('#dup-date').value }); $('#dup-form').hidden = true; });
$('#lib-search').addEventListener('input', () => renderLibrary());
$('#conflictbar').addEventListener('click', e => { const b = e.target.closest('[data-pick]'); if (b) api.act('resolveConflict', { file: b.dataset.pick }); });
$('#check').addEventListener('click', () => api.act('precheck'));
$('#ck-again').addEventListener('click', () => api.act('precheck'));
$('#ck-close').addEventListener('click', () => api.act('closeCheck'));
$('#import').addEventListener('click', () => api.act('importBundle'));

// ---------- 자료 넣기 ----------
$('#add-sec').addEventListener('change', e => { addSec = e.target.value; });
function detect(v){
  const s = v.trim(); if (!s) return null;
  if (/\s/.test(s) || !/^(https?:\/\/)?[^/\s]+\.[^/\s]+/i.test(s)) return { err: '링크 주소 형식이 아닙니다 · 예: https://www.youtube.com/watch?v=…' };
  const h = s.replace(/^https?:\/\//i, '').replace(/^(www\.|m\.)/, '');
  const type = /^(youtube\.com|youtu\.be)/.test(h) ? 'youtube' : /^docs\.google\.com\/spreadsheets/.test(h) ? 'gsheet'
    : /^docs\.google\.com\/presentation/.test(h) ? 'gslides' : /^docs\.google\.com\/document/.test(h) ? 'gdoc'
    : /^drive\.google\.com/.test(h) ? 'gdrive' : /^([a-z0-9-]+\.)?canva\.com/.test(h) ? 'canva' : 'web';
  return { type };
}
$('#url').addEventListener('input', e => {
  const d = detect(e.target.value), box = $('#detect');
  if (!d){ box.className = 'detect'; box.textContent = '파일은 이 창 아무 곳에나 끌어다 놓으면 들어갑니다 (수업 폴더로 복사, 원본은 그대로)'; return; }
  if (d.err){ box.className = 'detect err'; box.textContent = d.err; return; }
  const [b, c] = BADGE[d.type];
  box.className = 'detect ok';
  box.innerHTML = `<span class="badge" style="--c:var(${c})">${b}</span>종류: ${NAME[d.type]} · 브라우저 새 창으로 엽니다`;
});
function addLink(){
  const v = $('#url').value.trim(); if (!v) return toast('넣을 링크를 붙여 넣어 주세요');
  api.act('addLink', { url: v, sec: addSec });
  $('#url').value = ''; $('#url').dispatchEvent(new Event('input'));
}
$('#add-link').addEventListener('click', addLink);
$('#url').addEventListener('keydown', e => { if (e.key === 'Enter'){ e.preventDefault(); addLink(); } });
$('#pick').addEventListener('click', () => api.act('pickFiles', { sec: addSec }));
$('#memo').addEventListener('click', () => api.act('addMemo', { sec: addSec }));
$('#add-sec-btn').addEventListener('click', () => api.act('addSection'));

// ---------- 흐름 고치기 ----------
const flow = $('#flow');
flow.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.target.blur(); });
flow.addEventListener('click', e => {
  const b = e.target.closest('[data-do]'); if (!b) return;
  const itEl = b.closest('[data-id]'), secEl = b.closest('[data-sec]');
  if (b.dataset.do === 'del') api.act('removeItem', { id: itEl.dataset.id });
  else if (b.dataset.do === 'del-sec') api.act('removeSection', { id: secEl.dataset.sec });
  else if (b.dataset.do === 'edit-memo') api.act('editMemo', { id: itEl.dataset.id });
  else if (b.dataset.do === 'snapshot') api.act('snapshot', { id: itEl.dataset.id });
});

// 순서 바꾸기 (⋮⋮ 끌기)
let dragId = null;
const clearMarks = () => document.querySelectorAll('.before,.after,.drop-in').forEach(el => el.classList.remove('before', 'after', 'drop-in'));
flow.addEventListener('dragstart', e => {
  const g = e.target.closest('.grip'); if (!g) return;
  const r = g.closest('.it'); dragId = r.dataset.id;
  e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId);
  try { e.dataTransfer.setDragImage(r, 20, 18); } catch { /* 무시 */ }
  r.classList.add('dragging');
});
flow.addEventListener('dragend', () => { dragId = null; clearMarks(); document.querySelectorAll('.dragging').forEach(r => r.classList.remove('dragging')); });

// 파일 끌어다 놓기 (창 어디든) + 순서 바꾸기 놓기
const hasFiles = e => Array.from(e.dataTransfer?.types ?? []).includes('Files');
const secAt = e => e.target.closest?.('[data-sec]')?.dataset.sec ?? addSec;
const secTitle = id => S.doc?.sections.find(s => s.id === id)?.title ?? '';
document.addEventListener('dragover', e => {
  if (!S?.doc) return;
  if (hasFiles(e)){
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
    $('#dropmask').hidden = false; $('#drop-sec').textContent = `'${secTitle(secAt(e))}'`;
    clearMarks(); e.target.closest?.('.sec')?.classList.add('drop-in');
    return;
  }
  if (!dragId) return;
  const sec = e.target.closest?.('.sec'); if (!sec) return;
  e.preventDefault(); e.dataTransfer.dropEffect = 'move';
  clearMarks();
  const r = e.target.closest('.it');
  if (r && r.dataset.id !== dragId){ const b = r.getBoundingClientRect(); r.classList.add(e.clientY < b.top + b.height / 2 ? 'before' : 'after'); }
  else if (!r) sec.classList.add('drop-in');
});
document.addEventListener('dragleave', e => { if (!e.relatedTarget){ $('#dropmask').hidden = true; clearMarks(); } });
document.addEventListener('drop', e => {
  e.preventDefault();
  $('#dropmask').hidden = true;
  if (!S?.doc) return;
  if (hasFiles(e)){
    clearMarks();
    const paths = api.pathsOf(e.dataTransfer.files);
    if (paths.length) api.act('addFiles', { paths, sec: secAt(e) });
    return;
  }
  if (!dragId) return;
  const sec = e.target.closest?.('.sec'); if (!sec){ clearMarks(); return; }
  const r = e.target.closest('.it');
  let before = null;
  if (r && r.dataset.id !== dragId){
    const b = r.getBoundingClientRect();
    if (e.clientY < b.top + b.height / 2) before = r.dataset.id;
    else before = r.nextElementSibling?.dataset?.id ?? null;
  }
  const id = dragId; dragId = null; clearMarks();
  if (r && r.dataset.id === id) return;
  api.act('moveItem', { id, sec: sec.dataset.sec, before });
});

api.onState(s => { S = s; render(); });
api.state().then(s => { S = s; render(); });
