// 도움말 창: OS에 맞는 안내만 보이고, 단축키 목록·버전을 채우고, 업데이트 확인·오류 신고·다있쌤 툴즈를 메인에 부탁한다.
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
(async () => {
  const info = await window.help.info().catch(() => null);
  document.body.classList.add(info?.os === 'win' ? 'win' : 'mac');
  if (info?.version) $('#ver').textContent = `버전 ${info.version}`;
  $('#keylist').innerHTML = (info?.keys ?? []).map(k => `<li><kbd>${esc(k.key)}</kbd><span>${esc(k.label)}</span></li>`).join('');
})();
$('#btn-update').addEventListener('click', () => {
  const m = $('#upd-msg');
  m.className = 'upd-msg'; m.textContent = '확인하는 중…';
  $('#btn-update').disabled = true;
  window.help.act('update');
});
window.help.onUpdate(d => {
  $('#btn-update').disabled = false;
  const m = $('#upd-msg');
  if (d?.version){ m.className = 'upd-msg new'; m.textContent = `새 버전 ${d.version}이 있습니다 · 사이드바 위의 '업데이트'를 누르면 받아서 바꿔 깔고 다시 켭니다`; }
  else if (d?.latest){ m.className = 'upd-msg'; m.textContent = `지금 버전(${d.latest})이 가장 새 버전입니다`; }
  else { m.className = 'upd-msg'; m.textContent = '확인하지 못했습니다 · 인터넷 연결을 확인해 주세요'; }
});
$('#btn-bug').addEventListener('click', () => window.help.act('bug'));
$('#btn-tools').addEventListener('click', () => window.help.act('tools'));
