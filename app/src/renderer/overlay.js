// 겹침 창 그리기: 메인이 커서 위치(이 화면 기준)와 도구 상태를 보낸다.
const $ = id => document.getElementById(id);
const root = document.documentElement.style;
let S = { pointer: false, spot: false, pen: false, r: 150, ink: { color: '#e5484d', size: 4, mode: 'pen' } };
function draw(){
  $('ring').hidden = !S.pointer;
  $('spot').hidden = !S.spot;
  $('hint').hidden = !S.spot || S.hintOff;
  root.setProperty('--r', `${S.r}px`);
  drawPen();
}
window.overlay.onState(s => {
  const wasPen = S.pen;
  S = { ...S, ...s };
  if (wasPen && !S.pen) clearInk(false);   // 펜을 끄면 판서는 지운다
  draw(); drawGrab();
});

// ---------- 클릭 물결 (포인터 강조) ----------
window.overlay.onClick(c => {
  if (!S.pointer) return;
  const r = document.createElement('div');
  r.className = `ripple${c.button === 'right' ? ' right' : ''}`;
  r.style.left = `${c.x}px`; r.style.top = `${c.y}px`;
  r.addEventListener('animationend', () => r.remove());
  $('ripples').append(r);
  setTimeout(() => r.remove(), 1500);
});

// ---------- 판서 펜 ----------
// 그린 선은 점 목록으로 들고 있다가 되돌리기·지우개 때 다시 그린다. 그리는 중인 선은 위 그림판(live)에, 다 그리면 아래(ink)에
const ink = $('ink'), live = $('live'), ictx = ink.getContext('2d'), lctx = live.getContext('2d');
let strokes = [], undo = [], cur = null, erasing = null;
const widthOf = st => st.mode === 'marker' ? st.size * 5 + 6 : st.size;
function fit(){
  const k = devicePixelRatio || 1;
  for (const c of [ink, live]){ c.width = Math.round(innerWidth * k); c.height = Math.round(innerHeight * k); c.getContext('2d').setTransform(k, 0, 0, k, 0, 0); }
  redraw();
}
function paint(ctx, st){
  const p = st.pts; if (!p.length) return;
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = st.color; ctx.lineWidth = st.w;
  ctx.globalAlpha = st.mode === 'marker' ? 0.38 : 1;
  ctx.beginPath(); ctx.moveTo(p[0].x, p[0].y);
  if (p.length < 3) for (const q of p.length === 1 ? [{ x: p[0].x + 0.1, y: p[0].y }] : p.slice(1)) ctx.lineTo(q.x, q.y);
  else {
    for (let i = 1; i < p.length - 1; i++) ctx.quadraticCurveTo(p[i].x, p[i].y, (p[i].x + p[i + 1].x) / 2, (p[i].y + p[i + 1].y) / 2);
    ctx.lineTo(p[p.length - 1].x, p[p.length - 1].y);
  }
  ctx.stroke(); ctx.restore();
}
function redraw(){
  ictx.clearRect(0, 0, innerWidth, innerHeight);
  for (const st of strokes) paint(ictx, st);
  syncButtons();
}
function clearInk(remember){
  if (remember && strokes.length) undo.push({ type: 'clear', strokes });
  else if (!remember) undo = [];
  strokes = []; cur = null; erasing = null;
  lctx.clearRect(0, 0, innerWidth, innerHeight);
  redraw();
}
function syncButtons(){
  $('undo').disabled = !undo.length;
  $('clear').disabled = !strokes.length;
}
function drawPen(){
  $('pen').hidden = !S.pen;
  $('penbar').hidden = !S.pen;
  if (!S.pen) return;
  const k = S.ink;
  $('pen').classList.toggle('eraser', k.mode === 'eraser');
  for (const b of document.querySelectorAll('.sw')) b.setAttribute('aria-pressed', String(b.dataset.color === k.color && k.mode !== 'eraser'));
  for (const b of document.querySelectorAll('[data-mode]')) b.setAttribute('aria-pressed', String(b.dataset.mode === k.mode));
  for (const b of document.querySelectorAll('.sz')) b.setAttribute('aria-pressed', String(Number(b.dataset.size) === k.size));
  syncButtons();
}
for (const b of document.querySelectorAll('.sw')) b.style.setProperty('--c', b.dataset.color);
for (const b of document.querySelectorAll('.sz')) b.querySelector('i').style.setProperty('--d', `${Number(b.dataset.size) + 4}px`);
const setInk = patch => { S.ink = { ...S.ink, ...patch }; drawPen(); window.overlay.ink(S.ink); };
$('colors').addEventListener('click', e => { const b = e.target.closest('.sw'); if (b) setInk({ color: b.dataset.color, mode: S.ink.mode === 'eraser' ? 'pen' : S.ink.mode }); });
for (const b of document.querySelectorAll('[data-mode]')) b.addEventListener('click', () => setInk({ mode: b.dataset.mode }));
$('sizes').addEventListener('click', e => { const b = e.target.closest('.sz'); if (b) setInk({ size: Number(b.dataset.size) }); });
$('undo').addEventListener('click', () => {
  const u = undo.pop(); if (!u) return;
  if (u.type === 'add') strokes = strokes.filter(st => st !== u.stroke);
  else if (u.type === 'erase') strokes = u.before;
  else if (u.type === 'clear') strokes = u.strokes;
  redraw();
});
$('clear').addEventListener('click', () => clearInk(true));
$('pen-off').addEventListener('click', () => window.overlay.off());
$('save').addEventListener('click', () => {
  $('penbar').classList.add('saving');   // 막대는 빼고 판서가 보이는 그대로 찍는다
  setTimeout(() => window.overlay.save(), 120);   // 마우스를 받지 않는 창은 다음 그리기(rAF)가 늦게 올 수 있어 시간으로 기다린다
});
window.overlay.onSaved(() => $('penbar').classList.remove('saving'));
window.overlay.onClear(() => clearInk(false));

