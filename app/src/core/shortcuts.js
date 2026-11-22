// 단축키: 수업 중 키보드로 다음·이전 자료, 가리기, 발표 도구를 켠다.
// 파워포인트 클리커(→ ← PageDown PageUp B .)와 겹치지 않게 모두 Ctrl+Alt(맥 ⌃⌥) + 글자.
// 윈도우 일부 인텔 그래픽 드라이버는 Ctrl+Alt+화살표로 화면을 돌리므로 화살표는 쓰지 않는다.
export const SHORTCUTS = [
  { key: 'N', act: 'next', label: '다음 자료' },
  { key: 'B', act: 'prev', label: '이전 자료' },
  { key: 'K', act: 'blank', label: '학생 화면 가리기' },
  { key: 'F', act: 'freeze', label: '학생 화면 정지' },
  { key: 'P', act: 'pen', label: '판서 펜' },
  { key: 'L', act: 'pointer', label: '포인터 강조' },
  { key: 'S', act: 'spot', label: '스포트라이트' },
  { key: 'Z', act: 'zoom', label: '확대' },
];

/** Electron 단축키 문자열 (맥·윈도우 모두 Control+Alt: 맥은 ⌃⌥) */
export const accelerator = s => `Control+Alt+${s.key}`;

/** 사람이 읽는 표시: 맥 ⌃⌥N, 윈도우 Ctrl+Alt+N */
export const keyLabel = (s, platform = process.platform) => (platform === 'darwin' ? `⌃⌥${s.key}` : `Ctrl+Alt+${s.key}`);
