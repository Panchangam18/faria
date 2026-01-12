#!/usr/bin/env swift
//
// ax-extract.swift
// Native macOS accessibility extractor for Faria
//
// Extracts clickable elements and text from the frontmost application
// Outputs clean JSON to stdout
//

import Cocoa
import Foundation

// MARK: - Data Structures

struct Element: Codable {
    let id: Int
    let role: String
    let label: String?
    let value: String?
    let rect: Rect?
    let enabled: Bool
    let focused: Bool
}

struct Rect: Codable {
    let x: Int
    let y: Int
    let w: Int
    let h: Int
}

struct ExtractionResult: Codable {
    let success: Bool
    let app: String
    let bundleId: String?
    let windowTitle: String?
    let focusedElement: Element?
    let elements: [Element]
    let error: String?
}

// MARK: - Accessibility Helpers

func getAXValue<T>(_ element: AXUIElement, _ attribute: String) -> T? {
    var value: AnyObject?
    let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
    guard result == .success else { return nil }
    return value as? T
}

func getPosition(_ element: AXUIElement) -> CGPoint? {
    var position: AnyObject?
    guard AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &position) == .success,
          let positionValue = position else { return nil }

    var point = CGPoint.zero
    guard AXValueGetValue(positionValue as! AXValue, .cgPoint, &point) else { return nil }
    return point
}

func getSize(_ element: AXUIElement) -> CGSize? {
    var size: AnyObject?
    guard AXUIElementCopyAttributeValue(element, kAXSizeAttribute as CFString, &size) == .success,
          let sizeValue = size else { return nil }

    var cgSize = CGSize.zero
    guard AXValueGetValue(sizeValue as! AXValue, .cgSize, &cgSize) else { return nil }
    return cgSize
}

func getRect(_ element: AXUIElement) -> Rect? {
    guard let pos = getPosition(element), let size = getSize(element) else { return nil }
    return Rect(x: Int(pos.x), y: Int(pos.y), w: Int(size.width), h: Int(size.height))
}

// MARK: - Element Extraction

// Roles we care about - interactive elements
let interactiveRoles: Set<String> = [
    "AXButton", "AXLink", "AXTextField", "AXTextArea", "AXCheckBox",
    "AXRadioButton", "AXPopUpButton", "AXComboBox", "AXSlider",
    "AXMenuItem", "AXMenuButton", "AXTab", "AXCell", "AXImage",
    "AXIncrementor", "AXColorWell", "AXMenu", "AXToolbar"
]

// Text roles - for visible content
let textRoles: Set<String> = [
    "AXStaticText", "AXHeading"
]

func shouldInclude(_ role: String) -> Bool {
    return interactiveRoles.contains(role) || textRoles.contains(role)
}

func extractElement(_ axElement: AXUIElement, id: Int) -> Element? {
    guard let role: String = getAXValue(axElement, kAXRoleAttribute as String) else {
        return nil
    }

    // Skip if not a role we care about
    guard shouldInclude(role) else { return nil }

    // Get label - try multiple attributes
    let title: String? = getAXValue(axElement, kAXTitleAttribute as String)
    let description: String? = getAXValue(axElement, kAXDescriptionAttribute as String)
    let help: String? = getAXValue(axElement, kAXHelpAttribute as String)
    let roleDesc: String? = getAXValue(axElement, kAXRoleDescriptionAttribute as String)
    let label = title ?? description ?? help

    // Get value for text elements
    var value: String? = getAXValue(axElement, kAXValueAttribute as String)
    if let v = value, v.count > 200 {
        value = String(v.prefix(200)) + "..."
    }

    // Skip text elements with no content
    if textRoles.contains(role) && (value == nil || value?.isEmpty == true) && (label == nil || label?.isEmpty == true) {
        return nil
    }

    // Skip interactive elements with no label (unless they have a value)
    if interactiveRoles.contains(role) && label == nil && value == nil && roleDesc == nil {
        return nil
    }

    // Get enabled state
    let enabled: Bool = getAXValue(axElement, kAXEnabledAttribute as String) ?? true

    // Get focused state
    let focused: Bool = getAXValue(axElement, kAXFocusedAttribute as String) ?? false

    // Get position
    let rect = getRect(axElement)

    // Skip elements without position (can't click them)
    guard rect != nil else { return nil }

    // Skip off-screen or tiny elements
    if let r = rect {
        if r.x < -500 || r.y < -500 || r.x > 5000 || r.y > 5000 { return nil }
        if r.w < 5 || r.h < 5 { return nil }
    }

    // Use roleDesc as fallback label for buttons without text
    let finalLabel = label ?? roleDesc

    return Element(
        id: id,
        role: role.replacingOccurrences(of: "AX", with: ""),
        label: finalLabel,
        value: value,
        rect: rect,
        enabled: enabled,
        focused: focused
    )
}

// Browser chrome roles to skip (toolbar, tabs, etc.)
let browserChromeRoles: Set<String> = [
    "AXToolbar", "AXRadioButton", "AXTabGroup"
]