const pt = e => ({ x: e.clientX, y: e.clientY });
function eraseAt(p){
  const r = S.ink.size * 3 + 10;
  const keep = strokes.filter(st => !st.pts.some(q => (q.x - p.x) ** 2 + (q.y - p.y) ** 2 <= (r + st.w / 2) ** 2));
  if (keep.length !== strokes.length){ strokes = keep; redraw(); }
  lctx.clearRect(0, 0, innerWidth, innerHeight);
  lctx.save(); lctx.strokeStyle = 'rgba(255,255,255,.9)'; lctx.lineWidth = 2; lctx.setLineDash([4, 3]);
  lctx.beginPath(); lctx.arc(p.x, p.y, r, 0, Math.PI * 2); lctx.stroke(); lctx.restore();
}
const pad = $('pen');
pad.addEventListener('pointerdown', e => {
  if (!S.pen || e.button > 0) return;
  pad.setPointerCapture(e.pointerId);
  if (S.ink.mode === 'eraser'){ erasing = { before: strokes }; eraseAt(pt(e)); return; }
  cur = { color: S.ink.color, size: S.ink.size, mode: S.ink.mode, w: widthOf(S.ink), pts: [pt(e)] };
  paint(lctx, cur);
});
pad.addEventListener('pointermove', e => {
  if (erasing){ eraseAt(pt(e)); return; }
  if (!cur) return;
  for (const ev of e.getCoalescedEvents?.() ?? [e]){
    const p = pt(ev), last = cur.pts[cur.pts.length - 1];
    if ((p.x - last.x) ** 2 + (p.y - last.y) ** 2 >= 1) cur.pts.push(p);
  }
  lctx.clearRect(0, 0, innerWidth, innerHeight);
  paint(lctx, cur);
});
function endStroke(){
  if (erasing){
    if (erasing.before !== strokes) undo.push({ type: 'erase', before: erasing.before });
    erasing = null; lctx.clearRect(0, 0, innerWidth, innerHeight); syncButtons(); return;
  }
  if (!cur) return;
  strokes = [...strokes, cur]; undo.push({ type: 'add', stroke: cur });
  paint(ictx, cur); cur = null;
  lctx.clearRect(0, 0, innerWidth, innerHeight);
  syncButtons();
}
pad.addEventListener('pointerup', endStroke);
pad.addEventListener('pointercancel', endStroke);
pad.addEventListener('contextmenu', e => e.preventDefault());

