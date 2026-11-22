// 수업 사이드바 — 맥 창 관리 도우미 (0단계 기술 검증용)
// 규격: docs/poc/helper-protocol.md
// 접근성 API로 다른 프로그램 창을 찾고, 앞으로 가져오고, 옮기고, 닫는다.
// 실행하는 프로그램(터미널·Claude 앱 등)에 "손쉬운 사용" 권한이 있어야 한다.

import AppKit
import ApplicationServices

// AXUIElement → CGWindowID. 공개 API가 없어 창 관리 앱들이 널리 쓰는 비공개 함수를 쓴다.
@_silgen_name("_AXUIElementGetWindow")
func _AXUIElementGetWindow(_ element: AXUIElement, _ wid: UnsafeMutablePointer<CGWindowID>) -> AXError

// MARK: - 출력

func emit(_ obj: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys]),
       let s = String(data: data, encoding: .utf8) {
        print(s)
    } else {
        print("{\"ok\":false,\"error\":\"json\"}")
    }
}

func fail(_ msg: String) -> Never {
    emit(["ok": false, "error": msg])
    exit(1)
}

/// 명령 하나의 실패. 한 번 실행이면 출력하고 끝내고, 'serve'(계속 실행)면 답으로 돌려주고 다음 명령을 받는다.
struct HelperFail: Error { let msg: String }

func settle(_ seconds: Double) {
    RunLoop.current.run(until: Date().addingTimeInterval(seconds))
}

// MARK: - 접근성 값 읽기

func copyValue(_ el: AXUIElement, _ name: String) -> CFTypeRef? {
    var v: CFTypeRef?
    guard AXUIElementCopyAttributeValue(el, name as CFString, &v) == .success else { return nil }
    return v
}

func str(_ el: AXUIElement, _ name: String) -> String? { copyValue(el, name) as? String }
func bool(_ el: AXUIElement, _ name: String) -> Bool? { copyValue(el, name) as? Bool }

func element(_ el: AXUIElement, _ name: String) -> AXUIElement? {
    guard let v = copyValue(el, name), CFGetTypeID(v) == AXUIElementGetTypeID() else { return nil }
    return (v as! AXUIElement)
}

func point(_ el: AXUIElement) -> CGPoint? {
    guard let v = copyValue(el, kAXPositionAttribute), CFGetTypeID(v) == AXValueGetTypeID() else { return nil }
    var p = CGPoint.zero
    AXValueGetValue(v as! AXValue, .cgPoint, &p)
    return p
}

func size(_ el: AXUIElement) -> CGSize? {
    guard let v = copyValue(el, kAXSizeAttribute), CFGetTypeID(v) == AXValueGetTypeID() else { return nil }
    var s = CGSize.zero
    AXValueGetValue(v as! AXValue, .cgSize, &s)
    return s
}

func windowID(_ el: AXUIElement) -> CGWindowID? {
    var wid: CGWindowID = 0
    guard _AXUIElementGetWindow(el, &wid) == .success, wid != 0 else { return nil }
    return wid
}

func rectJSON(_ r: CGRect) -> [String: Any] {
    ["x": Double(r.origin.x), "y": Double(r.origin.y), "width": Double(r.size.width), "height": Double(r.size.height)]
}

// MARK: - 모니터

/// 화면마다 떠 있는 메뉴 막대 창의 위치 (CGWindow 좌표 = 왼쪽 위 기준).
/// NSScreen.visibleFrame이 주 모니터가 아닌 화면의 메뉴 막대를 빼 주지 않는 경우가 있어 직접 찾는다.
func menuBars() -> [CGRect] {
    let level = Int(CGWindowLevelForKey(.mainMenuWindow))
    guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] else { return [] }
    return list.compactMap { w in
        guard (w[kCGWindowLayer as String] as? Int) == level, let b = w[kCGWindowBounds as String] else { return nil }
        return CGRect(dictionaryRepresentation: b as! CFDictionary)
    }
}

