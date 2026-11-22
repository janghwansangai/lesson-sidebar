// 녹화 목차: 앞에 띄운 자료가 바뀔 때마다 "03:12 연수 안내"처럼 남긴다 (docs/PLAN.md 8).
// 시각은 녹화를 시작한 때부터 잰다. 같은 자료가 잇달아 오면 한 번만, 2초 안에 바뀌면 앞의 것을 바꿔 쓴다(빠르게 넘긴 것).

export function clock(ms){
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  const p = n => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(x)}` : `${p(m)}:${p(x)}`;
}

export class Chapters {
  constructor(startedAt = Date.now()){ this.startedAt = startedAt; this.list = []; }
  /** 자료가 앞으로 왔을 때. at: 그때 시각(ms) */
  add(title, at = Date.now()){
    title = String(title ?? '').trim();
    if (!title) return;
    const t = Math.max(0, at - this.startedAt);
    const last = this.list.at(-1);
    if (last?.title === title) return;
    if (last && t - last.t < 2000){ last.title = title; return; }
    this.list.push({ t, title });
  }
  /** 목차 글 (한 줄에 하나). 유튜브 설명란처럼 붙여 넣으면 장으로 나뉜다 */
  text(header = ''){
    return (header ? header + '\n\n' : '') + this.list.map(c => `${clock(c.t)} ${c.title}`).join('\n') + '\n';
  }
  toJSON(){ return { startedAt: this.startedAt, list: this.list }; }
  static from(o){ const c = new Chapters(o?.startedAt ?? Date.now()); c.list = Array.isArray(o?.list) ? o.list : []; return c; }
}
