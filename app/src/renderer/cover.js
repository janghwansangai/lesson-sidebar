window.cover.onState(s => {
  const img = document.getElementById('frozen');
  img.hidden = s?.mode !== 'freeze';
  if (s?.mode === 'freeze') img.src = `data:image/jpeg;base64,${s.src}`;
  document.getElementById('blank').hidden = s?.mode !== 'blank';
});
