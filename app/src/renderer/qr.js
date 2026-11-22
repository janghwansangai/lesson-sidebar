// 링크 QR 창: 받은 그림을 크게 보여 주고, 누르거나 Esc면 닫는다
const $ = id => document.getElementById(id);
window.qr.onShow(d => {
  $('title').textContent = d.title ?? '';
  $('code').src = d.src;
  $('code').alt = `${d.title ?? ''} 링크 QR`;
  $('url').textContent = d.short ?? '';
});
document.addEventListener('click', () => window.qr.close());
document.addEventListener('keydown', e => { if (e.key === 'Escape') window.qr.close(); });
