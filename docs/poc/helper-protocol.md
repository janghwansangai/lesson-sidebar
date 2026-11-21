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
   "minimized": false, "fullscreen": false, "display": 1}
]}
```
- `wid`: 창 번호. 창이 살아 있는 동안 바뀌지 않아야 한다 (맥 CGWindowID, 윈도우 HWND).
- `display`: 창 가운데가 있는 모니터의 `index`.

### `front`
지금 맨 앞(포커스) 창.
```json
{"ok": true, "front": {"wid": 1234, "pid": 567, "app": "Google Chrome", "title": "…"}}
```

### `raise <wid>`
창을 맨 앞으로 가져온다. 최소화돼 있으면 복원한다.
```json
{"ok": true, "front": {"wid": 1234, "...": "..."}, "detail": {"...": "OS별 참고 정보"}}
```
`ok`는 실제로 그 창이 맨 앞이 됐는지로 판단한다.

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

### 윈도우에만 있는 추가 명령
`maximize <wid>`, `closetab <wid> <파일 이름>`, `findtab <wid> <파일 이름>` (윈도우 11 메모장 탭) — 설명은 `poc/win-helper/README.md`. 체험판은 윈도우에서만 부르므로 맥 도우미에는 없어도 된다.
