# 인수인계 — 2026-11-21 (맥 Claude 작성)

> 이 파일만 읽으면 이어서 일할 수 있게 쓴다. 작업을 시작하기 전에 읽고, 끝날 때 고친다.
> 저장소: https://github.com/janghwansangai/lesson-sidebar (비공개)

## 지금 상황
- **설계 완료**: `docs/PLAN.md` v0.3, UI 시안 `design/prototype.html`
  - 정해진 것: 윈도우·맥 모두 지원, 듀얼 모니터(교사 화면 + 학생 화면), 설치형 프로그램 하나(확장 프로그램 없음), 수업은 폴더 단위, 맥·윈도우 Claude 협업
- **0단계 기술 검증 시작** (`docs/poc/README.md`에 진행표)
  - 공통 로직 `poc/lib/match.js` + 단위 테스트 8개 통과
  - 실행기 `poc/runner/run.js` 작동 확인
  - 맥 도우미 `poc/mac-helper/` 빌드 성공, 모니터 2개 인식 통과
  - **맥 창 시험은 대기 중**: 이 맥의 Claude 앱에 "손쉬운 사용" 권한이 없음
  - 시험 자료: 브라우저 페이지 2개, PPT·엑셀 예시 (한글 예시 파일은 아직 없음)
- 자동 검사(GitHub Actions): 맥·윈도우에서 `npm test`, 맥 도우미 빌드

## 다음 할 일 — 맥 Claude
1. 사용자가 손쉬운 사용 권한을 켜면 `cd poc && node runner/run.js --browsers=chrome,edge,whale` 실행 → `docs/poc/mac.md`에 결과 기록
2. 한글 예시 파일을 받으면 `poc/samples/`에 넣고 F3 다시 시험
3. 항목 4(슬라이드 쇼 위 사이드바·오버레이), 5(60분 녹화) 시험용 작은 Electron 앱 만들기 (`poc/electron-probe/`)
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