func findScrollArea(_ root: AXUIElement, depth: Int = 0) -> AXUIElement? {
    guard depth < 10 else { return nil }

    let role: String? = getAXValue(root, kAXRoleAttribute as String)
    if role == "AXScrollArea" {
        return root
    }

    var children: AnyObject?
    guard AXUIElementCopyAttributeValue(root, kAXChildrenAttribute as CFString, &children) == .success,
          let childArray = children as? [AXUIElement] else { return nil }

    for child in childArray {
        if let found = findScrollArea(child, depth: depth + 1) {
            return found
        }
    }
    return nil
}

func extractAllElements(_ root: AXUIElement, elements: inout [Element], idCounter: inout Int, depth: Int = 0, maxElements: Int = 50, skipBrowserChrome: Bool = false) {
    // Limit recursion depth and element count
    guard depth < 20 && elements.count < maxElements else { return }

    let role: String? = getAXValue(root, kAXRoleAttribute as String)

    // Skip browser chrome if requested
    if skipBrowserChrome, let r = role, browserChromeRoles.contains(r) {
        return
    }

    // Try to extract this element
    if let elem = extractElement(root, id: idCounter) {
        elements.append(elem)
        idCounter += 1
    }

    // Get children and recurse
    var children: AnyObject?
    guard AXUIElementCopyAttributeValue(root, kAXChildrenAttribute as CFString, &children) == .success,
          let childArray = children as? [AXUIElement] else { return }

    for child in childArray {
        if elements.count >= maxElements { break }
        extractAllElements(child, elements: &elements, idCounter: &idCounter, depth: depth + 1, maxElements: maxElements, skipBrowserChrome: skipBrowserChrome)
    }
}

func getFocusedElement(_ app: AXUIElement) -> Element? {
    var focused: AnyObject?
    guard AXUIElementCopyAttributeValue(app, kAXFocusedUIElementAttribute as CFString, &focused) == .success,
          let focusedElement = focused else { return nil }

    guard let role: String = getAXValue(focusedElement as! AXUIElement, kAXRoleAttribute as String) else {
        return nil
    }

    let title: String? = getAXValue(focusedElement as! AXUIElement, kAXTitleAttribute as String)
    let value: String? = getAXValue(focusedElement as! AXUIElement, kAXValueAttribute as String)
    let rect = getRect(focusedElement as! AXUIElement)

    return Element(
        id: 0,
        role: role.replacingOccurrences(of: "AX", with: ""),
        label: title,
        value: value,
        rect: rect,
        enabled: true,
        focused: true
    )
}

// MARK: - Main Extraction

func extractState() -> ExtractionResult {
    // Get frontmost application
    guard let frontApp = NSWorkspace.shared.frontmostApplication else {
        return ExtractionResult(
            success: false, app: "Unknown", bundleId: nil, windowTitle: nil,
            focusedElement: nil, elements: [], error: "No frontmost application"
        )
    }

    let appName = frontApp.localizedName ?? "Unknown"
    let bundleId = frontApp.bundleIdentifier
    let pid = frontApp.processIdentifier

    // Create accessibility element for app
    let appElement = AXUIElementCreateApplication(pid)

    // Get focused window
    var window: AnyObject?
    var windowTitle: String? = nil
    if AXUIElementCopyAttributeValue(appElement, kAXFocusedWindowAttribute as CFString, &window) == .success,
       let focusedWindow = window {
        windowTitle = getAXValue(focusedWindow as! AXUIElement, kAXTitleAttribute as String)
    }

    // Get focused element
    let focusedElement = getFocusedElement(appElement)

    // Extract elements from window (or app if no window)
    var elements: [Element] = []
    var idCounter = 1

    // Check if this is a browser - if so, prioritize web content
    let browsers = ["Safari", "Google Chrome", "Arc", "Chromium", "Brave Browser", "Microsoft Edge", "Firefox"]
    let isBrowser = browsers.contains { appName.contains($0) }

    if let win = window {
        if isBrowser {
            // For browsers, try to find the scroll area (web content) first
            if let scrollArea = findScrollArea(win as! AXUIElement) {
                extractAllElements(scrollArea, elements: &elements, idCounter: &idCounter, maxElements: 75, skipBrowserChrome: true)
            } else {
                // Fall back to window but skip browser chrome
                extractAllElements(win as! AXUIElement, elements: &elements, idCounter: &idCounter, maxElements: 75, skipBrowserChrome: true)
            }
        } else {
            extractAllElements(win as! AXUIElement, elements: &elements, idCounter: &idCounter, maxElements: 75, skipBrowserChrome: false)
        }
    } else {
        extractAllElements(appElement, elements: &elements, idCounter: &idCounter, maxElements: 75, skipBrowserChrome: false)
    }

    return ExtractionResult(
        success: true,
        app: appName,
        bundleId: bundleId,
        windowTitle: windowTitle,
        focusedElement: focusedElement,
        elements: elements,
        error: nil
    )
}

// MARK: - Entry Point

let result = extractState()

let encoder = JSONEncoder()
encoder.outputFormatting = [.sortedKeys]

if let jsonData = try? encoder.encode(result),
   let jsonString = String(data: jsonData, encoding: .utf8) {
    print(jsonString)
} else {
    print("{\"success\":false,\"error\":\"Failed to encode JSON\",\"app\":\"Unknown\",\"elements\":[]}")
}
