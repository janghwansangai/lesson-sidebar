# 수업 사이드바 — 체험판 (맥)

화면 왼쪽에 붙는 사이드바에서 수업 자료를 원래 프로그램(크롬·파워포인트·엑셀·한글·텍스트 편집기)으로 열고, 앞으로 가져오고, 학생 화면으로 보내고, 나란히 놓고, 닫는 첫 체험판입니다. 아직 맥에서만 동작합니다 (윈도우는 윈도우 도우미가 생기면 이어서).

## 실행
```bash
cd poc && npm run build:mac      # 창 관리 도우미 (처음 한 번)
cd ../app && npm install         # 처음 한 번
npm start
```
- 실행하는 프로그램(터미널 또는 Claude)에 **손쉬운 사용** 권한이 있어야 다른 프로그램 창을 옮길 수 있습니다.
- 처음에는 `sample-lesson/`(체험용 수업)을 엽니다. "수업 폴더 열기"로 `lesson.json`이 있는 다른 폴더를 열 수 있고, 마지막에 연 폴더를 기억합니다.
- 설정·기록은 개발 중에는 `app/.userdata/`에 둡니다 (저장소에 올리지 않음).

## 할 수 있는 것
| 동작 | 방법 |
|---|---|
| 자료 열기 / 앞으로 가져오기 | 목록 누르기 (듀얼 모니터면 학생 화면에, 진행 메모는 교사 화면에) |
| 교사 화면에서 먼저 보기 | 위쪽 "여는 곳"에서 "교사 화면에서 먼저" → 확인 후 ⇄ |
| 다른 화면으로 보내기 | 열린 자료에 마우스를 올리고 ⇄ |
| 닫기 | ✕ (저장 확인 창 등이 뜨면 "답 기다림" 표시) |
| 반반으로 나란히 | 체크 두 개 → "반반으로 나란히" (프로그램 최소 폭에서 멈춤) |
| 다음 자료 | 위쪽 "다음" |
| 모두 미리 열기 | 아래 버튼 — 학생 화면에는 첫 자료만 보이고 나머지는 최소화 |
| 다른 창 숨기기 | 학생 화면에서 지금 자료만 남기기 |
| 자동 숨김 | 오른쪽 위 버튼 — 화면 왼쪽 끝에 마우스를 대면 나타남 |
| 모니터 연결이 바뀔 때 | 학생 화면이 빠지면 창을 교사 화면으로 모으고, 다시 꽂으면 돌려놓음 |
| 다시 켰을 때 | 이미 열린 문서 창(PPT·엑셀·한글·메모)을 다시 연결 |

## 구조
```
src/main.js            Electron 시작점: 사이드바 창, 자동 숨김, 모니터 변화, 화면 요청 처리
src/preload.cjs        화면에 열어 주는 기능 (state, act, onState)
src/core/session.js    수업 진행 로직 — 화면 없이 시험 가능 (test/session.test.js)
src/core/lesson.js     lesson.json 읽기·검사 (수업 폴더 밖 경로·이상한 주소 차단)
src/core/launcher.js   프로그램 열기 (맥: open)
src/core/fileserver.js 로컬 파일을 127.0.0.1 내부 주소로 브라우저에 제공
src/core/helper.js     창 관리 도우미 연결 (docs/poc/helper-protocol.md)
src/renderer/          사이드바 화면
sample-lesson/         체험용 수업 폴더
```

## 시험
```bash
npm test                                 # 수업 진행 로직 (가짜 도우미, 창을 열지 않음)
SIDEBAR_DEBUG=1 npm start                # 개발용 원격 조작 주소를 .userdata/debug.json에 남김
```
원격 조작: `GET <debug.json의 url>/act?do=activate&arg=it4` → 동작 후 상태(JSON). `do`는 `activate, move, close, toggleSel, split, untile, openAll, next, hideOthers, openTo, autoHide`.
