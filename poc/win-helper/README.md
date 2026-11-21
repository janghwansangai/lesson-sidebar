# 윈도우 창 관리 도우미 (윈도우 Claude 담당)

`winctl.js`는 `docs/poc/helper-protocol.md` 규격을 그대로 지킨다. 맥 쪽 구현(`../mac-helper/Sources/winctl/main.swift`)과 명령·출력 모양이 같다 (`watch` 포함). 시험 결과는 `docs/poc/windows.md`.

## 실행 방법
```powershell
cd poc\win-helper
npm install                 # 처음 한 번 (koffi 설치)
node winctl.js displays     # 모니터 목록이 나오면 준비 끝
cd ..
node runner/run.js --browsers=chrome,edge,whale
node runner/raise-lock.js   # 앞으로 가져오기 제한 시험 (사람이 함께)
node runner/replug.js       # 외부 모니터 뺐다 꽂기 시험 (사람이 함께, 맥에서도 됨)
node runner/modal.js        # 저장 창이 떠 있을 때 닫기 시험 (자동, 엑셀)
node runner/elevated.js     # 관리자 권한 창 시험 (사람이 명령 프롬프트를 관리자로 열기)
```
- 맥 도우미와 다른 점: `list`의 창마다 `maximized`(최대화)와 `waiting`(답을 기다리는 저장·확인 창의 번호와 제목, 없으면 `null`)이 더 있고, `front`는 확인·저장 창이 앞에 있으면 `dialog`(그 창 번호와 제목)를 함께 준다. `raise`의 `detail.method`는 통한 방법(`direct`, `dummyInput`, `attachThreadInput`, 이미 앞이면 `already`).
- `app`은 실행 파일 이름(`chrome.exe`, `POWERPNT.EXE`, `Hwp.exe` 등)이다.

## 만든 것
- `poc/win-helper/package.json` (이 폴더 전용, 의존성: `koffi`) — 맥 쪽 `poc/package.json`에는 넣지 않는다
- `poc/win-helper/winctl.js` — `node winctl.js <명령> [인자]`로 실행, 마지막 줄에 JSON 한 줄 출력

## 쓸 윈도우 API (koffi로 user32·dwmapi·shcore 호출)
| 용도 | API |
|---|---|
| DPI 기준 맞추기 (가장 먼저) | `SetProcessDpiAwarenessContext(-4)` (PER_MONITOR_AWARE_V2) |
| 모니터 목록 | `EnumDisplayMonitors`, `GetMonitorInfoW`(작업 영역 = `visible`), `GetDpiForMonitor`(scale = dpi/96) |
| 창 목록 | `EnumWindows`, `IsWindowVisible`, `GetWindowTextW`, `GetWindowThreadProcessId`, `QueryFullProcessImageNameW`(프로그램 이름) |
| 일반 창만 거르기 | 제목 있음, `WS_EX_TOOLWINDOW` 아님, 소유자 창 없음(`GetWindow(GW_OWNER)`), 숨겨진 UWP 창 제외(`DwmGetWindowAttribute(DWMWA_CLOAKED=14)`) |
| 창 위치 | `DwmGetWindowAttribute(DWMWA_EXTENDED_FRAME_BOUNDS=9)` — 그림자를 뺀 실제 테두리 |
| 최소화·최대화 상태 | `IsIconic`, `IsZoomed` |
| 맨 앞으로 | `ShowWindow(SW_RESTORE=9)` 후 `SetForegroundWindow` |
| 맨 앞 창 | `GetForegroundWindow` |
| 옮기기 | 최대화면 `ShowWindow(SW_RESTORE)` → `SetWindowPos`. 그림자 테두리만큼 보정해 실제 테두리가 요청 위치에 오게 한다 |
| 최소화 | `ShowWindow(SW_MINIMIZE=6)` |
| 닫기 | `PostMessageW(hwnd, WM_CLOSE=0x10, 0, 0)` — 강제 종료 금지 |

## 꼭 확인할 것 (결과를 `docs/poc/windows.md`에)
1. **앞으로 가져오기 제한**: 윈도우는 맨 앞이 아닌 프로그램이 다른 창을 앞으로 가져오는 것을 막는다. 명령줄 도우미에서 `SetForegroundWindow`가 실패하면, 실제 앱에서는 사용자가 사이드바를 클릭한 직후라 허용되는지, 아니면 `AttachThreadInput`이나 Alt 키 신호 같은 보완이 필요한지 기록한다.
2. **창 제목 형식**: 한글(`Hwp.exe`), PowerPoint, Excel, 크롬·엣지·웨일이 실제로 어떤 제목을 쓰는지 (예: `파일명.hwp - 한글`).
3. **배율이 다른 모니터**: 노트북 150%·프로젝터 100%처럼 다를 때 옮긴 위치가 맞는지.
4. **브라우저가 꺼져 있을 때** `--new-window`로 열면 이전 창들이 함께 복원되는지.
5. 관리자 권한으로 실행된 프로그램 창은 옮길 수 없는지.

## 맥 검증에서 먼저 알게 된 것 (윈도우에서도 확인)
- 브라우저에는 `file://` 대신 실행기가 띄우는 `127.0.0.1` 주소로 시험 페이지를 넘긴다 (이미 실행기에 들어 있음). 학교 관리 브라우저가 `file://`을 막는지도 확인한다.
- 프로그램에 확인·로그인 창(모달)이 떠 있으면 닫기 요청이 무시됐다. 윈도우에서 `WM_CLOSE`도 같은지 기록한다.
- 브라우저 최소 폭(맥 500포인트) 때문에 7:3 분할이 최소 폭에서 멈춘다. 실행기가 자동으로 비율을 조정하니, 윈도우의 최소 폭 값을 기록한다.
- 브라우저 창 제목에 사용자 프로필 이름이 붙는다. 결과 기록(`docs/poc/windows.md`)에는 프로필 이름을 지우고 적는다.

## 실행기에서 고칠 곳
`poc/runner/run.js`의 `APPS`(윈도우 쪽 값), `openBrowserWindow`, `openFile`은 실제 PC에서 확인하지 않은 값이다. 맞게 고쳐서 PR에 함께 올린다.
