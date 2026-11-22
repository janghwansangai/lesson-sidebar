// 조절 바: 누르고 끄는 동안 화면 좌표를 메인에 보낸다 (창이 따라 움직여도 포인터 캡처로 계속 받는다).
// ?dir=v 세로 경계(좌우로 끔), ?dir=h 가로 경계(위아래로 끔)
const dir = new URLSearchParams(location.search).get('dir') === 'h' ? 'h' : 'v';
document.body.classList.add(dir);
const bar = document.getElementById('bar');
bar.setAttribute('aria-orientation', dir === 'h' ? 'horizontal' : 'vertical');
bar.title = dir === 'h' ? '끌어서 위아래 창의 높이를 바꿉니다' : '끌어서 두 창의 폭을 바꿉니다';
let dragging = false;
bar.addEventListener('pointerdown', e => { dragging = true; bar.setPointerCapture(e.pointerId); bar.classList.add('drag'); });
bar.addEventListener('pointermove', e => { if (dragging) window.divider.move(e.screenX, e.screenY); });
const stop = e => { if (!dragging) return; dragging = false; bar.classList.remove('drag'); window.divider.end(e.screenX, e.screenY); };
bar.addEventListener('pointerup', stop);
bar.addEventListener('pointercancel', stop);