/// 화면 좌표는 왼쪽 위가 (0,0)인 접근성 좌표계로 맞춘다 (NSScreen은 왼쪽 아래 기준).
func displayList() -> [[String: Any]] {
    let screens = NSScreen.screens
    guard let primary = screens.first else { return [] }
    let ph = primary.frame.height
    func flip(_ r: CGRect) -> CGRect { CGRect(x: r.minX, y: ph - r.maxY, width: r.width, height: r.height) }
    let bars = menuBars()
    return screens.enumerated().map { (i, sc) in
        let id = (sc.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value ?? 0
        let fr = flip(sc.frame)
        var vis = flip(sc.visibleFrame)
        var barHeight = 0.0
        if let bar = bars.first(where: { $0.intersects(fr) && abs($0.minY - fr.minY) < 1 }) {
            barHeight = Double(bar.height)
            let top = max(vis.minY, bar.maxY)
            vis = CGRect(x: vis.minX, y: top, width: vis.width, height: vis.maxY - top)
        }
        var d = rectJSON(fr)
        d["index"] = i
        d["id"] = Int(id)
        d["name"] = sc.localizedName
        d["primary"] = (i == 0)
        d["builtin"] = CGDisplayIsBuiltin(id) != 0
        d["scale"] = Double(sc.backingScaleFactor)
        d["menuBar"] = barHeight
        d["visible"] = rectJSON(vis)
        return d
    }
}

func displayIndex(of r: CGRect, in displays: [[String: Any]]) -> Int {
    let cx = r.midX, cy = r.midY
    for d in displays {
        let x = d["x"] as! Double, y = d["y"] as! Double, w = d["width"] as! Double, h = d["height"] as! Double
        if cx >= x && cx < x + w && cy >= y && cy < y + h { return d["index"] as! Int }
    }
    return -1
}

// MARK: - 창

struct Win {
    let wid: CGWindowID
    let pid: pid_t
    let app: String
    let bundle: String
    let el: AXUIElement
    /// 이 프로그램 전체를 막고 있는 모달 대화상자 (있으면)
    let appDialog: AXUIElement?
}

// MARK: - 답을 기다리는 창 (저장 여부·확인·로그인 등)
// 맥에서 확인한 모양 (docs/poc/mac.md):
//  - 저장 여부 시트: 창의 자식으로 역할 AXSheet가 붙는다 (엑셀). 바탕 창의 닫기 단추는 "사용 안 함"이 된다.
//  - 프로그램 전체를 막는 대화상자: 프로그램 창 목록에 하위 역할 AXDialog·AXSystemDialog, AXModal=true로 보인다 (엣지 로그인 창).
//  - 최소화된 일반 창도 하위 역할이 AXDialog로 바뀌므로 최소화 여부를 함께 본다.

func sheet(of win: AXUIElement) -> AXUIElement? {
    guard let v = copyValue(win, kAXChildrenAttribute), let kids = v as? [AXUIElement] else { return nil }
    return kids.first { str($0, kAXRoleAttribute) == "AXSheet" }
}

func isModalDialog(_ w: AXUIElement) -> Bool {
    guard let sub = str(w, kAXSubroleAttribute),
          sub == (kAXDialogSubrole as String) || sub == (kAXSystemDialogSubrole as String) else { return false }
    return bool(w, kAXModalAttribute) == true && bool(w, kAXMinimizedAttribute) != true
}

/// 규격의 waiting 모양 {wid, title}. 창 번호를 못 읽으면 wid는 null.
func waitingJSON(_ el: AXUIElement) -> [String: Any] {
    ["wid": windowID(el).map { Int($0) as Any } ?? NSNull(), "title": str(el, kAXTitleAttribute) ?? ""]
}

/// 그 창에 답을 기다리는 창이 있으면 {wid, title}, 없으면 null(NSNull).
func waitingFor(_ w: Win) -> Any {
    if let s = sheet(of: w.el) { return waitingJSON(s) }
    if let d = w.appDialog { return waitingJSON(d) }
    return NSNull()
}

func allWindows(appFilter: String?, onlyPid: pid_t? = nil) -> [Win] {
    var out: [Win] = []
    for app in NSWorkspace.shared.runningApplications where app.activationPolicy == .regular {
        if let p = onlyPid, app.processIdentifier != p { continue }
        let name = app.localizedName ?? ""
        let bundle = app.bundleIdentifier ?? ""
        if let f = appFilter, !(name.localizedCaseInsensitiveContains(f) || bundle.localizedCaseInsensitiveContains(f)) { continue }
        let axApp = AXUIElementCreateApplication(app.processIdentifier)
        AXUIElementSetMessagingTimeout(axApp, 1.5)
        guard let v = copyValue(axApp, kAXWindowsAttribute), let arr = v as? [AXUIElement] else { continue }
        var keep: [AXUIElement] = []
        var dialog: AXUIElement? = nil
        for w in arr {
            // 말풍선 도움말(AXHelpTag) 같은 것은 하위 역할이 없어 아래 거르기를 지나가므로 역할부터 본다 (한글에서 확인)
            if str(w, kAXRoleAttribute) != (kAXWindowRole as String) { continue }
            // 일반 창만 (도구 막대·팝업 제외). 단, 최소화된 창은 하위 역할이 AXDialog로 바뀌므로 함께 넣는다
            if let role = str(w, kAXSubroleAttribute), role != (kAXStandardWindowSubrole as String),
               bool(w, kAXMinimizedAttribute) != true {
                if dialog == nil && isModalDialog(w) { dialog = w }
                continue
            }
            keep.append(w)
        }
        for w in keep {
            guard let wid = windowID(w) else { continue }
            out.append(Win(wid: wid, pid: app.processIdentifier, app: name, bundle: bundle, el: w, appDialog: dialog))
        }
    }
    return out
}

func frame(_ w: Win) -> CGRect {
    CGRect(origin: point(w.el) ?? .zero, size: size(w.el) ?? .zero)
}

/// 창 앞뒤 순서 (0이 맨 앞). 화면에 있는 창 목록(CGWindowList)은 앞에서 뒤 순서로 나온다.
/// 가려진 창을 따로 찍어 쌓을 때 쓴다 (학생 화면 정지 중 미리보기, docs/poc/mac.md 41)
func zOrderMap() -> [CGWindowID: Int] {
    var m: [CGWindowID: Int] = [:]
    let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    for (i, w) in list.enumerated() { if let n = w[kCGWindowNumber as String] as? Int { m[CGWindowID(n)] = i } }
    return m
}

func winJSON(_ w: Win, _ displays: [[String: Any]], _ zOrder: [CGWindowID: Int]) -> [String: Any] {
    let f = frame(w)
    var d = rectJSON(f)
    d["wid"] = Int(w.wid)
    d["pid"] = Int(w.pid)
    d["app"] = w.app
    d["bundle"] = w.bundle
    d["title"] = str(w.el, kAXTitleAttribute) ?? ""
    d["minimized"] = bool(w.el, kAXMinimizedAttribute) ?? false
    // 맥 전체 화면(초록 단추)뿐 아니라, 파워포인트 슬라이드 쇼처럼 메뉴 막대까지 화면 전체를 덮는 창도 전체 화면으로 본다
    // (윈도우 도우미와 같은 기준. 사이드바의 "창 비키기"가 슬라이드 쇼를 옮기지 않게)
    let coversDisplay = displays.contains { d in
        let x = d["x"] as! Double, y = d["y"] as! Double, dw = d["width"] as! Double, dh = d["height"] as! Double
        return Double(f.minX) <= x + 1 && Double(f.minY) <= y + 1 && Double(f.maxX) >= x + dw - 1 && Double(f.maxY) >= y + dh - 1
    }
    d["fullscreen"] = (bool(w.el, "AXFullScreen") ?? false) || coversDisplay
    d["display"] = displayIndex(of: f, in: displays)
    d["waiting"] = waitingFor(w)
    if let z = zOrder[w.wid] { d["z"] = z }
    return d
}

func frontInfo() -> [String: Any] {
    guard let app = NSWorkspace.shared.frontmostApplication else { return [:] }
    var info: [String: Any] = ["pid": Int(app.processIdentifier), "app": app.localizedName ?? ""]
    let axApp = AXUIElementCreateApplication(app.processIdentifier)
    guard var w = element(axApp, kAXFocusedWindowAttribute) ?? element(axApp, kAXMainWindowAttribute) else { return info }
    // 답을 기다리는 창이 맨 앞이면 (시트가 붙으면 프로그램의 포커스 창이 시트가 된다)
    // 목록에 나오는 바탕 창을 알리고, 그 창은 dialog로 함께 알린다 (윈도우 도우미와 같은 모양)
    var dialog: AXUIElement? = nil
    if str(w, kAXRoleAttribute) == "AXSheet", let p = element(w, kAXParentAttribute) {
        dialog = w; w = p
    } else if isModalDialog(w), let m = element(axApp, kAXMainWindowAttribute), windowID(m) != windowID(w) {
        dialog = w; w = m
    }
    if let wid = windowID(w) { info["wid"] = Int(wid) }
    info["title"] = str(w, kAXTitleAttribute) ?? ""
    if let d = dialog { info["dialog"] = waitingJSON(d) }
    return info
}

/// 창 번호의 주인 프로그램 (창 목록 서버에 묻기 — 다른 프로그램을 깨우지 않아 빠르다)
func ownerPid(_ wid: CGWindowID) -> pid_t? {
    guard let list = CGWindowListCopyWindowInfo([.optionIncludingWindow], wid) as? [[String: Any]],
          let p = list.first?[kCGWindowOwnerPID as String] as? Int else { return nil }
    return pid_t(p)
}

/// 창 번호로 창 찾기. 주인 프로그램 하나만 먼저 보고, 없으면 전체를 본다
/// (전에는 늘 모든 프로그램에 물어 0.5초 넘게 걸리고, 응답이 느린 프로그램이 있으면 더 늦었다)
func findWin(_ arg: String?) throws -> Win {
    guard let arg, let id = UInt32(arg) else { throw HelperFail(msg: "창 번호(wid)가 필요합니다") }
    if let p = ownerPid(id), let w = allWindows(appFilter: nil, onlyPid: p).first(where: { $0.wid == id }) { return w }
    guard let w = allWindows(appFilter: nil).first(where: { $0.wid == id }) else { throw HelperFail(msg: "창 \(id)을(를) 찾지 못했습니다") }
    return w
}

func unminimize(_ w: Win) {
    if bool(w.el, kAXMinimizedAttribute) == true {
        AXUIElementSetAttributeValue(w.el, kAXMinimizedAttribute as CFString, kCFBooleanFalse)
        settle(0.3)
    }
}

func raise(_ w: Win) -> [String: Any] {
    let t0 = Date()
    unminimize(w)
    let axApp = AXUIElementCreateApplication(w.pid)
    let eFront = AXUIElementSetAttributeValue(axApp, kAXFrontmostAttribute as CFString, kCFBooleanTrue)
    let eMain = AXUIElementSetAttributeValue(w.el, kAXMainAttribute as CFString, kCFBooleanTrue)
    let eRaise = AXUIElementPerformAction(w.el, kAXRaiseAction as CFString)
    var activated = false
    if let app = NSRunningApplication(processIdentifier: w.pid) { activated = app.activate(options: []) }
    // 프로그램 전체를 막는 대화상자가 있으면 그 창에 포커스를 준다.
    // 한글은 바탕 창을 앞으로 가져오면 포커스가 저장 대화상자에서 바탕 창으로 옮겨 간다. 시트는 바탕 창을 따라온다.
    var dialogFocused: Any = NSNull()
    if sheet(of: w.el) == nil, let d = w.appDialog {
        AXUIElementPerformAction(d, kAXRaiseAction as CFString)
        dialogFocused = AXUIElementSetAttributeValue(d, kAXFocusedAttribute as CFString, kCFBooleanTrue) == .success
    }
    var front: [String: Any] = [:]
    // 앞 창이 바뀔 때까지 최대 1.5초 기다린다
    for _ in 0..<15 {
        settle(0.1)
        front = frontInfo()
        if (front["wid"] as? Int) == Int(w.wid) { break }
    }
    let ok = (front["wid"] as? Int) == Int(w.wid)
    return ["ok": ok, "front": front, "ms": Int(Date().timeIntervalSince(t0) * 1000),
            "detail": ["axFrontmost": eFront == .success, "axMain": eMain == .success,
                       "axRaise": eRaise == .success, "nsActivate": activated,
                       "dialogFocused": dialogFocused,
                       "waiting": waitingFor(w)]]
}

func move(_ w: Win, _ r: CGRect) throws -> [String: Any] {
    if bool(w.el, "AXFullScreen") == true {
        AXUIElementSetAttributeValue(w.el, "AXFullScreen" as CFString, kCFBooleanFalse)
        settle(1.0)
    }
    unminimize(w)
    var pos = r.origin, sz = r.size
    guard let pv = AXValueCreate(.cgPoint, &pos), let sv = AXValueCreate(.cgSize, &sz) else { throw HelperFail(msg: "좌표 변환 실패") }
    // 다른 모니터로 옮길 때 크기 제한에 걸리지 않도록 크기 → 위치 → 크기 순서로 지정한다
    AXUIElementSetAttributeValue(w.el, kAXSizeAttribute as CFString, sv)
    let ePos = AXUIElementSetAttributeValue(w.el, kAXPositionAttribute as CFString, pv)
    let eSize = AXUIElementSetAttributeValue(w.el, kAXSizeAttribute as CFString, sv)
    settle(0.25)
    return ["ok": ePos == .success && eSize == .success, "requested": rectJSON(r), "actual": rectJSON(frame(w))]
}

func close(_ w: Win) -> [String: Any] {
    guard let btn = element(w.el, kAXCloseButtonAttribute) else { return ["ok": false, "error": "닫기 버튼이 없습니다"] }
    let e = AXUIElementPerformAction(btn, kAXPressAction as CFString)
    if e == .success { return ["ok": true] }
    // 한글은 바뀐 문서를 닫을 때 저장 대화상자를 띄우느라 2초쯤 늦게 오류로 답한다 (요청은 전달됨).
    // 창이 닫혔거나 답을 기다리는 창이 떴으면 전달된 것으로 본다.
    let again = allWindows(appFilter: w.bundle.isEmpty ? w.app : w.bundle).first { $0.wid == w.wid }
    if let a = again, waitingFor(a) is NSNull {
        return ["ok": false, "error": "닫기 요청을 보내지 못했습니다 (접근성 오류 \(e.rawValue))"]
    }
    return ["ok": true, "detail": ["axError": Int(e.rawValue), "closed": again == nil]]
}

// MARK: - 명령

var clickTap: CFMachPort? = nil   // 'clicks' 감시 (시간 초과로 꺼지면 다시 켜려고 들고 있음)


/// 창 목록 서버에서 본 보통 창들의 (번호, 화면에 있는지). 프로그램들에 묻지 않아(접근성 아님) 싸다.
/// 'watch'가 이것이 바뀌었을 때만 프로그램마다 묻는 전체 목록을 다시 만든다.
func cgWindowSignature() -> [Int] {
    guard let list = CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return [] }
    var out: [Int] = []
    for w in list {
        guard (w[kCGWindowLayer as String] as? Int) == 0, let n = w[kCGWindowNumber as String] as? Int else { continue }
        out.append(n * 2 + (((w[kCGWindowIsOnscreen as String] as? Bool) ?? false) ? 1 : 0))
    }
    return out.sorted()
}

