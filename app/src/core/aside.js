// 사이드바를 고정했을 때 교사 화면에서 사이드바에 가려지는 창을 옆으로 비키는 계산 (화면 없이 시험: test/aside.test.js).
// 실제로 옮기고 돌려놓는 것은 Session.stepAside / restoreAside.
import * as M from '../../../poc/lib/match.js';

/**
 * @param wins    도우미 list의 창들 ({ wid, pid, x, y, width, height, minimized, maximized?, fullscreen? })
 * @param teacher 교사 화면 (도우미 displays의 하나, visible = 작업 표시줄을 뺀 영역)
 * @param span    사이드바 폭 (도우미 단위: 윈도우 물리 픽셀, 맥 포인트)
 * @returns [{ wid, from, to, maximized }]
 *   - 가운데가 교사 화면에 있고 왼쪽 끝이 사이드바 아래에 있는 창만. 사이드바 자신(ownPid)·최소화·전체 화면(슬라이드 쇼)은 뺀다
 *   - 최대화된 창: 사이드바 오른쪽 사용 영역 전체로 (돌려놓을 때 다시 최대화)
 *   - 나머지: 왼쪽 끝만 사이드바 오른쪽으로 당기고 오른쪽 끝은 그대로 (너무 좁아지면 minWidth만큼은 남기고, 화면 밖으로는 안 나가게)
 */
export function planAside(wins, teacher, span, { ownPid = null, displays = [teacher], minWidth = 480 } = {}){
  const wa = M.workArea(teacher);
  const left = wa.x + span, right = wa.x + wa.width;
  if (span <= 0 || left >= right) return [];
  const out = [];
  for (const w of wins ?? []){
    if ((ownPid != null && w.pid === ownPid) || w.minimized || w.fullscreen) continue;
    if (M.displayOf(w, displays) !== teacher.index) continue;
    if (w.x >= left || w.x + w.width <= wa.x) continue;   // 사이드바와 겹치지 않음
    const from = { x: w.x, y: w.y, width: w.width, height: w.height };
    let to;
    if (w.maximized) to = { x: left, y: wa.y, width: right - left, height: wa.height };
    else {
      const r = Math.min(right, Math.max(w.x + w.width, left + Math.min(w.width, minWidth)));
      to = { x: left, y: w.y, width: r - left, height: w.height };
    }
    out.push({ wid: w.wid, from, to, maximized: !!w.maximized });
  }
  return out;
}