// 도구 막대 끌어 옮기기 (판서할 자리를 가리지 않게)
let mv = null;
$('grip').addEventListener('pointerdown', e => {
  const r = $('penbar').getBoundingClientRect();
  mv = { dx: e.clientX - r.left, dy: e.clientY - r.top };
  $('grip').setPointerCapture(e.pointerId);
});
$('grip').addEventListener('pointermove', e => {
  if (!mv) return;
  const bar = $('penbar'), r = bar.getBoundingClientRect();
  bar.classList.add('moved');
  bar.style.left = `${Math.max(0, Math.min(innerWidth - r.width, e.clientX - mv.dx))}px`;
  bar.style.top = `${Math.max(0, Math.min(innerHeight - r.height, e.clientY - mv.dy))}px`;
  bar.style.bottom = 'auto';
});
$('grip').addEventListener('pointerup', () => { mv = null; });
addEventListener('resize', fit);
fit();

// ---------- 확대·캡처 핀: 멈춘 화면 그림 ----------
let zoom = 2, drag = null;
function drawGrab(){
  const g = S.grab;
  $('grab').hidden = !g;
  if (!g){ $('sel').hidden = true; return; }
  if ($('frozen').src !== g.src) $('frozen').src = g.src;
  $('grab').className = `grab ${g.mode}`;
  zoom = 2; root.setProperty('--z', g.mode === 'zoom' ? zoom : 1);
  root.setProperty('--ox', '50%'); root.setProperty('--oy', '50%');   // 마우스가 이 화면에 오기 전에는 가운데를 확대
  $('hint').textContent = g.mode === 'zoom' ? '확대 · 마우스로 옮기기 · 휠로 배율 · 클릭이나 Esc로 끝' : '캡처 핀 · 끌어서 영역 고르기 · Esc로 취소';
  $('hint').hidden = false;
}
const grabEl = $('grab');
grabEl.addEventListener('mousemove', e => {
  if (S.grab?.mode === 'zoom'){ root.setProperty('--ox', `${e.clientX}px`); root.setProperty('--oy', `${e.clientY}px`); }
  if (drag){
    const x = Math.min(drag.x, e.clientX), y = Math.min(drag.y, e.clientY), w = Math.abs(e.clientX - drag.x), h = Math.abs(e.clientY - drag.y);
    Object.assign($('sel').style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px`,
      backgroundImage: `url(${S.grab.src})`, backgroundSize: `${innerWidth}px ${innerHeight}px`, backgroundPosition: `${-x}px ${-y}px` });
    drag.r = { x, y, width: w, height: h };
  }
});
grabEl.addEventListener('wheel', e => {
  if (S.grab?.mode !== 'zoom') return;
  e.preventDefault();
  zoom = Math.max(1.5, Math.min(4, zoom - e.deltaY * 0.005));
  root.setProperty('--z', zoom);
}, { passive: false });
grabEl.addEventListener('mousedown', e => {
  if (S.grab?.mode === 'zoom') return window.overlay.end();
  drag = { x: e.clientX, y: e.clientY, r: null };
  $('sel').hidden = false;
});
grabEl.addEventListener('mouseup', () => {
  if (!drag) return;
  const r = drag.r; drag = null; $('sel').hidden = true;
  window.overlay.pick(r ?? { x: 0, y: 0, width: 0, height: 0 });
});
// 커서 위치: 이 창이 받는 마우스 움직임(포인터는 forward로 넘겨받음)을 바로 쓰고,
// 메인이 보내는 위치(주기적으로 읽음)는 마우스 움직임이 없을 때와 화면을 벗어났을 때만 쓴다 — 메인을 거치면 한두 장면 늦다
let localAt = 0;
const place = (x, y) => { $('spot').classList.remove('away'); root.setProperty('--x', `${x}px`); root.setProperty('--y', `${y}px`); };
addEventListener('mousemove', e => { if (S.pointer || S.spot){ localAt = performance.now(); place(e.clientX, e.clientY); } }, { passive: true });
window.overlay.onCursor(p => {
  // 이 화면 밖이면: 포인터 원은 화면 밖으로, 스포트라이트는 화면 전체를 어둡게 (판을 밀어내면 가장자리에 밝은 띠가 남았다)
  if (!p.in){ root.setProperty('--x', '-500px'); root.setProperty('--y', '-500px'); $('spot').classList.add('away'); return; }
  if (performance.now() - localAt > 150) place(p.x, p.y);
});
// 스포트라이트: 휠로 크기, 두 번 누르면 끄기 (이 화면이 마우스를 받을 때만)
$('spot').addEventListener('wheel', e => { e.preventDefault(); window.overlay.wheel(e.deltaY); }, { passive: false });
$('spot').addEventListener('dblclick', () => window.overlay.close());
setTimeout(() => { S.hintOff = true; if (!S.grab) draw(); }, 4000);
draw();
