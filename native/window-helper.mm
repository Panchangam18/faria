#import <napi.h>
#import <Cocoa/Cocoa.h>

/**
 * Native window helper for Electron command bar
 *
 * Provides reliable window visibility control using AppKit APIs directly,
 * bypassing Electron's abstraction layer which can fail silently on macOS
 * with panel-type windows after extended use.
 */

// Convert Electron's window handle buffer to NSWindow*
// Electron returns a Buffer containing an NSView* pointer on macOS
NSWindow* GetNSWindowFromHandle(const Napi::Buffer<uint8_t>& buffer) {
    if (buffer.Length() < sizeof(void*)) {
        return nil;
    }
    NSView* view = *reinterpret_cast<NSView**>(buffer.Data());
    if (!view) {
        return nil;
    }
    return [view window];
}

/**
 * Force show a window using native AppKit APIs
 * Uses orderFrontRegardless which is more forceful than Electron's showInactive
 *
 * @param handle - Buffer from BrowserWindow.getNativeWindowHandle()
 * @returns boolean - true if window is now visible
 */
Napi::Value ForceShowWindow(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsBuffer()) {
        Napi::TypeError::New(env, "Window handle buffer required")
            .ThrowAsJavaScriptException();
        return env.Null();
    }

    auto buffer = info[0].As<Napi::Buffer<uint8_t>>();
    NSWindow* window = GetNSWindowFromHandle(buffer);

    if (!window) {
        return Napi::Boolean::New(env, false);
    }

    // Force the window visible using native APIs
    // setLevel ensures it floats above other windows
    [window setLevel:NSFloatingWindowLevel];

    // orderFrontRegardless is the nuclear option - it WILL show the window
    // regardless of app activation state or other window ordering constraints
    [window orderFrontRegardless];

    return Napi::Boolean::New(env, [window isVisible]);
}

/**
 * Check if a window is actually visible using native AppKit
 * More reliable than trusting Electron's cached state
 *
 * @param handle - Buffer from BrowserWindow.getNativeWindowHandle()
 * @returns boolean - true if window is visible
 */
Napi::Value IsWindowVisible(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsBuffer()) {
        return Napi::Boolean::New(env, false);
    }

    auto buffer = info[0].As<Napi::Buffer<uint8_t>>();
    NSWindow* window = GetNSWindowFromHandle(buffer);

    if (!window) {
        return Napi::Boolean::New(env, false);
    }

    return Napi::Boolean::New(env, [window isVisible]);
}

/**
 * Initialize the native addon and export functions
 */
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("forceShow", Napi::Function::New(env, ForceShowWindow));
    exports.Set("isVisible", Napi::Function::New(env, IsWindowVisible));
    return exports;
}

NODE_API_MODULE(window_helper, Init)
