//! Desktop integration: the tray icon, closing to the tray, and the who's-talking overlay.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
#[cfg_attr(windows, allow(unused_imports))]
use tauri::{AppHandle, LogicalPosition, Manager, WebviewUrl, WebviewWindowBuilder, Window, WindowEvent};

/// WebView2 arguments for every webview in the app; they must match `additionalBrowserArgs` in
/// tauri.conf.json, or WebView2 refuses to create the second window. Besides wry's defaults,
/// they keep timers at full speed while the main window is hidden in the tray, so speaking
/// detection (and with it the overlay) stays live.
#[cfg_attr(windows, allow(dead_code))]
pub(crate) const BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,CalculateNativeWinOcclusion --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows --enable-blink-features=AudioVideoTracks";

/// Whether the close button hides to the tray (the default) or quits. Synced from settings.
pub struct CloseToTray(AtomicBool);

impl Default for CloseToTray {
    fn default() -> Self {
        Self(AtomicBool::new(true))
    }
}

/// Installed from the Microsoft Store: an MSIX package runs from WindowsApps, and the Store
/// updates it, so the app's own updater stays out of the way.
#[tauri::command]
pub fn is_store_install() -> bool {
    std::env::current_exe().map(|p| p.to_string_lossy().to_lowercase().contains("\\windowsapps\\")).unwrap_or(false)
}

#[tauri::command]
pub fn set_close_to_tray(state: tauri::State<CloseToTray>, enabled: bool) {
    state.0.store(enabled, Ordering::Relaxed);
}

pub fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Left-click opens the app; right-click offers Open and Quit.
pub fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Infimeety", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Infimeety", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &PredefinedMenuItem::separator(app)?, &quit])?;
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Infimeety")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

/// Closing the main window hides it, like Discord; Quit lives in the tray menu. With that turned
/// off, closing quits outright (the overlay window would otherwise keep the app alive).
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        if window.label() != "main" {
            return;
        }
        if window.state::<CloseToTray>().0.load(Ordering::Relaxed) {
            api.prevent_close();
            let _ = window.hide();
        } else {
            window.app_handle().exit(0);
        }
    }
}

const OVERLAY_SIZE: (f64, f64) = (300.0, 420.0);
const OVERLAY_MARGIN: f64 = 16.0;

/// Logical top-left of the overlay in a corner of the primary screen (above the taskbar).
fn overlay_position(app: &AppHandle, corner: &str) -> Option<(f64, f64)> {
    let monitor = app.primary_monitor().ok()??;
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let (x, y) = (area.position.x as f64 / scale, area.position.y as f64 / scale);
    let (w, h) = (area.size.width as f64 / scale, area.size.height as f64 / scale);
    let left = if corner.ends_with("right") { x + w - OVERLAY_SIZE.0 - OVERLAY_MARGIN } else { x + OVERLAY_MARGIN };
    let top = if corner.starts_with("bottom") { y + h - OVERLAY_SIZE.1 - OVERLAY_MARGIN } else { y + OVERLAY_MARGIN };
    Some((left, top))
}

/// Opens (or moves) the overlay: a transparent window above everything that clicks pass
/// through and that never takes focus. The main window feeds it `overlay:state` events.
/// Async because creating a window from a sync command deadlocks on Windows.
#[tauri::command]
pub async fn overlay_open(app: AppHandle, corner: String) -> Result<(), String> {
    let (x, y) = overlay_position(&app, &corner).unwrap_or((OVERLAY_MARGIN, OVERLAY_MARGIN));
    // Windows draws it natively (overlay_native.rs): no second browser window.
    #[cfg(windows)]
    {
        let scale = app.primary_monitor().ok().flatten().map(|m| m.scale_factor()).unwrap_or(1.0);
        crate::overlay_native::open((x * scale).round() as i32, (y * scale).round() as i32, scale as f32);
        Ok(())
    }
    #[cfg(not(windows))]
    overlay_webview(app, x, y).await
}

