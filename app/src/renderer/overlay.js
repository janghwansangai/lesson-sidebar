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
window.overlay.onState(s => { S = { ...S, ...s }; draw(); });
window.overlay.onCursor(p => {
  // 이 화면 밖이면 원을 화면 밖으로 (스포트라이트는 마지막 자리 유지)
  const x = p.in ? p.x : -500, y = p.in ? p.y : -500;
  root.setProperty('--x', `${x}px`); root.setProperty('--y', `${y}px`);
});
// 스포트라이트: 휠로 크기, 두 번 누르면 끄기 (이 화면이 마우스를 받을 때만)
$('spot').addEventListener('wheel', e => { e.preventDefault(); window.overlay.wheel(e.deltaY); }, { passive: false });
$('spot').addEventListener('dblclick', () => window.overlay.close());
setTimeout(() => { S.hintOff = true; draw(); }, 4000);
draw();
