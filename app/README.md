# 수업 사이드바 — 체험판 (맥·윈도우)

화면 왼쪽에 붙는 사이드바에서 수업 자료를 원래 프로그램(크롬·파워포인트·엑셀·한글·텍스트 편집기/메모장)으로 열고, 앞으로 가져오고, 학생 화면으로 보내고, 나란히 놓고, 닫는 첫 체험판입니다. 맥과 윈도우에서 동작합니다 (윈도우 결과: `docs/poc/windows.md` "체험판으로 확인한 것").

## 실행 (맥)
```bash
cd poc && npm run build:mac      # 창 관리 도우미 (처음 한 번)
cd ../app && npm install         # 처음 한 번
npm start
```
- 실행하는 프로그램(터미널 또는 Claude)에 **손쉬운 사용** 권한이 있어야 다른 프로그램 창을 옮길 수 있습니다.

## 실행 (윈도우)
```powershell
cd poc\win-helper; npm install   # 창 관리 도우미 (처음 한 번, koffi 설치)
cd ..\..\app; npm install        # 처음 한 번
npm start
```
- 도우미(`poc/win-helper/winctl.js`)는 Electron 안의 Node로 실행하므로 Node를 따로 설치하지 않아도 됩니다. 권한 설정도 필요 없습니다.
- `npm start`가 "Electron failed to install correctly"로 멈추면 `node node_modules\electron\install.js`를 한 번 실행합니다.
- 진행 메모(.md)는 메모장으로 엽니다. 브라우저는 크롬 → 엣지 → 웨일 순으로 설치된 것을 씁니다.
- 처음에는 `sample-lesson/`(체험용 수업)을 엽니다. "수업 폴더 열기"로 `lesson.json`이 있는 다른 폴더를 열 수 있고, 마지막에 연 폴더를 기억합니다.
- 설정·기록은 개발 중에는 `app/.userdata/`에 둡니다 (저장소에 올리지 않음).

## 수업 준비 (사이드바 아래 "수업 준비")
| 할 일 | 방법 |
|---|---|
| 수업 보관함 정하기 | 처음 한 번: 구글 드라이브 / 문서 폴더 / 다른 위치 중 고르기 (안에 `수업 사이드바` 폴더) |
| 새 수업 | "새 수업" → 이름·날짜 → `날짜_제목` 폴더와 도입·전개·정리 구간이 생김 |
| 파일 넣기 | 창에 끌어다 놓기(놓은 구간에 들어감) 또는 "파일 고르기" — 수업 폴더로 복사, 원본은 그대로, 실행 파일·스크립트는 거름 |
| 링크 넣기 | 붙여 넣으면 유튜브·구글 문서·시트·슬라이드·드라이브·캔바·웹사이트를 알아봄 (유튜브 `t=` 시작 시간도) |
| 메모 | "메모 추가" → "편집"으로 텍스트 편집기에서 고침 (교사 화면에 열림) |
| 고치기 | 자료 이름·시작 위치·띄울 화면, ⋮⋮ 끌어 순서 바꾸기, 구간 이름·시간, ✕ 빼기(파일은 `.sidebar/휴지통`) |
| 정리하기 | 파일 이름 앞 순번과 구간 폴더를 지금 순서에 맞춤 (사이드바에서 열린 파일은 다음에) |
| 이 수업으로 진행 | 사이드바에 바로 반영. 진행 중에 고쳐도 바로 반영 |
| 다른 PC와 함께 | 다른 PC에서 고친 내용은 3초 안에 불러옴, 다른 PC가 열고 있으면 경고 |
| 저장 | 저장 버튼 없음. 바꿀 때마다 바로 저장. 글자 칸은 치다 1.2초 멈추면 · Enter나 다른 곳을 누르면 · 다른 창으로 가면 · 창을 닫거나 끝내면 저장. 백업(`.sidebar/backup`)은 1분에 하나, 최근 10개 (다른 PC에서 바뀐 파일을 덮을 때는 먼저 백업) |

## 할 수 있는 것 (사이드바)
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
| 자동 숨김 | 오른쪽 위 버튼 — 접으면 교사 화면 왼쪽 가운데에 반투명 노란 막대만 남고(막대 자리 클릭은 아래 창으로 감), 막대 옆으로 마우스를 밀면 나타남 (왼쪽에 학생 화면이 있으면 막대 높이에서 넘어가도 나타남) |
| 모니터 연결이 바뀔 때 | 학생 화면이 빠지면 창을 교사 화면으로 모으고, 다시 꽂으면 돌려놓음 |
| 다시 켰을 때 | 이미 열린 문서 창(PPT·엑셀·한글·메모)을 다시 연결 |

## 구조
```
src/main.js            Electron 시작점: 사이드바 창, 자동 숨김, 모니터 변화, 화면 요청 처리
src/preload.cjs        화면에 열어 주는 기능 (state, act, onState)
src/core/session.js    수업 진행 로직 — 화면 없이 시험 가능 (test/session.test.js)
src/core/editor.js     수업 편집 (자료 복사·순서·정리하기·저장/백업) (test/editor.test.js)
src/core/library.js    수업 보관함 목록, 보관함 위치 추천
src/core/lock.js       PC마다 잠금 파일 (.sidebar/locks/)
src/core/types.js      자료 종류 판별, 파일 이름 규칙
src/core/lesson.js     lesson.json 읽기·검사 (수업 폴더 밖 경로·이상한 주소 차단)
src/core/launcher.js   프로그램 열기 (맥: open, 윈도우: App Paths 실행 파일·shell.openPath·메모장)
src/core/fileserver.js 로컬 파일을 127.0.0.1 내부 주소로 브라우저에 제공
src/core/helper.js     창 관리 도우미 연결 (docs/poc/helper-protocol.md)
src/renderer/          사이드바 화면(index) · 수업 준비 화면(prep)
sample-lesson/         체험용 수업 폴더
```

## 시험
```bash
npm test                                 # 수업 진행 로직 (가짜 도우미, 창을 열지 않음)
SIDEBAR_DEBUG=1 npm start                # 개발용 원격 조작 주소를 .userdata/debug.json에 남김
```
윈도우 PowerShell에서는 `$env:SIDEBAR_DEBUG='1'; npm start`.
원격 조작: `GET <debug.json의 url>/act?do=activate&arg=it4` → 동작 후 상태(JSON). `do`는 `activate, move, close, toggleSel, split, untile, openAll, next, hideOthers, openTo, autoHide`.
