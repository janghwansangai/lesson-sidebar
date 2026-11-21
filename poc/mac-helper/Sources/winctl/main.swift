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
}

func allWindows(appFilter: String?) -> [Win] {
    var out: [Win] = []
    for app in NSWorkspace.shared.runningApplications where app.activationPolicy == .regular {
        let name = app.localizedName ?? ""
        let bundle = app.bundleIdentifier ?? ""
        if let f = appFilter, !(name.localizedCaseInsensitiveContains(f) || bundle.localizedCaseInsensitiveContains(f)) { continue }
        let axApp = AXUIElementCreateApplication(app.processIdentifier)
        AXUIElementSetMessagingTimeout(axApp, 1.5)
        guard let v = copyValue(axApp, kAXWindowsAttribute), let arr = v as? [AXUIElement] else { continue }
        for w in arr {
            // 일반 창만 (도구 막대·팝업 제외). 단, 최소화된 창은 하위 역할이 AXDialog로 바뀌므로 함께 넣는다
            if let role = str(w, kAXSubroleAttribute), role != (kAXStandardWindowSubrole as String),
               bool(w, kAXMinimizedAttribute) != true { continue }
            guard let wid = windowID(w) else { continue }
            out.append(Win(wid: wid, pid: app.processIdentifier, app: name, bundle: bundle, el: w))
        }
    }
    return out
}

func frame(_ w: Win) -> CGRect {
    CGRect(origin: point(w.el) ?? .zero, size: size(w.el) ?? .zero)
}

func winJSON(_ w: Win, _ displays: [[String: Any]]) -> [String: Any] {
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
    return d
}

func frontInfo() -> [String: Any] {
    guard let app = NSWorkspace.shared.frontmostApplication else { return [:] }
    var info: [String: Any] = ["pid": Int(app.processIdentifier), "app": app.localizedName ?? ""]
    let axApp = AXUIElementCreateApplication(app.processIdentifier)
    if let w = element(axApp, kAXFocusedWindowAttribute) ?? element(axApp, kAXMainWindowAttribute) {
        if let wid = windowID(w) { info["wid"] = Int(wid) }
        info["title"] = str(w, kAXTitleAttribute) ?? ""
    }
    return info
}

func findWin(_ arg: String?) -> Win {
    guard let arg, let id = UInt32(arg) else { fail("창 번호(wid)가 필요합니다") }
    guard let w = allWindows(appFilter: nil).first(where: { $0.wid == id }) else { fail("창 \(id)을(를) 찾지 못했습니다") }
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
                       "axRaise": eRaise == .success, "nsActivate": activated]]
}

func move(_ w: Win, _ r: CGRect) -> [String: Any] {
    if bool(w.el, "AXFullScreen") == true {
        AXUIElementSetAttributeValue(w.el, "AXFullScreen" as CFString, kCFBooleanFalse)
        settle(1.0)
    }
    unminimize(w)
    var pos = r.origin, sz = r.size
    guard let pv = AXValueCreate(.cgPoint, &pos), let sv = AXValueCreate(.cgSize, &sz) else { fail("좌표 변환 실패") }
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
    return ["ok": e == .success]
}

// MARK: - 명령

let args = Array(CommandLine.arguments.dropFirst())
guard let cmd = args.first else {
    fail("사용법: winctl <trusted|displays|list|front|raise|move|minimize|close> ...")
}

switch cmd {
case "trusted":
    // --prompt: 권한이 없으면 macOS의 "손쉬운 사용 권한 요청" 창을 띄운다 (켜는 것은 사용자가 직접)
    if args.contains("--prompt") {
        let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
        emit(["ok": true, "trusted": AXIsProcessTrustedWithOptions([key: true] as CFDictionary)])
    } else {
        emit(["ok": true, "trusted": AXIsProcessTrusted()])
    }
case "displays":
    emit(["ok": true, "displays": displayList()])
case "list":
    var filter: String? = nil
    if let i = args.firstIndex(of: "--app"), i + 1 < args.count { filter = args[i + 1] }
    let ds = displayList()
    emit(["ok": true, "windows": allWindows(appFilter: filter).map { winJSON($0, ds) }])
case "front":
    emit(["ok": true, "front": frontInfo()])
case "raise":
    emit(raise(findWin(args.dropFirst().first)))
case "move":
    guard args.count >= 6, let x = Double(args[2]), let y = Double(args[3]),
          let w = Double(args[4]), let h = Double(args[5]) else { fail("사용법: winctl move <wid> <x> <y> <width> <height>") }
    emit(move(findWin(args[1]), CGRect(x: x, y: y, width: w, height: h)))
case "minimize":
    let w = findWin(args.dropFirst().first)
    let e = AXUIElementSetAttributeValue(w.el, kAXMinimizedAttribute as CFString, kCFBooleanTrue)
    emit(["ok": e == .success])
case "close":
    emit(close(findWin(args.dropFirst().first)))
case "watch":
    // 계속 실행하며 바뀐 것만 한 줄씩 알린다 (사이드바가 0.3초마다 새 프로세스를 띄우지 않도록)
    //   {"event":"front", "front":{...}}   맨 앞 창이 바뀔 때
    //   {"event":"alive", "wids":[...]}    1.5초마다 살아 있는 창 번호 목록
    setvbuf(stdout, nil, _IOLBF, 0)
    var lastFront = -1
    var tick = 0
    while true {
        let f = frontInfo()
        let wid = (f["wid"] as? Int) ?? 0
        if wid != lastFront {
            lastFront = wid
            emit(["event": "front", "front": f])
        }
        if tick % 5 == 0 {
            emit(["event": "alive", "wids": allWindows(appFilter: nil).map { Int($0.wid) }])
        }
        tick += 1
        settle(0.3)
    }
default:
    fail("모르는 명령: \(cmd)")
}
