// 화면(+컴퓨터 소리·마이크)을 MP4로 녹화해 2초마다 조각을 메인에 보낸다. 메인이 이 PC 임시 폴더에 바로 이어 쓴다 → 앱이 꺼져도 그때까지 남음.
// (변수 이름을 rec으로 하면 contextBridge가 만든 window.rec과 겹쳐 문법 오류가 난다)
let recorder = null, streams = [], mixer = null, recTracks = null, recOpts = null, part = 1;
// 1시간마다 나눠 저장 (선생님 요청 2026-11-22): 메인이 'rec:split'(새 부 번호)을 보내면 같은 화면·소리로 새 녹화기를 먼저 켜고,
// 옛 녹화기는 1초 뒤에 끈다 — 넘어가는 순간 말이 잘리지 않게 1초 겹친다. 화면 받기는 그대로라 맥이 허락을 다시 묻지 않는다.
// 조각은 몇 부인지와 함께 순서대로 보낸다 (arrayBuffer를 기다리는 동안 순서가 바뀌거나, 끝난 뒤에 늦게 가지 않게)
function makeRecorder(n){
  const r = new MediaRecorder(new MediaStream(recTracks), recOpts);
  let chain = Promise.resolve();
  r.ondataavailable = e => { if (e.data.size) chain = chain.then(async () => window.rec.chunk(await e.data.arrayBuffer(), n)).catch(() => {}); };
  r.onerror = e => window.rec.error(e.error?.message ?? 'MediaRecorder 오류');
  r.done = new Promise(res => { r.onstop = () => chain.then(res); });
  r.start(2000);
  return r;
}
function stopAll(){ for (const s of streams) for (const t of s.getTracks()) t.stop(); mixer?.close().catch(() => {}); mixer = null; }
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
// 마이크: 고른 마이크 (빠졌거나 못 쓰면 기본 마이크)
async function micStream(id){
  if (id){ try { return await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: id } }, video: false }); } catch { /* 기본으로 */ } }
  return navigator.mediaDevices.getUserMedia({ audio: true, video: false });
}
window.rec.onStart(async o => {
  try {
    const light = !!o.light;
    const W = light ? 1280 : 1920, H = light ? 720 : 1080, F = light ? 15 : 30;
    const audios = [];
    let video = null, sys = false;
    const extra = [];   // 소리만 쓰는 화면 받기 (끝낼 때 함께 멈춤)
    // 컴퓨터 소리: getDisplayMedia로 같은 화면 + 소리를 받는다 (메인이 'loopback'으로 답함). 소리 줄이 바로 끝나면 못 받은 것.
    // o.one(맥): 그 화면을 그대로 녹화에 쓴다 — 같은 화면을 두 번 찍지 않게. 아니면(윈도우, 확인된 방식) 작게 받아 소리만 쓰고 화면은 아래에서 따로
    if (o.sys){
      try {
        const d = await navigator.mediaDevices.getDisplayMedia(o.one
          ? { video: { width: { max: W }, height: { max: H }, frameRate: { max: F } }, audio: true }
          : { video: { width: 320, height: 180, frameRate: 1 }, audio: true });   // 안 되면 한 번에 포기하고 화면만 (기다리지 않음)
        if (o.one && d.getVideoTracks().length) video = d;
        else { extra.push(d); for (const t of d.getVideoTracks()) t.stop(); }
        const a = d.getAudioTracks().filter(t => t.readyState === 'live');
        await sleep(300);
        if (a.length && a[0].readyState === 'live'){ audios.push(new MediaStream(a)); sys = true; }
      } catch { /* 컴퓨터 소리를 못 받으면 화면만 아래에서 */ }
    }
    if (!video){
      video = await retrying(() => navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: {
        chromeMediaSource: 'desktop', chromeMediaSourceId: o.sourceId, maxWidth: W, maxHeight: H, maxFrameRate: F } } }));
    }
    streams = [video, ...extra];
    const tracks = [...video.getVideoTracks()];
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
    // videoKeyFrameIntervalDuration: MP4는 기준 화면(키프레임)마다 조각을 내보내는데, 화면이 멈춰 있으면 키프레임이 안 생겨
    // 멈출 때까지 한 바이트도 쓰지 않고 녹화 전체를 메모리에 쌓았다(앱이 꺼지면 통째로 잃음, 2026-11-22 시험에서 찾음).
    // 3초마다 기준 화면을 만들어 3초마다 파일에 쓴다 — 갑자기 꺼져도 잃는 것은 3초쯤, 메모리도 쌓이지 않음 (멈춘 화면이면 1시간에 약 100MB 더)
    recTracks = tracks; recOpts = { mimeType, videoBitsPerSecond: light ? 1500000 : 3000000, videoKeyFrameIntervalDuration: 3000 };
    recorder = makeRecorder(part = 1);
    window.rec.started({ mimeType, mic, sys, ...video.getVideoTracks()[0].getSettings() });
  } catch (e){ window.rec.error(`${e.name}: ${e.message}`); }
});
window.rec.onStop(() => {
  if (!recorder || recorder.state === 'inactive'){ stopAll(); window.rec.stopped(); return; }
  const r = recorder;
  r.stop();
  r.done.then(() => { stopAll(); window.rec.stopped(); });
});
window.rec.onSplit(n => {
  if (!recorder || recorder.state === 'inactive' || !(n > part)) return;
  const old = recorder, oldN = part;
  part = n;
  try { recorder = makeRecorder(n); }
  catch { recorder = old; part = oldN; return; }   // 새 녹화기를 못 켜면 지금 부에 그대로 이어서 녹화 (메인은 빈 새 부를 저장하지 않음)
  setTimeout(() => { old.stop(); old.done.then(() => window.rec.partDone(oldN)); }, 1000);
});
