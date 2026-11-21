# 창 관리 도우미 규격 (맥·윈도우 공통)

실행기(`poc/runner/run.js`)는 OS별 도우미를 명령줄로 불러 JSON 한 줄을 받는다. 두 도우미는 아래 명령과 출력 형식을 똑같이 지킨다.

- 맥: `poc/mac-helper/.build/release/winctl <명령> [인자]`
- 윈도우: `node poc/win-helper/winctl.js <명령> [인자]`

모든 출력은 표준 출력의 **마지막 줄**에 JSON 객체 하나다. 실패하면 `{"ok": false, "error": "이유"}`를 출력하고 종료 코드 1로 끝낸다.

## 좌표 규칙
- 모든 좌표는 **화면 전체 기준, 왼쪽 위가 (0, 0)**이다. 주 모니터의 왼쪽 위가 (0, 0)이고, 다른 모니터는 음수일 수 있다.
- 한 도우미 안에서는 `displays`와 `list`·`move`가 **같은 단위**를 쓴다. 실행기는 같은 단위끼리만 비교한다.
  - 맥: 포인트 (Retina 배율이 이미 반영된 값)
  - 윈도우: 물리 픽셀. 도우미 프로세스를 Per-Monitor DPI Aware V2로 설정해, 배율이 다른 모니터에서도 좌표가 어긋나지 않게 한다. `scale`에는 그 모니터의 배율(예: 1.5)을 적는다.
- 실제 앱(Electron)에서는 이 값을 Electron 화면 좌표로 바꿔 쓴다 (윈도우 `screen.screenToDipRect`).

## 명령

### `trusted`
창을 다룰 권한이 있는지.
```json
{"ok": true, "trusted": true}
```
윈도우는 따로 권한이 없으므로 항상 `true`.

### `displays`
```json
{"ok": true, "displays": [
  {"index": 0, "id": 1, "name": "Color LCD", "primary": true, "builtin": true, "scale": 2,
   "x": 0, "y": 0, "width": 1512, "height": 982,
   "visible": {"x": 0, "y": 38, "width": 1512, "height": 944}}
]}
```
`visible`은 메뉴 막대·Dock·작업 표시줄을 뺀 영역. 창 배치는 이 영역을 쓴다.

### `list [--app <이름 일부>]`
보이는 일반 창 목록. `--app`은 프로그램 이름(맥: 앱 이름·번들 ID, 윈도우: 실행 파일 이름)에 포함되는 글자로 거른다.
```json
{"ok": true, "windows": [
  {"wid": 1234, "pid": 567, "app": "Google Chrome", "title": "수업 사이드바 시험 A",
   "x": 100, "y": 80, "width": 1200, "height": 800,
   "minimized": false, "fullscreen": false, "display": 1, "waiting": null},
  {"wid": 2345, "pid": 890, "app": "Microsoft Excel", "title": "모둠편성표",
   "...": "...", "waiting": {"wid": 2350, "title": ""}}
]}
```
- `wid`: 창 번호. 창이 살아 있는 동안 바뀌지 않아야 한다 (맥 CGWindowID, 윈도우 HWND).
- `display`: 창 가운데가 있는 모니터의 `index`.
- `waiting`: 그 창이 **답을 기다리는 창**(저장 여부·확인·로그인 같은 모달 창)에 막혀 있으면 `{wid, title}`, 아니면 `null`. 맨 앞 창이 아니어도 알려 준다. 창 번호를 못 읽으면 `wid`는 `null`일 수 있다. 이 창 자체는 보통 목록(`windows`)에 나오지 않는다 (윈도우: 소유된 창, 맥: 일반 창이 아님).
  - 윈도우: 바탕 창이 "사용 안 함"이 되면 그 창에 딸린 대화 상자 (`GW_ENABLEDPOPUP`·`GetLastActivePopup`)
  - 맥: 창에 붙은 시트(창의 자식, 역할 `AXSheet` — 엑셀 저장 확인), 또는 같은 프로그램의 모달 대화상자(하위 역할 `AXDialog`·`AXSystemDialog`, `AXModal` = 참, 최소화 아님 — 한글 저장 확인, 엣지 로그인 창). 모달 대화상자는 프로그램 전체를 막으므로 **그 프로그램의 모든 창**에 같은 값이 나온다. 최소화된 일반 창도 하위 역할이 `AXDialog`로 보이므로 최소화 여부로 구분한다.

### `front`
지금 맨 앞(포커스) 창.
```json
{"ok": true, "front": {"wid": 1234, "pid": 567, "app": "Google Chrome", "title": "…"}}
```
답을 기다리는 창이 맨 앞이면 `wid`는 목록에 나오는 바탕 창이고, 그 창은 `dialog: {wid, title}`로 함께 알린다 (맥은 시트가 붙으면 프로그램의 포커스 창이 시트가 되므로 바탕 창으로 바꿔 알린다).

### `raise <wid>`
창을 맨 앞으로 가져온다. 최소화돼 있으면 복원한다.
```json
{"ok": true, "front": {"wid": 1234, "...": "..."}, "detail": {"waiting": null, "...": "OS별 참고 정보"}}
```
`ok`는 실제로 그 창이 맨 앞이 됐는지로 판단한다 (답을 기다리는 창이 그 창에 딸려 맨 앞이면 성공).
답을 기다리는 창이 있으면 그 창도 함께 앞으로 와서 바로 답할 수 있게 한다 (윈도우는 OS가, 맥 한글처럼 프로그램 전체를 막는 대화상자는 도우미가 포커스를 준다). `detail.waiting`은 `list`의 `waiting`과 같다.

### `move <wid> <x> <y> <width> <height>`
창 위치와 크기를 바꾼다. 전체 화면·최대화 상태면 먼저 풀고 옮긴다.
```json
{"ok": true, "requested": {"x": 0, "y": 38, "width": 756, "height": 944},
 "actual": {"x": 0, "y": 38, "width": 756, "height": 944}}
```
`actual`은 옮긴 뒤 다시 읽은 값이다. 프로그램 최소 크기 때문에 다를 수 있다.

### `minimize <wid>`
```json
{"ok": true}
```

### `close <wid>`
정상 종료 요청만 보낸다 (맥: 닫기 버튼 누르기, 윈도우: `WM_CLOSE`). 강제 종료하지 않는다.
```json
{"ok": true}
```
`ok`는 요청이 전달됐는지다. 창이 실제로 닫혔는지는 `list`로 다시 본다. 바뀐 문서면 저장 여부를 묻는 창이 뜨고 창은 남는다 — 윈도우 엑셀은 **2.5초 넘게** 걸려 떴고 맥 엑셀·한글은 0.7초 걸렸다 (`node runner/modal.js`).

**부르는 쪽 주의**: `waiting`이 있는 창에는 닫기 요청을 또 보내지 않는다. 맥 한글은 저장 창이 떠 있어도 닫기 버튼이 눌려서 **저장 창이 하나 더 생기고**, 남은 저장 창은 문서가 닫힌 뒤에도 한글 전체를 막는다. 윈도우 엑셀·맥 엑셀은 무시된다.
