//! Mac privacy permissions the webview can't see for itself. A Mac shares a screen only after
//! the person allows Infimeety under Screen & System Audio Recording; until then the webview's
//! screen share just fails with no explanation. Elsewhere these always say yes.

/// Whether Infimeety may record the screen. `ask`: if not, macOS asks the person once (and lists
/// Infimeety in System Settings, ready to switch on). The answer only counts after a relaunch.
#[tauri::command]
pub fn mac_screen_access(ask: bool) -> bool {
    #[cfg(target_os = "macos")]
    {
        #[link(name = "CoreGraphics", kind = "framework")]
        extern "C" {
            fn CGPreflightScreenCaptureAccess() -> bool;
            fn CGRequestScreenCaptureAccess() -> bool;
        }
        // Both exist from macOS 10.15, the oldest the app runs on.
        unsafe {
            if CGPreflightScreenCaptureAccess() {
                return true;
            }
            if ask {
                return CGRequestScreenCaptureAccess();
            }
        }
        false
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = ask;
        true
    }
}

/// Opens System Settings at one privacy list: "screen", "microphone" or "camera".
#[tauri::command]
pub fn mac_privacy(pane: String) {
    #[cfg(target_os = "macos")]
    {
        let anchor = match pane.as_str() {
            "screen" => "Privacy_ScreenCapture",
            "microphone" => "Privacy_Microphone",
            "camera" => "Privacy_Camera",
            _ => return,
        };
        let _ = std::process::Command::new("open").arg(format!("x-apple.systempreferences:com.apple.preference.security?{anchor}")).spawn();
    }
    #[cfg(not(target_os = "macos"))]
    let _ = pane;
}
