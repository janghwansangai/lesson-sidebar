# 인수인계 — 2026-11-21 (맥 Claude 작성)

> 이 파일만 읽으면 이어서 일할 수 있게 쓴다. 작업을 시작하기 전에 읽고, 끝날 때 고친다.
> 저장소: https://github.com/janghwansangai/lesson-sidebar (비공개)

## 지금 상황
- **설계 완료**: `docs/PLAN.md` v0.3, UI 시안 `design/prototype.html`
  - 정해진 것: 윈도우·맥 모두 지원, 듀얼 모니터(교사 화면 + 학생 화면), 설치형 프로그램 하나(확장 프로그램 없음), 수업은 폴더 단위, 맥·윈도우 Claude 협업
- **0단계 기술 검증 진행 중** (`docs/poc/README.md`에 진행표)
  - 공통 로직 `poc/lib/match.js` + 단위 테스트 9개 통과
  - **맥: 항목 1·2·3 통과** (`docs/poc/mac.md`). 창 찾기·앞으로(0.16초)·학생 화면으로 옮기기·분할·닫기, 크롬·엣지·웨일 새 창, 파워포인트·엑셀·한글(빈 문서)
  - 맥 검증으로 바뀐 설계 (`docs/PLAN.md`에 반영): 로컬 파일은 브라우저에 `127.0.0.1` 내부 주소로 제공, 맥은 `open`으로 프로그램 실행, 외부 모니터 메뉴 막대 보정, 분할은 최소 폭에서 멈춤, 모달 창이 있으면 "답을 기다리는 창" 표시
  - 시험 자료: 브라우저 페이지 2개, PPT·엑셀 예시 (한글 예시 파일은 아직 없음)
- **맥 체험판 첫 버전** (`app/`, Electron 45): 사이드바에서 열기·앞으로·학생 화면으로 보내기(⇄)·반반·닫기·다음·모두 미리 열기·다른 창 숨기기·자동 숨김·모니터 변화 처리·다시 켰을 때 다시 연결. 실행 방법은 `app/README.md`. 수업 진행 로직 테스트 10개 통과
  - 선생님 확인 대기: 직접 써 보기, 슬라이드 쇼 위 사이드바(항목 4), 모니터 뺐다 꽂기
- 자동 검사(GitHub Actions): 맥·윈도우에서 `npm test`, 맥 도우미 빌드

## 다음 할 일 — 맥 Claude
1. (완료) 맥 항목 1·2·3 검증. 손쉬운 사용 권한은 Claude Code(`claude.app`)에 켜져 있음 — Claude가 업데이트되면 다시 켜야 할 수 있음
2. 한글 예시 파일을 받으면 `poc/samples/`에 넣고 F3 다시 시험
2-1. 외부 모니터를 뺐다가 다시 꽂는 시험(손으로), 프로그램이 꺼진 상태에서 "모두 미리 열기" 시간 재기
3. 체험판에 선생님 의견 반영, 항목 5(60분 녹화) 시험, 도우미를 계속 켜 두는 방식으로 앞으로 가져오기 속도 줄이기
4. 작업은 `mac/…` 브랜치에서, PR로 합치기

## 다음 할 일 — 윈도우 Claude (처음 시작)
1. 읽을 것: `CLAUDE.md` → `docs/PLAN.md`(0장, 4장, 6장, 10.1장) → `docs/poc/README.md` → `docs/poc/helper-protocol.md` → `poc/win-helper/README.md`
2. `git checkout -b win/helper`
3. `poc/win-helper/`에 `package.json`(koffi) + `winctl.js` 만들기 — 규격은 `docs/poc/helper-protocol.md`
4. `cd poc && npm test` 통과 확인
5. `node runner/run.js --browsers=chrome,edge,whale` 실행. 실행기의 윈도우용 열기 명령(`APPS`, `openBrowserWindow`, `openFile`)은 실제 PC에 맞게 고친다
6. 외부 모니터(또는 프로젝터)를 연결한 상태와 뺀 상태 모두 시험
7. 결과를 `docs/poc/windows.md`에 기록, 이 파일의 "지금 상황"과 "넘길 일" 고치고 PR

## 윈도우 PC 준비 (사용자가 한 번만)
PowerShell에서:
```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id GitHub.cli -e
```
설치 후 PowerShell을 새로 열고:
```powershell
gh auth login
gh repo clone janghwansangai/lesson-sidebar
```
그다음 Claude 앱(Code 탭)에서 `lesson-sidebar` 폴더를 열고 "HANDOFF.md 읽고 윈도우 쪽 기술 검증 시작해"라고 말한다.

## 사용자에게 받을 것
- 맥: Claude 앱의 "손쉬운 사용" 권한 (시스템 설정 → 개인정보 보호 및 보안 → 손쉬운 사용)
- 학생 정보가 없는 예시 한글 파일(.hwp 또는 .hwpx) 하나
- 눈으로 확인할 것: 실행기가 돌 때 창이 학생 화면(외부 모니터)으로 제대로 옮겨지는지

## 넘길 일
- 없음
