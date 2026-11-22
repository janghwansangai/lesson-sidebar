// 수업 중 화면(발표자 화면·휴대폰 리모컨)이 함께 쓰는 판단: 시간 재기, 지금·다음 자료, 휴대폰이 볼 수 있는 주소.
// 화면·네트워크 없이 시험한다 (test/live.test.js).

/** 수업·구간 시간 재기. 자료를 처음 앞으로 띄운 때 수업이 시작되고, 구간 시계는 그 구간에 머문 시간을 더한다
 *  (앞 구간으로 잠깐 돌아가도 0부터 다시 세지 않는다). */
export class Timing {
  constructor(){ this.reset(); }
  reset(){ this.root = null; this.lessonStart = null; this.secId = null; this.secStart = null; this.lastHi = null; this.spent = new Map(); }
  /** 화면이 바뀔 때마다 부른다. 바뀐 것이 있으면 true */
  update(lesson, highlight, now = Date.now()){
    if (!lesson){ if (this.root){ this.reset(); return true; } return false; }
    if (lesson.root !== this.root){ this.reset(); this.root = lesson.root; }
    if (!highlight || highlight === this.lastHi) return false;
    this.lastHi = highlight;
    const sec = lesson.sections.find(s => s.items.some(it => it.id === highlight));
    if (this.lessonStart == null) this.lessonStart = now;
    if (sec && sec.id !== this.secId){
      if (this.secId) this.spent.set(this.secId, (this.spent.get(this.secId) ?? 0) + now - this.secStart);
      this.secId = sec.id; this.secStart = now;
    }
    return true;
  }
  /** "시계 다시": 지금부터 다시 잰다 (구간도 지금부터) */
  restart(now = Date.now()){ if (this.lessonStart == null) return; this.lessonStart = now; this.spent.clear(); if (this.secId) this.secStart = now; }
  /** 지금 구간 시계가 0이었다고 치는 시각 (화면은 now - 이 값을 보인다) */
  get secSince(){ return this.secStart == null ? null : this.secStart - (this.spent.get(this.secId) ?? 0); }
}

const brief = it => it ? { id: it.id, title: it.title, type: it.type, app: it.app ?? null, start: it.start ?? null } : null;

/**
 * 발표자 화면·리모컨에 보일 것. snap은 session.snapshot()의 lesson (구간마다 items).
 * - 지금 자료: 앞에 띄운 것 (없으면 null) · 다음 자료: 그다음 (메모는 건너뜀 — 메모는 교사 화면용이라 "다음"으로 띄울 일이 적다)
 * - 구간: 지금 구간 이름·계획 분·지난 시간, 넘으면 over
 */
export function liveView(snapLesson, highlight, timing, now = Date.now()){
  if (!snapLesson) return null;
  const all = snapLesson.sections.flatMap(s => s.items.map(it => ({ ...it, sec: s.id })));
  const i = all.findIndex(it => it.id === highlight);
  const cur = i >= 0 ? all[i] : null;
  const next = all.slice(i + 1).find(it => it.type !== 'memo') ?? null;
  const prev = i > 0 ? [...all.slice(0, i)].reverse().find(it => it.type !== 'memo') ?? null : null;
  const sec = snapLesson.sections.find(s => s.id === (cur?.sec ?? timing.secId)) ?? null;
  const here = sec && timing.secId === sec.id && timing.secSince != null;
  const secElapsed = here ? now - timing.secSince : 0;
  const plan = snapLesson.sections.reduce((a, s) => a + (Number(s.minutes) || 0), 0);
  const secIdx = sec ? snapLesson.sections.indexOf(sec) : -1;
  return {
    title: snapLesson.title,
    lesson: { elapsed: timing.lessonStart != null ? now - timing.lessonStart : 0, started: timing.lessonStart != null, planMin: plan },
    section: sec ? { id: sec.id, title: sec.title, minutes: Number(sec.minutes) || 0, elapsed: secElapsed,
      over: !!sec.minutes && secElapsed > sec.minutes * 60000, n: secIdx + 1, of: snapLesson.sections.length } : null,
    // 구간 시계가 시작된 시각 (화면이 1초마다 스스로 다시 계산하도록)
    since: { lesson: timing.lessonStart, section: here ? timing.secSince : null },
    current: brief(cur), next: brief(next), prev: brief(prev),
    nextSection: (() => { const ns = snapLesson.sections[secIdx + 1]; return ns ? { title: ns.title, minutes: Number(ns.minutes) || 0 } : null; })(),
    sections: snapLesson.sections.map(s => ({ id: s.id, title: s.title, minutes: s.minutes, items: s.items.map(brief) })),
    highlight: highlight ?? null,
  };
}

/** 지금 구간의 진행 메모들 (구간에 메모가 없으면 수업 전체 첫 메모). [{ id, title, abs }] */
export function memoFor(lesson, highlight){
  if (!lesson) return [];
  const sec = lesson.sections.find(s => s.items.some(it => it.id === highlight)) ?? lesson.sections[0];
  const pick = list => list.filter(it => it.type === 'memo' && it.abs && !it.problem).map(it => ({ id: it.id, title: it.title, abs: it.abs }));
  const here = sec ? pick(sec.items) : [];
  return here.length ? here : pick(lesson.items).slice(0, 1);
}

/** 1:05:09 / 4:07 */
export function hms(ms){
  const t = Math.max(0, Math.floor((ms ?? 0) / 1000)), h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * 휴대폰이 접속할 이 PC의 주소. 사설망 IPv4 중 와이파이·유선을 먼저, 가상(도커·VPN·병렬 PC) 장치는 뒤로.
 * ifaces는 os.networkInterfaces() 모양. 없으면 null.
 */
export function lanAddress(ifaces){
  const priv = a => /^10\./.test(a) || /^192\.168\./.test(a) || /^172\.(1[6-9]|2\d|3[01])\./.test(a);
  const virt = n => /^(utun|bridge|vbox|vmnet|vEthernet|docker|br-|tailscale|zt|llw|awdl|anpi|ap\d)/i.test(n) || /virtual|vpn|hyper-v|wsl|loopback/i.test(n);
  const cands = [];
  for (const [name, list] of Object.entries(ifaces ?? {})){
    for (const a of list ?? []){
      if ((a.family !== 'IPv4' && a.family !== 4) || a.internal || /^169\.254\./.test(a.address)) continue;
      cands.push({ name, address: a.address, score: (virt(name) ? 0 : 2) + (priv(a.address) ? 1 : 0) + (/^(en0|wi-?fi|wlan|무선)/i.test(name) ? 1 : 0) });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  return cands[0] ? { name: cands[0].name, address: cands[0].address } : null;
}

// 휴대폰에서 받는 요청: 이것만 한다 (파일 열기·설정 바꾸기·끝내기는 안 됨)
export const REMOTE_ACTIONS = new Set(['next', 'prev', 'activate', 'freeze', 'blank', 'hideOthers', 'restartClock']);
