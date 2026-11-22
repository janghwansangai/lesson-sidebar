// 겹침 창 그리기: 메인이 커서 위치(이 화면 기준)와 도구 상태를 보낸다.
const $ = id => document.getElementById(id);
const root = document.documentElement.style;
let S = { pointer: false, spot: false, r: 150 };
function draw(){
  $('ring').hidden = !S.pointer;
  $('spot').hidden = !S.spot;
  $('hint').hidden = !S.spot || S.hintOff;
  root.setProperty('--r', `${S.r}px`);
}
window.overlay.onState(s => { S = { ...S, ...s }; draw(); drawGrab(); });

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