#[cfg(not(windows))]
async fn overlay_webview(app: AppHandle, x: f64, y: f64) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("overlay") {
        return window.set_position(LogicalPosition::new(x, y)).map_err(|e| e.to_string());
    }
    let window = WebviewWindowBuilder::new(&app, "overlay", WebviewUrl::App("overlay.html".into()))
        .title("Infimeety overlay")
        .inner_size(OVERLAY_SIZE.0, OVERLAY_SIZE.1)
        .position(x, y)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .focusable(false)
        .additional_browser_args(BROWSER_ARGS)
        .build()
        .map_err(|e| e.to_string())?;
    window.set_ignore_cursor_events(true).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn overlay_close(app: AppHandle) {
    #[cfg(windows)]
    crate::overlay_native::close();
    if let Some(window) = app.get_webview_window("overlay") {
        let _ = window.destroy();
    }
}

/// What the native overlay draws (Windows; elsewhere the overlay page listens for events).
#[cfg(windows)]
#[tauri::command]
pub fn overlay_state(state: crate::overlay_native::State) {
    crate::overlay_native::set_state(state);
}
#[cfg(not(windows))]
#[tauri::command]
pub fn overlay_state() {}

/// A person's avatar for the native overlay: a small round PNG, sent once.
#[tauri::command]
pub fn overlay_avatar(user_id: String, png: Vec<u8>) {
    #[cfg(windows)]
    crate::overlay_native::set_avatar(user_id, png);
    #[cfg(not(windows))]
    let _ = (user_id, png);
}

/// A message or call shown on the native overlay for a few seconds.
#[tauri::command]
pub fn overlay_note(title: String, body: String) {
    #[cfg(windows)]
    crate::overlay_native::note(title, body);
    #[cfg(not(windows))]
    let _ = (title, body);
}

/// A Windows pop-up for a message or call. Clicking it brings Infimeety up and tells the page
/// which chat to open (`target`); nothing else ever moves the window, so a game keeps the screen.
#[tauri::command]
pub fn notify(app: AppHandle, title: String, body: String, target: String) -> bool {
    #[cfg(windows)]
    {
        use tauri::Emitter;
        let handle = app.clone();
        let shown = tauri_winrt_notification::Toast::new(&app.config().identifier)
            .title(&title)
            .text1(&body)
            .on_activated(move |_| {
                show_main(&handle);
                let _ = handle.emit_to("main", "notification-click", target.clone());
                Ok(())
            })
            .show();
        shown.is_ok()
    }
    #[cfg(not(windows))]
    {
        let _ = (app, title, body, target);
        false
    }
}

/// Windows: an update moves the old infimeety.exe aside, since a file in use can't be
/// overwritten (installer-hooks.nsh). Tidy up what's left of it.
#[cfg(windows)]
pub fn remove_update_leftover() {
    if let Ok(exe) = std::env::current_exe() {
        let _ = std::fs::remove_file(exe.with_file_name("infimeety.old.exe"));
    }
}

/// Mac: opened straight from its installer (.dmg), the app disappears once that's ejected, and
/// one macOS quarantined in place runs from a hidden read-only copy that can't update. Offer to
/// move it into Applications, like Mac apps do, and reopen it from there.
#[cfg(target_os = "macos")]
pub fn offer_move_to_applications(app: &tauri::App) {
    use std::path::{Path, PathBuf};
    use std::process::Command;
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

    let Ok(exe) = std::env::current_exe() else { return };
    let path = exe.to_string_lossy();
    if !path.starts_with("/Volumes/") && !path.contains("/AppTranslocation/") {
        return;
    }
    let Some(bundle) = exe.ancestors().find(|p| p.extension().is_some_and(|e| e == "app")).map(Path::to_path_buf) else {
        return;
    };

    // ditto keeps the bundle exactly as signed; the copy then loses the download quarantine, so
    // macOS doesn't stop it again or run it from a hidden copy.
    fn copy_to(bundle: &Path, dir: PathBuf) -> Option<PathBuf> {
        std::fs::create_dir_all(&dir).ok()?;
        let target = dir.join("Infimeety.app");
        if target.exists() {
            std::fs::remove_dir_all(&target).ok()?;
        }
        Command::new("ditto").arg(bundle).arg(&target).status().ok()?.success().then_some(())?;
        let _ = Command::new("xattr").args(["-dr", "com.apple.quarantine"]).arg(&target).status();
        Some(target)
    }

    let handle = app.handle().clone();
    app.dialog()
        .message("Infimeety is running from its installer, so it would disappear once that's closed. Move it into your Applications folder? It reopens from there.")
        .title("Move Infimeety to Applications")
        .buttons(MessageDialogButtons::OkCancelCustom("Move to Applications".into(), "Not Now".into()))
        .show(move |ok| {
            if !ok {
                return;
            }
            // /Applications needs an admin account; everyone else gets their own Applications folder.
            let home = std::env::var("HOME").map(|h| PathBuf::from(h).join("Applications")).ok();
            let moved = std::iter::once(PathBuf::from("/Applications")).chain(home).find_map(|dir| copy_to(&bundle, dir));
            match moved {
                Some(target) => {
                    // Reopen once this copy has quit, or the single-instance check would keep this one.
                    let _ = Command::new("sh").args(["-c", "sleep 1; open \"$0\""]).arg(&target).spawn();
                    handle.exit(0);
                }
                None => handle
                    .dialog()
                    .message("Infimeety couldn't move itself. Open the installer again and drag Infimeety into the Applications folder.")
                    .title("Move Infimeety to Applications")
                    .show(|_| {}),
            }
        });
}

