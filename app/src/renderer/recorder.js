// 화면(+컴퓨터 소리·마이크)을 MP4로 녹화해 2초마다 조각을 메인에 보낸다. 메인이 이 PC 임시 폴더에 바로 이어 쓴다 → 앱이 꺼져도 그때까지 남음.
// (변수 이름을 rec으로 하면 contextBridge가 만든 window.rec과 겹쳐 문법 오류가 난다)
let recorder = null, streams = [], mixer = null;
const TYPES = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'];
// 마이크: 고른 마이크 (빠졌거나 못 쓰면 기본 마이크)
async function micStream(id){
  if (id){ try { return await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: id } }, video: false }); } catch { /* 기본으로 */ } }
  return navigator.mediaDevices.getUserMedia({ audio: true, video: false });
}
window.rec.onStart(async o => {
  try {
    const light = !!o.light;
    const video = await navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: {
      chromeMediaSource: 'desktop', chromeMediaSourceId: o.sourceId,
      maxWidth: light ? 1280 : 1920, maxHeight: light ? 720 : 1080, maxFrameRate: light ? 15 : 30 } } });
    streams = [video];
    const tracks = [...video.getVideoTracks()];
    const audios = [];
    // 컴퓨터 소리: getDisplayMedia로 같은 화면 + 소리를 받아 소리만 쓴다 (메인이 'loopback'으로 답함). 소리 줄이 바로 끝나면 못 받은 것
    let sys = false;
    if (o.sys){
      try {
        const d = await navigator.mediaDevices.getDisplayMedia({ video: { width: 320, height: 180, frameRate: 1 }, audio: true });
        streams.push(d);
        for (const t of d.getVideoTracks()) t.stop();
        const a = d.getAudioTracks().filter(t => t.readyState === 'live');
        await new Promise(r => setTimeout(r, 300));
        if (a.length && a[0].readyState === 'live'){ audios.push(new MediaStream(a)); sys = true; }
      } catch { /* 컴퓨터 소리를 못 받으면 빼고 */ }
    }
    let mic = false;
    if (o.mic){
      try { const a = await micStream(o.micId); streams.push(a); audios.push(a); mic = true; }
      catch { /* 마이크를 못 쓰면 화면만 */ }
    }
    // 소리가 둘이면 하나로 섞는다 (MP4는 소리 줄 하나만 담는다)
    if (audios.length === 1) tracks.push(...audios[0].getAudioTracks());
    else if (audios.length > 1){
      mixer = new AudioContext();
      const out = mixer.createMediaStreamDestination();
      for (const s of audios) mixer.createMediaStreamSource(s).connect(out);
      if (mixer.state !== 'running') await mixer.resume().catch(() => {});   // 숨은 창은 소리 장치가 멈춘 채 시작할 수 있다
      tracks.push(...out.stream.getAudioTracks());
    }
    const mimeType = TYPES.find(t => MediaRecorder.isTypeSupported(t));
    recorder = new MediaRecorder(new MediaStream(tracks), { mimeType, videoBitsPerSecond: light ? 1500000 : 3000000 });
    recorder.ondataavailable = async e => { if (e.data.size) window.rec.chunk(await e.data.arrayBuffer()); };
    recorder.onstop = () => { for (const s of streams) for (const t of s.getTracks()) t.stop(); mixer?.close().catch(() => {}); mixer = null; setTimeout(() => window.rec.stopped(), 300); };
    recorder.onerror = e => window.rec.error(e.error?.message ?? 'MediaRecorder 오류');
    recorder.start(2000);
    window.rec.started({ mimeType, mic, sys, ...video.getVideoTracks()[0].getSettings() });
  } catch (e){ window.rec.error(`${e.name}: ${e.message}`); }
});
window.rec.onStop(() => { if (recorder && recorder.state !== 'inactive') recorder.stop(); else window.rec.stopped(); });