/// 맨 앞 프로그램과 그 프로그램의 맨 위 창 번호. 바뀌었을 때만 접근성으로 맨 앞 창을 자세히 본다.
func frontSignature() -> [Int] {
    guard let app = NSWorkspace.shared.frontmostApplication else { return [] }
    let pid = Int(app.processIdentifier)
    let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    let top = list.first { ($0[kCGWindowOwnerPID as String] as? Int) == pid && ($0[kCGWindowLayer as String] as? Int) == 0 }
    return [pid, (top?[kCGWindowNumber as String] as? Int) ?? 0]
}

/// 한 번에 답하는 명령 (한 번 실행과 'serve'가 함께 쓴다)
func run(_ args: [String]) throws -> [String: Any] {
    switch args.first ?? "" {
    case "trusted":
        // --prompt: 권한이 없으면 macOS의 "손쉬운 사용 권한 요청" 창을 띄운다 (켜는 것은 사용자가 직접)
        if args.contains("--prompt") {
            let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
            return ["ok": true, "trusted": AXIsProcessTrustedWithOptions([key: true] as CFDictionary)]
        }
        return ["ok": true, "trusted": AXIsProcessTrusted()]
    case "displays":
        return ["ok": true, "displays": displayList()]
    case "list":
        var filter: String? = nil
        if let i = args.firstIndex(of: "--app"), i + 1 < args.count { filter = args[i + 1] }
        let ds = displayList(), z = zOrderMap()
        return ["ok": true, "windows": allWindows(appFilter: filter).map { winJSON($0, ds, z) }]
    case "front":
        return ["ok": true, "front": frontInfo()]
    case "raise":
        return raise(try findWin(args.dropFirst().first))
    case "move":
        guard args.count >= 6, let x = Double(args[2]), let y = Double(args[3]),
              let w = Double(args[4]), let h = Double(args[5]) else { throw HelperFail(msg: "사용법: winctl move <wid> <x> <y> <width> <height>") }
        return try move(try findWin(args[1]), CGRect(x: x, y: y, width: w, height: h))
    case "minimize":
        let w = try findWin(args.dropFirst().first)
        let e = AXUIElementSetAttributeValue(w.el, kAXMinimizedAttribute as CFString, kCFBooleanTrue)
        return ["ok": e == .success]
    case "close":
        return close(try findWin(args.dropFirst().first))
    default:
        throw HelperFail(msg: "모르는 명령: \(args.first ?? "")")
    }
}