/// Hidden or minimized (a game in front): WebView2 trims its memory (Microsoft's "low" target),
/// and goes back to normal when the window shows again. Calls keep working.
#[tauri::command]
pub fn webview_memory(webview: tauri::Webview, low: bool) {
    #[cfg(windows)]
    let _ = webview.with_webview(move |platform| {
        use webview2_com::Microsoft::Web::WebView2::Win32::{ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL};
        use windows::core::Interface;
        let level = if low { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW } else { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL };
        // SAFETY: plain COM calls on the live controller, on the UI thread (Tauri runs this there).
        unsafe {
            if let Ok(core) = platform.controller().CoreWebView2().and_then(|c| c.cast::<ICoreWebView2_19>()) {
                let _ = core.SetMemoryUsageTargetLevel(level);
            }
        }
    });
    #[cfg(not(windows))]
    let _ = (webview, low);
}

/// A meeting's calendar invite (.ics): saved to a temporary file and opened, so it lands in the
/// person's own calendar app (Outlook, Calendar…).
#[tauri::command]
pub fn open_calendar_invite(app: AppHandle, name: String, ics: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    if ics.len() > 64 * 1024 || !ics.starts_with("BEGIN:VCALENDAR") {
        return Err("not a calendar invite".into());
    }
    let safe: String = name.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | ' ')).take(60).collect();
    let file = std::env::temp_dir().join(format!("{}.ics", if safe.trim().is_empty() { "Infimeety meeting" } else { safe.trim() }));
    std::fs::write(&file, ics).map_err(|e| e.to_string())?;
    app.opener().open_path(file.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
}

