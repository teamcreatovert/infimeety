//! Desktop integration: the tray icon, closing to the tray, and the who's-talking overlay.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, LogicalPosition, Manager, WebviewUrl, WebviewWindowBuilder, Window, WindowEvent};

/// WebView2 arguments for every webview in the app; they must match `additionalBrowserArgs` in
/// tauri.conf.json, or WebView2 refuses to create the second window. Besides wry's defaults,
/// they keep timers at full speed while the main window is hidden in the tray, so speaking
/// detection (and with it the overlay) stays live.
const BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,CalculateNativeWinOcclusion --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows";

/// Whether the close button hides to the tray (the default) or quits. Synced from settings.
pub struct CloseToTray(AtomicBool);

impl Default for CloseToTray {
    fn default() -> Self {
        Self(AtomicBool::new(true))
    }
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
    if let Some(window) = app.get_webview_window("overlay") {
        let _ = window.destroy();
    }
}
