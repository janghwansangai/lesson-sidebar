// 발표자 화면·휴대폰 리모컨. 상태는 서버가 보내는 이벤트(events)로 받고, 단추는 act로 보낸다.
// 시계는 1초마다 이 화면이 스스로 센다 (PC와 휴대폰 시계가 달라도 맞도록 서버 시각과의 차이를 뺀다).
'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hms = ms => {
  const t = Math.max(0, Math.floor((ms ?? 0) / 1000)), h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};
const KIND = { pptx: '파워포인트', ppt: '파워포인트', xlsx: '엑셀', xls: '엑셀', hwp: '한글', hwpx: '한글', pdf: 'PDF', youtube: '유튜브', video: '영상', image: '그림', memo: '메모', layout: '배치' };

let S = null, off = 0, thumbV = null, busy = false;

function render(){
  if (!S) return;
  const v = S.live;
  $('#title').textContent = v?.title ?? '수업이 열려 있지 않습니다';
  $('#rec').hidden = !S.rec;
  $('#cur').textContent = v?.current?.title ?? '아직 띄운 자료가 없습니다';
  $('#cur-app').textContent = v?.current ? (v.current.app ?? '') : '';
  $('#nxt').textContent = v?.next?.title ?? (v ? '마지막 자료입니다' : '—');
  $('#nxt-app').textContent = v?.next ? [v.next.app, v.next.start && `시작 ${v.next.start}`].filter(Boolean).join(' · ') : '';
  $('#prev').disabled = !v?.prev;
  $('#next').disabled = !v?.next;
  $('#b-freeze').hidden = !S.dual;
  $('#b-freeze').setAttribute('aria-pressed', S.cover === 'freeze');
  $('#b-blank').setAttribute('aria-pressed', S.cover === 'blank');
  $('#b-blank').textContent = S.cover === 'blank' ? '가리기 풀기' : '가리기';
  $('#b-freeze').textContent = S.cover === 'freeze' ? '정지 풀기' : '정지';
  $('#msg').textContent = S.msg ?? '';

  // 다음 자료 미리보기 (그 창이 미리 열려 있을 때만)
  if (S.thumb !== thumbV){
    thumbV = S.thumb;
    $('#thumb').hidden = !S.thumb;
    if (S.thumb) $('#thumb').src = `thumb?v=${encodeURIComponent(S.thumb)}`;
  }

  const memos = S.memo ?? [];
  $('#memo-box').hidden = !memos.length;
  $('#memo-h').textContent = memos.length === 1 ? memos[0].title : '진행 메모';
  $('#memo').innerHTML = memos.map(m => `<div class="memo-one">${memos.length > 1 ? `<b>${esc(m.title)}</b>\n` : ''}${esc(m.text)}</div>`).join('');

  $('#list').innerHTML = (v?.sections ?? []).map(s => `
    <div class="sec">
      <div class="sec-h${v.section?.id === s.id ? ' here' : ''}"><span>${esc(s.title)}</span><span>${s.minutes ? `${s.minutes}분` : ''}</span></div>
      ${s.items.map(it => `<button class="item${it.id === v.highlight ? ' on' : ''}${it.type === 'memo' ? ' memo-i' : ''}" type="button" data-act="activate" data-arg="${esc(it.id)}">
        <span>${esc(it.title)}</span><span class="ty">${esc(it.app ?? KIND[it.type] ?? '')}</span></button>`).join('')}
    </div>`).join('');
  tick();
}

function tick(){
  const v = S?.live; if (!v) return;
  const now = Date.now() - off;
  const le = v.since.lesson != null ? now - v.since.lesson : 0;
  $('#c-lesson').textContent = hms(le);
  $('#c-plan').textContent = v.lesson.planMin ? `/ ${v.lesson.planMin}분` : '';
  const sec = v.section;
  $('#sec-box').hidden = !sec;
  if (!sec) return;
  const se = v.since.section != null ? now - v.since.section : 0;
  const over = !!sec.minutes && se > sec.minutes * 60000;
  $('#sec-k').textContent = `${sec.n}/${sec.of} ${sec.title}`;
  $('#c-sec').textContent = hms(se);
  $('#c-secplan').textContent = sec.minutes ? (over ? `${sec.minutes}분 넘음 +${hms(se - sec.minutes * 60000)}` : `/ ${sec.minutes}분`) : '';
  $('#sec-box').classList.toggle('over', over);
  const bar = $('#bar');
  bar.style.width = sec.minutes ? `${Math.min(100, se / (sec.minutes * 600))}%` : '0';
  bar.classList.toggle('over', over);
}

async function act(name, arg){
  if (busy) return;
  busy = true;
  try {
    const r = await fetch('act', { method: 'POST', body: JSON.stringify(arg === undefined ? { do: name } : { do: name, arg }) });
    if (r.status === 404) gone();
  } catch { setConn(false); }
  finally { setTimeout(() => { busy = false; }, 250); }   // 두 번 눌림 막기
}

let lostAt = 0;
function setConn(ok){
  if (ok) lostAt = 0; else if (!lostAt) lostAt = Date.now();
  // 20초 넘게 안 되면: 리모컨을 껐거나 다른 와이파이일 수 있다
  $('#conn').textContent = ok ? '' : Date.now() - lostAt > 20000 ? '연결되지 않습니다 · 같은 와이파이인지, 리모컨이 켜져 있는지 확인하고 QR을 다시 찍어 주세요' : '다시 연결하는 중…';
  $('#conn').classList.toggle('bad', !ok);
}
function gone(){ es?.close(); $('#gone').hidden = false; }

document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  act(b.dataset.act, b.dataset.arg);
});
// 발표자 화면에서는 키보드로도: → / Space 다음, ← 이전
document.addEventListener('keydown', e => {
  if (e.target.closest('input, textarea')) return;
  if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' '){ e.preventDefault(); if (S?.live?.next) act('next'); }
  if (e.key === 'ArrowLeft' || e.key === 'PageUp'){ e.preventDefault(); if (S?.live?.prev) act('prev'); }
});

let es = null;
function connect(){
  es = new EventSource('events');
  es.onmessage = e => { const d = JSON.parse(e.data); off = Date.now() - d.now; S = d.s; setConn(true); render(); };
  es.onerror = async () => {
    setConn(false);
    // 열쇠가 바뀌었으면(리모컨 끔·새 주소) 다시 붙지 않는다
    try { if ((await fetch('.', { cache: 'no-store' })).status === 404) gone(); } catch { /* 와이파이가 잠깐 끊김 — EventSource가 다시 붙는다 */ }
  };
}
connect();
setInterval(tick, 1000);