/// Drawing on a shared screen (meetings): a see-through window over the screen being shared,
/// showing everyone's marks to the person sharing. It never takes clicks, and screen capture
/// leaves it out, so friends see the marks once (drawn by their own app) instead of twice.
#[tauri::command]
pub async fn annotate_overlay(app: AppHandle, open: bool, source: Option<String>) -> Result<(), String> {
    if !open {
        for label in ["annotate", "drawtools"] {
            if let Some(window) = app.get_webview_window(label) {
                let _ = window.destroy();
            }
        }
        return Ok(());
    }
    #[cfg(windows)]
    {
        use tauri::{PhysicalPosition, PhysicalSize};
        use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, HMONITOR, MONITORINFO};

        let source = source.ok_or("nothing shared")?;
        let handle = source.strip_prefix("screen:").ok_or("not a whole screen")?.parse::<isize>().map_err(|_| "not a screen")?;
        let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
        if !unsafe { GetMonitorInfoW(HMONITOR(handle as *mut core::ffi::c_void), &mut info) }.as_bool() {
            return Err("that screen isn't connected".into());
        }
        let r = info.rcMonitor;
        let builder = |label: &str, page: &str, title: &str| {
            WebviewWindowBuilder::new(&app, label, WebviewUrl::App(page.into()))
                .title(title)
                .decorations(false)
                .transparent(true)
                .shadow(false)
                .resizable(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .focused(false)
                .focusable(false)
                .visible(false)
                .additional_browser_args(BROWSER_ARGS)
        };
        let build = |label: &str, page: &str, title: &str| builder(label, page, title).build().map_err(|e| e.to_string());
        // The marks: the whole screen, letting clicks through unless you're drawing.
        let marks = match app.get_webview_window("annotate") {
            Some(window) => window,
            None => build("annotate", "annotate.html", "Infimeety drawing")?,
        };
        marks.set_position(PhysicalPosition::new(r.left, r.top)).map_err(|e| e.to_string())?;
        marks.set_size(PhysicalSize::new((r.right - r.left) as u32, (r.bottom - r.top) as u32)).map_err(|e| e.to_string())?;
        marks.set_ignore_cursor_events(true).map_err(|e| e.to_string())?;
        hide_from_capture(&marks);
        marks.show().map_err(|e| e.to_string())?;
        // The draw button: a small round button you can drag anywhere, opening the tools.
        if app.get_webview_window("drawtools").is_none() {
            // Owned by the marks window, so it always stays above it (and its buttons keep working
            // while you draw).
            let tools = builder("drawtools", "drawtools.html", "Infimeety drawing tools")
                .parent(&marks)
                .map_err(|e| e.to_string())?
                .build()
                .map_err(|e| e.to_string())?;
            let scale = tools.scale_factor().unwrap_or(1.0);
            let size = (DRAW_BUTTON * scale) as i32;
            tools.set_size(PhysicalSize::new(size as u32, size as u32)).map_err(|e| e.to_string())?;
            // Right edge, a little above the middle (clear of the taskbar and most apps' own buttons).
            tools.set_position(PhysicalPosition::new(r.right - size - (24.0 * scale) as i32, r.top + (r.bottom - r.top) * 2 / 5)).map_err(|e| e.to_string())?;
            hide_from_capture(&tools);
            tools.show().map_err(|e| e.to_string())?;
        }
    }
    #[cfg(not(windows))]
    let _ = (app, source);
    Ok(())
}

/// The draw button's size (logical pixels) while it's just the button.
#[cfg(windows)]
const DRAW_BUTTON: f64 = 72.0;

/// Screen capture leaves this window out (Windows 10 2004 and later; older ones would show it in the share).
#[cfg(windows)]
fn hide_from_capture(window: &tauri::WebviewWindow) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE};
    if let Ok(hwnd) = window.hwnd() {
        let _ = unsafe { SetWindowDisplayAffinity(HWND(hwnd.0 as _), WDA_EXCLUDEFROMCAPTURE) };
    }
}

/// Drawing on your own screen: the marks window takes the mouse while a tool is on, and lets
/// clicks through to your apps again for the pointer.
#[tauri::command]
pub fn annotate_mode(app: AppHandle, drawing: bool) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("annotate") {
        window.set_ignore_cursor_events(!drawing).map_err(|e| e.to_string())?;
    }
    // The tools stay on top of the marks, whatever just happened to the stacking.
    if let Some(tools) = app.get_webview_window("drawtools") {
        let _ = tools.set_always_on_top(true);
    }
    Ok(())
}

/// The draw button grows into the toolbar (and back), staying on the screen it's on.
#[tauri::command]
pub fn drawtools_size(app: AppHandle, width: f64, height: f64) -> Result<(), String> {
    use tauri::{PhysicalPosition, PhysicalSize};
    let Some(window) = app.get_webview_window("drawtools") else { return Ok(()) };
    let scale = window.scale_factor().unwrap_or(1.0);
    let (w, h) = ((width.clamp(40.0, 1400.0) * scale) as i32, (height.clamp(40.0, 400.0) * scale) as i32);
    let pos = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    // Grow from the button's right edge leftwards when it sits on the right half of the screen.
    let mut x = pos.x;
    let mut y = pos.y;
    if let Ok(Some(m)) = window.current_monitor() {
        let (mx, my) = (m.position().x, m.position().y);
        let (mw, mh) = (m.size().width as i32, m.size().height as i32);
        if pos.x + size.width as i32 / 2 > mx + mw / 2 {
            x = pos.x + size.width as i32 - w;
        }
        x = x.clamp(mx, mx + mw - w);
        y = y.clamp(my, my + mh - h);
    }
    window.set_size(PhysicalSize::new(w as u32, h as u32)).map_err(|e| e.to_string())?;
    window.set_position(PhysicalPosition::new(x, y)).map_err(|e| e.to_string())
}
