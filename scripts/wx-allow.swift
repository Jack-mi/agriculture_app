// 点掉微信开发者工具的「MCP 客户端授权」弹窗：找到标题为「允许」的按钮并按下去。
// 只在包含「请求」文案的窗口里点，避免误触其它对话框。
// 用法: swift scripts/wx-allow.swift [等待秒数]
// 退出码: 0 = 已点；1 = 没找到；2 = 没有辅助功能权限

import ApplicationServices
import AppKit
import Foundation

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

struct Hit {
    var button: AXUIElement
    var window: CGRect
    var buttonFrame: CGRect?
}

// 深度优先：找窗口里是否有「请求」文案、是否有叫「允许」的按钮
func scan(_ el: AXUIElement, depth: Int, hasRequest: inout Bool, button: inout AXUIElement?) {
    if depth > 12 { return }
    let role = text(el, kAXRoleAttribute as String)
    if role == "AXStaticText" || role == "AXHeading" {
        let v = text(el, kAXValueAttribute as String) + text(el, kAXTitleAttribute as String)
        if v.contains("请求") { hasRequest = true }
    }
    if role == "AXButton" {
        let title = text(el, kAXTitleAttribute as String)
        let desc = text(el, kAXDescriptionAttribute as String)
        if title == "允许" || desc == "允许" { button = el }
    }
    for c in kids(el) { scan(c, depth: depth + 1, hasRequest: &hasRequest, button: &button) }
}

func devtoolPids() -> [pid_t] {
    return NSWorkspace.shared.runningApplications
        .filter { ($0.executableURL?.path.contains("wechatwebdevtools") ?? false) && $0.activationPolicy == .regular }
        .map { $0.processIdentifier }
}

func findAllow() -> Hit? {
    for pid in devtoolPids() {
        let app = AXUIElementCreateApplication(pid)
        let wins = (attr(app, kAXWindowsAttribute as String) as? [AXUIElement]) ?? []
        for w in wins {
            var hasRequest = false
            var button: AXUIElement?
            scan(w, depth: 0, hasRequest: &hasRequest, button: &button)
            if ProcessInfo.processInfo.environment["WX_ALLOW_DEBUG"] != nil {
                let f = frame(w).map { "\(Int($0.width))x\(Int($0.height)) @ \(Int($0.minX)),\(Int($0.minY))" } ?? "?"
                let n = text(w, kAXTitleAttribute as String)
                let sub = text(w, kAXSubroleAttribute as String)
                FileHandle.standardError.write("窗口 pid=\(pid) title=[\(n)] subrole=\(sub) \(f) 请求=\(hasRequest) 允许=\(button != nil)\n".data(using: .utf8)!)
            }
            if hasRequest, let b = button, let wf = frame(w) {
                return Hit(button: b, window: wf, buttonFrame: frame(b))
            }
        }
    }
    return nil
}

let waitSeconds = Double(CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "8") ?? 8
let deadline = Date().addingTimeInterval(waitSeconds)

var trusted = false
if let check = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: false] as CFDictionary) as Bool? {
    trusted = check
}

while Date() < deadline {
    if devtoolPids().isEmpty {
        FileHandle.standardError.write("未找到正在运行的微信开发者工具\n".data(using: .utf8)!)
        exit(1)
    }
    if let hit = findAllow() {
        let r = AXUIElementPerformAction(hit.button, kAXPressAction as CFString)
        let f = hit.buttonFrame.map { "\(Int($0.midX)),\(Int($0.midY))" } ?? "?"
        print("clicked 允许 @ \(f) (窗口 \(Int(hit.window.width))x\(Int(hit.window.height)) @ \(Int(hit.window.minX)),\(Int(hit.window.minY))) result=\(r.rawValue)")
        exit(r == .success ? 0 : 1)
    }
    usleep(200_000)
}

print(trusted ? "没找到弹窗" : "没找到弹窗（辅助功能权限未授予）")
exit(1)
