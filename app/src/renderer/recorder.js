// 화면(+마이크)을 MP4로 녹화해 2초마다 조각을 메인에 보낸다. 메인이 이 PC 임시 폴더에 바로 이어 쓴다 → 앱이 꺼져도 그때까지 남음.
// (변수 이름을 rec으로 하면 contextBridge가 만든 window.rec과 겹쳐 문법 오류가 난다)
let recorder = null, streams = [];
const TYPES = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'];
window.rec.onStart(async o => {
  try {
    const light = !!o.light;
    const video = await navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: {
      chromeMediaSource: 'desktop', chromeMediaSourceId: o.sourceId,
      maxWidth: light ? 1280 : 1920, maxHeight: light ? 720 : 1080, maxFrameRate: light ? 15 : 30 } } });
    streams = [video];
    const tracks = [...video.getVideoTracks()];
    let mic = false;
    if (o.mic){
      try { const a = await navigator.mediaDevices.getUserMedia({ audio: true, video: false }); streams.push(a); tracks.push(...a.getAudioTracks()); mic = true; }
      catch { /* 마이크를 못 쓰면 화면만 */ }
    }
    const mimeType = TYPES.find(t => MediaRecorder.isTypeSupported(t));
    recorder = new MediaRecorder(new MediaStream(tracks), { mimeType, videoBitsPerSecond: light ? 1500000 : 3000000 });
    recorder.ondataavailable = async e => { if (e.data.size) window.rec.chunk(await e.data.arrayBuffer()); };
    recorder.onstop = () => { for (const s of streams) for (const t of s.getTracks()) t.stop(); setTimeout(() => window.rec.stopped(), 300); };
    recorder.onerror = e => window.rec.error(e.error?.message ?? 'MediaRecorder 오류');
    recorder.start(2000);
    window.rec.started({ mimeType, mic, ...video.getVideoTracks()[0].getSettings() });
  } catch (e){ window.rec.error(`${e.name}: ${e.message}`); }
});
window.rec.onStop(() => { if (recorder && recorder.state !== 'inactive') recorder.stop(); else window.rec.stopped(); });
