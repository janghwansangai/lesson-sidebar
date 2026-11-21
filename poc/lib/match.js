// OS 공통 판단 로직. 도우미가 준 창·모니터 정보만 보고 계산한다 (부작용 없음).

/** 한글 파일 이름 비교용: 맥(NFD)과 윈도우(NFC)의 차이를 없애고 대소문자·공백을 맞춘다. */
export const nfc = s => String(s ?? '').normalize('NFC');
export const norm = s => nfc(s).toLowerCase().replace(/\s+/g, ' ').trim();

/** 파일 경로에서 확장자를 뺀 파일 이름 (NFC). */
export function stem(p){
  const base = nfc(p).split(/[\\/]/).pop() ?? '';
  return base.replace(/\.[^.]+$/, '');
}

/** 열기 전·후 창 목록을 비교해 새로 생긴 창만 돌려준다. */
export function newWindows(before, after){
  const ids = new Set((before ?? []).map(w => w.wid));
  return (after ?? []).filter(w => !ids.has(w.wid));
}

/** 창 제목에 파일 이름이 들어 있는지 (NFC/NFD, 대소문자 무시). */
export function titleMatches(title, fileStem){
  const s = norm(fileStem);
  return s.length > 0 && norm(title).includes(s);
}

export function findByTitle(windows, fileStem){
  return (windows ?? []).filter(w => titleMatches(w.title, fileStem));
}

/**
 * 새 창 여러 개가 동시에 생겼을 때(브라우저가 이전 창들을 복원하는 경우 등)
 * 제목이 기대한 글자와 맞는 창을 먼저 고르고, 없으면 가장 마지막 창을 고른다.
 */
export function pickNewWindow(candidates, expectTitle){
  if (!candidates?.length) return null;
  if (expectTitle){
    const hit = candidates.find(w => titleMatches(w.title, expectTitle));
    if (hit) return hit;
  }
  return candidates[candidates.length - 1];
}

/** 학생 화면 추정: 주 모니터가 아닌 외부 모니터 → 주 모니터가 아닌 모니터 → 없음. */
export function pickStudentDisplay(displays){
  if (!displays || displays.length < 2) return null;
  return displays.find(d => !d.primary && !d.builtin) ?? displays.find(d => !d.primary) ?? null;
}

/** 창을 놓을 수 있는 영역. 사이드바가 붙어 있으면 그 폭만큼 뺀다. */
export function workArea(display, sidebarWidth = 0){
  const v = display.visible ?? display;
  return { x: v.x + sidebarWidth, y: v.y, width: v.width - sidebarWidth, height: v.height };
}

/** 화면 분할 배치 계산. 시안(design/prototype.html)과 같은 배치 5종. 결과는 정수 좌표. */
export function tileRects(area, key, c, r){
  const { x, y, width: w, height: h } = area;
  const defaults = { half:[[0.5]], seventy:[[0.7]], thirds:[[1/3, 2/3]], main2:[[0.6], [0.5]], grid:[[0.5], [0.5]] }[key];
  if (!defaults) throw new Error(`모르는 배치: ${key}`);
  c = c ?? defaults[0]; r = r ?? defaults[1] ?? [0.5];
  const R = (a, b, cw, ch) => ({ x: Math.round(a), y: Math.round(b), width: Math.round(cw), height: Math.round(ch) });
  switch (key){
    case 'half': case 'seventy': return [R(x, y, w*c[0], h), R(x+w*c[0], y, w*(1-c[0]), h)];
    case 'thirds': return [R(x, y, w*c[0], h), R(x+w*c[0], y, w*(c[1]-c[0]), h), R(x+w*c[1], y, w*(1-c[1]), h)];
    case 'main2': return [R(x, y, w*c[0], h), R(x+w*c[0], y, w*(1-c[0]), h*r[0]), R(x+w*c[0], y+h*r[0], w*(1-c[0]), h*(1-r[0]))];
    case 'grid': return [R(x, y, w*c[0], h*r[0]), R(x+w*c[0], y, w*(1-c[0]), h*r[0]), R(x, y+h*r[0], w*c[0], h*(1-r[0])), R(x+w*c[0], y+h*r[0], w*(1-c[0]), h*(1-r[0]))];
  }
}

/**
 * 두 창의 최소 폭을 지키도록 분할 비율을 조정한다 (조절 바가 최소 크기에서 멈추는 것과 같다).
 * 둘 다 들어갈 수 없으면 null.
 */
export function fitRatio(total, ratio, minA = 0, minB = 0){
  if (minA + minB > total) return null;
  const lo = minA / total, hi = 1 - minB / total;
  return Math.min(hi, Math.max(lo, ratio));
}

/** 요청한 위치·크기와 실제 값이 허용 오차 안인지. */
export function rectClose(a, b, tol = 16){
  return ['x', 'y', 'width', 'height'].every(k => Math.abs((a?.[k] ?? NaN) - (b?.[k] ?? NaN)) <= tol);
}

/** 창 가운데가 어느 모니터에 있는지 (모니터 index, 없으면 -1). */
export function displayOf(rect, displays){
  const cx = rect.x + rect.width / 2, cy = rect.y + rect.height / 2;
  const d = (displays ?? []).find(d => cx >= d.x && cx < d.x + d.width && cy >= d.y && cy < d.y + d.height);
  return d ? d.index : -1;
}
