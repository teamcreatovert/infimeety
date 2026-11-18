//! The Infimeety browser: a separate window for watching a website together (Netflix, YouTube...).
//!
//! Everyone signs in to their own account in it. Its cookies, logins and saved passwords live in
//! their own folder on this device, apart from the app, and never reach our server. The pages get
//! no access to the app (no IPC: no capability names this window); the app asks the page's small
//! helper (watch_agent.js) for the video's state and tells it to play, pause or seek.

use std::sync::mpsc;
use std::time::Duration;
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};

const LABEL: &str = "browser";
const AGENT: &str = include_str!("watch_agent.js");

fn https(url: &str) -> Result<Url, String> {
    let url: Url = url.parse().map_err(|_| "That isn’t a link".to_string())?;
    if url.scheme() != "https" {
        return Err("Only https links open in the Infimeety browser".into());
    }
    Ok(url)
}

/// Opens the Infimeety browser at `url` (or takes the open one there).
#[tauri::command]
pub async fn browser_open(app: AppHandle, url: String) -> Result<(), String> {
    let url = https(&url)?;
    if let Some(window) = app.get_webview_window(LABEL) {
        window.navigate(url).map_err(|e| e.to_string())?;
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }
    let profile = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("browser");
    #[allow(unused_mut)]
    let mut builder = WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::External(url))
        .title("Infimeety browser")
        .inner_size(1280.0, 760.0)
        .min_inner_size(480.0, 320.0)
        // Its own storage: the sites' logins stay here, apart from the app.
        .data_directory(profile)
        .initialization_script(AGENT)
        // The app starts and resumes the movie for everyone at once, without a click in this window.
        .additional_browser_args("--autoplay-policy=no-user-gesture-required --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection")
        // Web pages only: no file:// or app links from inside a site.
        .on_navigation(|url| matches!(url.scheme(), "https" | "http" | "about" | "blob" | "data"))
        .on_document_title_changed(|window, title| {
            let title = title.trim();
            let _ = window.set_title(if title.is_empty() { "Infimeety browser" } else { title });
        });
    // WebKit's own name lacks Safari's version, and some sites turn it away for that.
    #[cfg(target_os = "macos")]
    {
        builder = builder.user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15");
    }
    builder.build().map_err(|e| e.to_string())?;
    Ok(())
}

/// What the page's video is doing: `null` when the window is closed or the page doesn't answer.
#[tauri::command]
pub async fn browser_state(app: AppHandle) -> Result<String, String> {
    let Some(window) = app.get_webview_window(LABEL) else { return Ok("null".into()) };
    let (tx, rx) = mpsc::channel::<String>();
    window
        .eval_with_callback("(() => { try { return window.__infimeetySync ? window.__infimeetySync.state() : null; } catch (e) { return null; } })()", move |result| {
            let _ = tx.send(result);
        })
        .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(Duration::from_millis(1500)).unwrap_or_else(|_| "null".into()))
        .await
        .map_err(|e| e.to_string())
}

#[derive(serde::Deserialize, serde::Serialize)]
pub struct Command {
    /// Seek here (seconds) if further than `tol` away.
    t: Option<f64>,
    tol: Option<f64>,
    /// Play (true) or pause (false).
    p: Option<bool>,
}

/// Plays, pauses or seeks the page's video. Only these numbers reach the page.
#[tauri::command]
pub fn browser_apply(app: AppHandle, command: Command) -> Result<(), String> {
    let Some(window) = app.get_webview_window(LABEL) else { return Ok(()) };
    let clean = Command { t: command.t.filter(|t| t.is_finite() && *t >= 0.0), tol: command.tol.filter(|t| t.is_finite() && *t >= 0.0), p: command.p };
    let json = serde_json::to_string(&clean).map_err(|e| e.to_string())?;
    window
        .eval(format!("try {{ window.__infimeetySync && window.__infimeetySync.apply({json}); }} catch (e) {{}}"))
        .map_err(|e| e.to_string())
}

/// Brings the browser to the front.
#[tauri::command]
pub fn browser_show(app: AppHandle) {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[tauri::command]
pub fn browser_close(app: AppHandle) {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.destroy();
    }
}
