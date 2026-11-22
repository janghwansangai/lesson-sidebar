// 화면(+컴퓨터 소리, +마이크)을 MP4로 녹화해 2초마다 조각을 메인에 보낸다. 메인이 이 PC 임시 폴더에 바로 이어 쓴다 → 앱이 꺼져도 그때까지 남음.
// (변수 이름을 rec으로 하면 contextBridge가 만든 window.rec과 겹쳐 문법 오류가 난다)
// - 컴퓨터 소리: 화면과 함께 'desktop' 소리를 달라고 한다 (윈도우는 됨. 안 되는 OS·PC면 화면만 받고 계속)
// - 마이크: 고른 마이크(없거나 빠졌으면 기본 마이크)
// - 둘 다 있으면 하나로 섞는다 (MediaRecorder는 소리 트랙을 하나만 녹음한다)
let recorder = null, streams = [], mixer = null;
const TYPES = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'];
async function micStream(id){
  if (id){ try { return await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: id } }, video: false }); } catch { /* 빠진 마이크면 기본으로 */ } }
  return navigator.mediaDevices.getUserMedia({ audio: true, video: false });
}
window.rec.onStart(async o => {
  try {
    const light = !!o.light;
    const videoC = { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: o.sourceId,
      maxWidth: light ? 1280 : 1920, maxHeight: light ? 720 : 1080, maxFrameRate: light ? 15 : 30 } };
    let video = null;
    if (o.sys){
      try { video = await navigator.mediaDevices.getUserMedia({ audio: { mandatory: { chromeMediaSource: 'desktop' } }, video: videoC }); }
      catch { video = null; /* 컴퓨터 소리를 못 받는 PC: 화면만 */ }
    }
    video ??= await navigator.mediaDevices.getUserMedia({ audio: false, video: videoC });
    streams = [video];
    const audio = [];
    const sys = video.getAudioTracks().length > 0;
    if (sys) audio.push(...video.getAudioTracks());
    let mic = false;
    if (o.mic){
      try { const a = await micStream(o.micId); streams.push(a); audio.push(...a.getAudioTracks()); mic = a.getAudioTracks().length > 0; }
      catch { /* 마이크를 못 쓰면 빼고 */ }
    }
    let audioTracks = audio;
    if (audio.length > 1){
      mixer = new AudioContext();
      const out = mixer.createMediaStreamDestination();
      for (const t of audio) mixer.createMediaStreamSource(new MediaStream([t])).connect(out);
      if (mixer.state !== 'running') await mixer.resume().catch(() => {});
      audioTracks = out.stream.getAudioTracks();
    }
    const mimeType = TYPES.find(t => MediaRecorder.isTypeSupported(t));
    recorder = new MediaRecorder(new MediaStream([...video.getVideoTracks(), ...audioTracks]), { mimeType, videoBitsPerSecond: light ? 1500000 : 3000000 });
    recorder.ondataavailable = async e => { if (e.data.size) window.rec.chunk(await e.data.arrayBuffer()); };
    recorder.onstop = () => {
      for (const s of streams) for (const t of s.getTracks()) t.stop();
      mixer?.close().catch(() => {}); mixer = null;
      setTimeout(() => window.rec.stopped(), 300);
    };
    recorder.onerror = e => window.rec.error(e.error?.message ?? 'MediaRecorder 오류');
    recorder.start(2000);
    window.rec.started({ mimeType, mic, sys, wantMic: !!o.mic, wantSys: !!o.sys, ...video.getVideoTracks()[0].getSettings() });
  } catch (e){ window.rec.error(`${e.name}: ${e.message}`); }
});
window.rec.onStop(() => { if (recorder && recorder.state !== 'inactive') recorder.stop(); else window.rec.stopped(); });
