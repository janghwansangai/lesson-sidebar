// 조절 바: 누르고 끄는 동안 화면 x를 메인에 보낸다 (창이 따라 움직여도 포인터 캡처로 계속 받는다).
const bar = document.getElementById('bar');
let dragging = false;
bar.addEventListener('pointerdown', e => { dragging = true; bar.setPointerCapture(e.pointerId); bar.classList.add('drag'); });
bar.addEventListener('pointermove', e => { if (dragging) window.divider.move(e.screenX); });
const stop = e => { if (!dragging) return; dragging = false; bar.classList.remove('drag'); window.divider.end(e.screenX); };
bar.addEventListener('pointerup', stop);
bar.addEventListener('pointercancel', stop);
