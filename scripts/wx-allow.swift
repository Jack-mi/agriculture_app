// 点掉微信开发者工具的「MCP 客户端授权」弹窗。
//
// 两条路：
//  1) 原生 AX：先给 app 打开 a11y（Chromium 默认不建树），找到含「请求」文案窗口里标题为「允许」的按钮并 AXPress；
//  2) 坐标兜底：这个版本弹窗的 a11y 树经常是空的，那就按固定几何点右下角的「允许」
//     （弹窗居中 400x240，按钮在右下；横向固定落在「允许」内部，纵向连点几个候选 y，
//      纵向点空是无害的，横向偏左才可能误触「拒绝」，所以 x 用实测偏移）。
// 只处理「无标题 + 中小尺寸」的窗口，不碰项目主窗口。
//
// 用法: wx-allow [等待秒数]      退出码: 0 = 点过了；1 = 没找到

import ApplicationServices
import AppKit
import Foundation

let DEBUG = ProcessInfo.processInfo.environment["WX_ALLOW_DEBUG"] != nil
func dlog(_ s: String) {
    if DEBUG { print(String(format: "%.3f ", Date().timeIntervalSince1970) + s) }
}

func attr(_ el: AXUIElement, _ name: String) -> CFTypeRef? {
    var v: CFTypeRef?
    guard AXUIElementCopyAttributeValue(el, name as CFString, &v) == .success else { return nil }
    return v
}

func text(_ el: AXUIElement, _ name: String) -> String {
    return (attr(el, name) as? String) ?? ""
}

func kids(_ el: AXUIElement) -> [AXUIElement] {
    return (attr(el, kAXChildrenAttribute as String) as? [AXUIElement]) ?? []
}

func frame(_ el: AXUIElement) -> CGRect? {
    guard let p = attr(el, kAXPositionAttribute as String),
          let s = attr(el, kAXSizeAttribute as String) else { return nil }
    var origin = CGPoint.zero
    var size = CGSize.zero
    guard AXValueGetValue(p as! AXValue, .cgPoint, &origin),
          AXValueGetValue(s as! AXValue, .cgSize, &size) else { return nil }
    return CGRect(origin: origin, size: size)
}

func scan(_ el: AXUIElement, depth: Int, hasRequest: inout Bool, button: inout AXUIElement?) {
    if depth > 8 { return }
    let role = text(el, kAXRoleAttribute as String)
    if role == "AXStaticText" || role == "AXHeading" {
        let v = text(el, kAXValueAttribute as String) + text(el, kAXTitleAttribute as String)
        if v.contains("请求") { hasRequest = true }
    }
    if role == "AXButton" {
        let t = text(el, kAXTitleAttribute as String)
        let d = text(el, kAXDescriptionAttribute as String)
        if t == "允许" || d == "允许" { button = el }
    }
    for c in kids(el) { scan(c, depth: depth + 1, hasRequest: &hasRequest, button: &button) }
}

func devtoolPids() -> [pid_t] {
    return NSWorkspace.shared.runningApplications
        .filter { ($0.executableURL?.path.contains("wechatwebdevtools") ?? false) && $0.activationPolicy == .regular }
        .map { $0.processIdentifier }
}

// Chromium 只在「检测到辅助功能客户端」时才建 a11y 树
func enableA11y(_ app: AXUIElement) {
    AXUIElementSetAttributeValue(app, "AXManualAccessibility" as CFString, kCFBooleanTrue)
    AXUIElementSetAttributeValue(app, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)
}

func post(_ type: CGEventType, _ pt: CGPoint, _ src: CGEventSource?) {
    CGEvent(mouseEventSource: src, mouseType: type, mouseCursorPosition: pt, mouseButton: .left)?.post(tap: .cghidEventTap)
}

func click(_ pt: CGPoint) {
    let src = CGEventSource(stateID: .hidSystemState)
    post(.mouseMoved, pt, src)
    usleep(30_000)
    post(.leftMouseDown, pt, src)
    usleep(30_000)
    post(.leftMouseUp, pt, src)
}

// 弹窗几何是算得出来的：modal-bd padding 20/30 + ui-button 高 22、右对齐
// →「允许」中心距窗口右边 67、距下边 36（AX 实测按钮中心就在 997,643，窗口 664,439 400x240）
// 纵向多给几个候选（弹窗还有 200/260/300 高的变体），点空只会落在弹窗内的空白/说明区，不会误触别的按钮
func sweepAllow(_ win: CGRect) -> String {
    let x = win.maxX - 67
    let ys = [win.maxY - 36, win.maxY - 31, win.maxY - 53, win.maxY - 75]
    for y in ys {
        click(CGPoint(x: x, y: y))
        usleep(120_000)
    }
    return "clicked 允许 by 坐标 x=\(Int(x)) y=\(ys.map { Int($0) })"
}

enum Found {
    case button(AXUIElement, CGRect, CGRect?)   // 按钮、窗口、按钮框
    case dialog(CGRect)                          // 树是空的，只能按坐标
}

func findDialog() -> Found? {
    for pid in devtoolPids() {
        let app = AXUIElementCreateApplication(pid)
        enableA11y(app)
        for w in (attr(app, kAXWindowsAttribute as String) as? [AXUIElement]) ?? [] {
            guard let f = frame(w) else { continue }
            if f.width > 700 || f.height > 500 { continue }           // 项目主窗口：跳过（那棵 AX 树上千节点）
            var hasRequest = false
            var button: AXUIElement?
            scan(w, depth: 0, hasRequest: &hasRequest, button: &button)
            if hasRequest, let b = button { return .button(b, f, frame(b)) }
            dlog("窗口 \(Int(f.width))x\(Int(f.height)) @ \(Int(f.minX)),\(Int(f.minY)) title=[\(text(w, kAXTitleAttribute as String))] 请求=\(hasRequest)")
            if button == nil, f.width >= 300, f.height >= 150, text(w, kAXTitleAttribute as String).isEmpty {
                return .dialog(f)
            }
        }
    }
    return nil
}

let timeout = Double(CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "8") ?? 8
let deadline = Date().addingTimeInterval(timeout)
var lastSweep: Date?
var swept = false

while Date() < deadline {
    if devtoolPids().isEmpty {
        FileHandle.standardError.write("没在跑微信开发者工具\n".data(using: .utf8)!)
        exit(1)
    }
    switch findDialog() {
    case .button(let b, let wf, let bf):
        let r = AXUIElementPerformAction(b, kAXPressAction as CFString)
        print("clicked 允许 by AX @ \(bf.map { "\(Int($0.midX)),\(Int($0.midY))" } ?? "?") (窗口 \(Int(wf.width))x\(Int(wf.height)) @ \(Int(wf.minX)),\(Int(wf.minY))) result=\(r.rawValue)")
        exit(r == .success ? 0 : 1)
    case .dialog(let f):
        let now = Date()
        if !swept || now.timeIntervalSince(lastSweep!) > 1.2 {
            swept = true
            dlog("弹窗无 a11y 内容，按坐标点：\(Int(f.width))x\(Int(f.height)) @ \(Int(f.minX)),\(Int(f.minY))")
            lastSweep = now
            print(sweepAllow(f))
        }
    case nil:
        if swept {
            print("clicked 允许（弹窗已消失）")
            exit(0)
        }
        break
    }
    usleep(150_000)
}

print("没找到弹窗")
exit(1)
