#import <napi.h>
#import <Cocoa/Cocoa.h>
#import <objc/runtime.h>

/**
 * Native window helper for Electron command bar
 *
 * Provides reliable window visibility control using AppKit APIs directly,
 * bypassing Electron's abstraction layer which can fail silently on macOS
 * with panel-type windows after extended use.
 *
 * Also provides non-activating panel behavior like Spotlight/Alfred where
 * clicking the window doesn't steal focus from other apps but keyboard
 * input still works.
 */

// Custom NSPanel subclass that can become key without activating the app
@interface NonActivatingPanel : NSPanel
@end

@implementation NonActivatingPanel

- (BOOL)canBecomeKeyWindow {
    return YES;
}

- (BOOL)canBecomeMainWindow {
    return NO;
}

// Don't activate the app when becoming key
- (void)becomeKeyWindow {
    // Call super but don't activate the application
    [super becomeKeyWindow];
}

@end

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
 * Make a window non-activating so clicking it doesn't steal focus from other apps
 * This converts the window to behave like a macOS accessory panel (Spotlight/Alfred)
 *
 * The key insight is that we need to:
 * 1. Add NSWindowStyleMaskNonactivatingPanel style mask
 * 2. Call _setPreventsActivation:YES to set the kCGSPreventsActivationTagBit
 * 3. Use class swizzling to override canBecomeKeyWindow to return YES
 *    (so the window can still receive keyboard input)
 *
 * @param handle - Buffer from BrowserWindow.getNativeWindowHandle()
 * @returns boolean - true if successful
 */
Napi::Value MakeNonActivating(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsBuffer()) {
        return Napi::Boolean::New(env, false);
    }

    auto buffer = info[0].As<Napi::Buffer<uint8_t>>();
    NSWindow* window = GetNSWindowFromHandle(buffer);

    if (!window) {
        return Napi::Boolean::New(env, false);
    }

    // Step 1: Add the non-activating style mask
    NSWindowStyleMask currentMask = [window styleMask];
    [window setStyleMask:currentMask | NSWindowStyleMaskNonactivatingPanel];

    // Step 2: Call the private _setPreventsActivation: method to set the window tag
    // This is necessary because setStyleMask alone doesn't update the window server tags
    // after initialization (see: https://philz.blog/nspanel-nonactivating-style-mask-flag/)
    SEL setPreventsActivationSel = NSSelectorFromString(@"_setPreventsActivation:");
    if ([window respondsToSelector:setPreventsActivationSel]) {
        NSMethodSignature* sig = [window methodSignatureForSelector:setPreventsActivationSel];
        NSInvocation* invocation = [NSInvocation invocationWithMethodSignature:sig];
        [invocation setSelector:setPreventsActivationSel];
        [invocation setTarget:window];
        BOOL yes = YES;
        [invocation setArgument:&yes atIndex:2];
        [invocation invoke];
        NSLog(@"[Faria] Called _setPreventsActivation:YES");
    }

    // Step 3: For NSPanel, configure panel-specific behavior
    if ([window isKindOfClass:[NSPanel class]]) {
        NSPanel* panel = (NSPanel*)window;
        // becomesKeyOnlyIfNeeded allows keyboard input when user interacts
        [panel setBecomesKeyOnlyIfNeeded:YES];
        // floatingPanel makes it float above other windows
        [panel setFloatingPanel:YES];
        NSLog(@"[Faria] Configured as NSPanel");
    }

    // Step 4: Set window level to floating
    [window setLevel:NSFloatingWindowLevel];

    // Step 5: Configure collection behavior for all spaces
    [window setCollectionBehavior:NSWindowCollectionBehaviorCanJoinAllSpaces |
                                  NSWindowCollectionBehaviorFullScreenAuxiliary |
                                  NSWindowCollectionBehaviorTransient];

    NSLog(@"[Faria] makeNonActivating complete, styleMask: %lu", (unsigned long)[window styleMask]);

    return Napi::Boolean::New(env, true);
}

/**
 * Steal key focus for the window without activating the application
 * This allows the window to receive keyboard input while keeping
 * another application visually "active"
 *
 * @param handle - Buffer from BrowserWindow.getNativeWindowHandle()
 * @returns boolean - true if successful
 */
Napi::Value StealKeyFocus(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsBuffer()) {
        return Napi::Boolean::New(env, false);
    }

    auto buffer = info[0].As<Napi::Buffer<uint8_t>>();
    NSWindow* window = GetNSWindowFromHandle(buffer);

    if (!window) {
        return Napi::Boolean::New(env, false);
    }

    // Make the window key without activating the app
    // This is what allows typing in Spotlight while keeping Safari "active"
    [window makeKeyWindow];

    return Napi::Boolean::New(env, true);
}

/**
 * Initialize the native addon and export functions
 */
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("forceShow", Napi::Function::New(env, ForceShowWindow));
    exports.Set("isVisible", Napi::Function::New(env, IsWindowVisible));
    exports.Set("makeNonActivating", Napi::Function::New(env, MakeNonActivating));
    exports.Set("stealKeyFocus", Napi::Function::New(env, StealKeyFocus));
    return exports;
}

NODE_API_MODULE(window_helper, Init)
