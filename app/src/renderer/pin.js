window.pin.onImage(src => { document.getElementById('img').src = src; });
document.getElementById('x').addEventListener('click', () => window.pin.close());
