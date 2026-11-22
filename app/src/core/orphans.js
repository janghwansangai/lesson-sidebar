// 지난번에 꺼지지 않고 남은 사이드바 조각 찾기 (맥).
// 사이드바 본체가 갑자기 꺼지거나, 설치 파일(DMG)에서 켠 채로 설치 파일을 꺼내면 도우미 프로세스(화면 그리기 등)가
// 부모 없이 남아 CPU를 계속 쓸 수 있다 (2026-11-22: 0.1.0 조각 하나가 9시간 동안 CPU 1000%를 써서 컴퓨터 전체가 느려짐).
// 정상 도우미는 부모가 사이드바 본체라, 부모가 launchd(1)인 도우미만 남은 조각으로 본다.

/**
 * @param psText `ps -A -o pid=,ppid=,pcpu=,comm=` 출력
 * @param name   앱 실행 파일 이름 (설치판 'LessonSidebar')
 * @returns {{ pid:number, cpu:number }[]}
 */
export function findOrphans(psText, name = 'LessonSidebar', self = 0){
  const out = [];
  for (const line of String(psText ?? '').split('\n')){
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(.+)$/);
    if (!m) continue;
    const pid = Number(m[1]), ppid = Number(m[2]), cmd = m[4];
    if (ppid !== 1 || pid === self) continue;
    if (!cmd.includes(`/${name} Helper`)) continue;   // 'LessonSidebar Helper', '… Helper (Renderer)', '(GPU)', '(Plugin)'
    out.push({ pid, cpu: Number(m[3]) || 0 });
  }
  return out;
}