let args = Array(CommandLine.arguments.dropFirst())
guard let cmd = args.first else {
    fail("사용법: winctl <trusted|displays|list|front|raise|move|minimize|close|watch|clicks|serve> ...")
}

switch cmd {
case "serve":
    // 계속 실행하며 명령을 한 줄씩 받는다: 받는 줄 = 인자 배열 JSON (["raise","123"]), 답 = 한 번 실행과 같은 JSON 한 줄.
    // 명령마다 새 프로세스를 띄우면 시작에만 0.3초쯤 걸려서 (AppKit 읽기), 사이드바가 이것 하나를 켜 두고 쓴다.
    // 처음에 {"ok":true,"serve":1}을 알린다 (이 줄이 없으면 사이드바는 예전처럼 명령마다 실행한다). 입력이 끝나면 끝난다.
    setvbuf(stdout, nil, _IOLBF, 0)
    emit(["ok": true, "serve": 1])
    Thread {
        while let line = readLine() {
            // 명령은 메인 스레드에서 하나씩 (메인은 실행 고리를 돌려 프로그램 목록·맨 앞 프로그램이 새로 고쳐진다)
            DispatchQueue.main.sync {
                var res: [String: Any]
                if let d = line.data(using: .utf8), let a = (try? JSONSerialization.jsonObject(with: d)) as? [Any] {
                    do { res = try run(a.map { "\($0)" }) }
                    catch let f as HelperFail { res = ["ok": false, "error": f.msg] }
                    catch { res = ["ok": false, "error": "\(error)"] }
                } else { res = ["ok": false, "error": "명령을 읽지 못했습니다"] }
                emit(res)
            }
        }
        exit(0)
    }.start()
    _ = Timer.scheduledTimer(withTimeInterval: 3600, repeats: true) { _ in }
    RunLoop.main.run()
case "watch":
    // 계속 실행하며 바뀐 것만 한 줄씩 알린다 (사이드바가 0.3초마다 새 프로세스를 띄우지 않도록)
    //   {"event":"front", "front":{...}}   맨 앞 창이 바뀔 때
    //   {"event":"alive", "wids":[...]}    살아 있는 창 번호 목록 — 창이 생기거나 닫히거나 숨으면, 그리고 6초마다
    // 0.3초마다 창 목록 서버(싸다)만 보고, 바뀌었을 때만 프로그램마다 접근성으로 묻는다.
    // (전에는 0.3초마다 맨 앞 프로그램에, 1.5초마다 모든 프로그램에 물어 다른 프로그램들까지 계속 깨웠다)
    setvbuf(stdout, nil, _IOLBF, 0)
    var lastFront = -1, lastFrontSig: [Int] = [], lastFrontAt = Date.distantPast
    var lastCG: [Int] = [], lastScanAt = Date.distantPast, recheck = false
    var tick = 0
    while true {
        let fs = frontSignature()
        if fs != lastFrontSig || Date().timeIntervalSince(lastFrontAt) >= 1.5 {
            lastFrontSig = fs; lastFrontAt = Date()
            let f = frontInfo()
            let wid = (f["wid"] as? Int) ?? 0
            if wid != lastFront {
                lastFront = wid
                emit(["event": "front", "front": f])
            }
        }
        if tick % 5 == 0 {
            let sig = cgWindowSignature()
            // 바뀐 직후 한 번 더 본다 (닫는 중인 창이 접근성 목록에서 조금 늦게 빠지는 프로그램이 있어서)
            if sig != lastCG || recheck || Date().timeIntervalSince(lastScanAt) >= 6 {
                recheck = sig != lastCG
                lastCG = sig; lastScanAt = Date()
                emit(["event": "alive", "wids": allWindows(appFilter: nil).map { Int($0.wid) }])
            }
        }
        tick += 1
        settle(0.3)
    }
case "clicks":
    // 계속 실행하며 마우스를 누를 때마다 한 줄씩 알린다 (포인터 강조의 클릭 물결용)
    //   {"event":"ready"}                                  감시를 시작함
    //   {"event":"click","x":..,"y":..,"button":"left"}   누른 자리 (displays와 같은 좌표: 주 화면 왼쪽 위 기준 포인트)
    // 듣기만 하는 감시라 클릭은 그대로 원래 프로그램에 간다. 키보드는 보지 않는다.
    setvbuf(stdout, nil, _IOLBF, 0)
    let mask = CGEventMask((1 << CGEventType.leftMouseDown.rawValue) | (1 << CGEventType.rightMouseDown.rawValue))
    let callback: CGEventTapCallBack = { _, type, event, _ in
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            if let t = clickTap { CGEvent.tapEnable(tap: t, enable: true) }
            return Unmanaged.passUnretained(event)
        }
        let p = event.location
        emit(["event": "click", "x": Double(p.x), "y": Double(p.y), "button": type == .rightMouseDown ? "right" : "left"])
        return Unmanaged.passUnretained(event)
    }
    guard let tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .tailAppendEventTap, options: .listenOnly,
                                      eventsOfInterest: mask, callback: callback, userInfo: nil) else {
        fail("클릭 감시를 시작하지 못했습니다 (손쉬운 사용 권한 확인)")
    }
    clickTap = tap
    CFRunLoopAddSource(CFRunLoopGetCurrent(), CFMachPortCreateRunLoopSource(nil, tap, 0), .commonModes)
    CGEvent.tapEnable(tap: tap, enable: true)
    emit(["event": "ready"])
    CFRunLoopRun()
default:
    do { emit(try run(args)) }
    catch let f as HelperFail { fail(f.msg) }
    catch { fail("\(error)") }
}
