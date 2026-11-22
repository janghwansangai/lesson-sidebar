// 화면(+컴퓨터 소리·마이크)을 MP4로 녹화해 2초마다 조각을 메인에 보낸다. 메인이 이 PC 임시 폴더에 바로 이어 쓴다 → 앱이 꺼져도 그때까지 남음.
// (변수 이름을 rec으로 하면 contextBridge가 만든 window.rec과 겹쳐 문법 오류가 난다)
let recorder = null, streams = [], mixer = null;
const TYPES = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
/**
 * 처음 녹화할 때 맥이 화면·소리 허락 창을 띄우면 화면 받기가 한 번 실패할 수 있다.
 * 선생님이 녹화를 다시 누르지 않아도 되게, 허락을 기다리며 3초마다 몇 번 더 해 본다 (메인이 "허용을 눌러 주세요"를 띄움).
 */
async function retrying(get){
  for (let i = 0; ; i++){
    try { return await get(); }
    catch (e){
      if (i >= 4 || !/NotAllowed|NotReadable|Abort|NotFound/.test(e?.name ?? '')) throw e;
      if (i === 0) window.rec.waiting();
      await sleep(3000);
    }
  }
}
window.rec.onStart(async o => {
  try {
    const light = !!o.light;
    const W = light ? 1280 : 1920, H = light ? 720 : 1080, F = light ? 15 : 30;
    const audios = [];
    let video = null, sys = false;
    // 컴퓨터 소리를 켜면: getDisplayMedia 한 번으로 화면 + 소리를 함께 받는다 (메인이 같은 화면 + 'loopback'으로 답함).
    // 전에는 화면(getUserMedia)과 소리(getDisplayMedia)를 따로 받아 같은 화면을 두 번 찍었다. 소리 줄이 바로 끝나면 못 받은 것
    if (o.sys){
      try {
        const d = await navigator.mediaDevices.getDisplayMedia({ video: { width: { max: W }, height: { max: H }, frameRate: { max: F } }, audio: true });   // 안 되면 한 번에 포기하고 화면만 (기다리지 않음)
        if (d.getVideoTracks().length) video = d; else for (const t of d.getTracks()) t.stop();
        const a = video ? d.getAudioTracks().filter(t => t.readyState === 'live') : [];
        await sleep(300);
        if (a.length && a[0].readyState === 'live'){ audios.push(new MediaStream(a)); sys = true; }
      } catch { /* 컴퓨터 소리를 못 받으면 화면만 아래에서 */ }
    }
    if (!video){
      video = await retrying(() => navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: {
        chromeMediaSource: 'desktop', chromeMediaSourceId: o.sourceId, maxWidth: W, maxHeight: H, maxFrameRate: F } } }));
    }
    streams = [video];
    const tracks = [...video.getVideoTracks()];
    let mic = false;
    if (o.mic){
      try { const a = await navigator.mediaDevices.getUserMedia({ audio: true, video: false }); streams.push(a); audios.push(a); mic = true; }
      catch { /* 마이크를 못 쓰면 화면만 */ }
    }
    // 소리가 둘이면 하나로 섞는다 (MP4는 소리 줄 하나만 담는다)
    if (audios.length === 1) tracks.push(...audios[0].getAudioTracks());
    else if (audios.length > 1){
      mixer = new AudioContext();
      const out = mixer.createMediaStreamDestination();
      for (const s of audios) mixer.createMediaStreamSource(s).connect(out);
      tracks.push(...out.stream.getAudioTracks());
    }
    const mimeType = TYPES.find(t => MediaRecorder.isTypeSupported(t));
    recorder = new MediaRecorder(new MediaStream(tracks), { mimeType, videoBitsPerSecond: light ? 1500000 : 3000000 });
    recorder.ondataavailable = async e => { if (e.data.size) window.rec.chunk(await e.data.arrayBuffer()); };
    recorder.onstop = () => { for (const s of streams) for (const t of s.getTracks()) t.stop(); mixer?.close(); setTimeout(() => window.rec.stopped(), 300); };
    recorder.onerror = e => window.rec.error(e.error?.message ?? 'MediaRecorder 오류');
    recorder.start(2000);
    window.rec.started({ mimeType, mic, sys, ...video.getVideoTracks()[0].getSettings() });
  } catch (e){ window.rec.error(`${e.name}: ${e.message}`); }
});
window.rec.onStop(() => { if (recorder && recorder.state !== 'inactive') recorder.stop(); else window.rec.stopped(); });
