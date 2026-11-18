//! The Infimeety browser: the Browser tabs of the main window, for watching websites together
//! (Netflix, YouTube...) and for browsing in general. The toolbar and the tabs are drawn by the
//! app; each tab's website is a view of its own inside the main window, placed where the app
//! says (`browser_bounds`). Only the selected tab shows, and only while the browser is in front.
//!
//! Everyone signs in to their own accounts here. The websites' cookies, logins and saved
//! passwords live in one folder of their own on this device (shared by the tabs), apart from the
//! app, and never reach our server. Websites get no access to the app (no capability names their
//! views); the app asks a page's small helper (watch_agent.js) for the video's state and tells it
//! to play, pause or seek.

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Mutex};
use std::time::Duration;
use tauri::webview::{NewWindowResponse, PageLoadEvent, Webview, WebviewBuilder};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Url, WebviewUrl};

const PREFIX: &str = "browser-tab-";
const AGENT: &str = include_str!("watch_agent.js");
/// The start page: shortcuts to the usual sites and a search box.
const START: &str = "browser-start.html";

/// The browser is in front (its tabs, not Home).
static VISIBLE: AtomicBool = AtomicBool::new(false);
/// A tab's site is in full screen (a movie's own button): it takes the whole window.
static FULL: AtomicBool = AtomicBool::new(false);
/// The last Escape or double-click seen in a page (its time), passed on once.
static EXIT_AT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
/// The selected tab.
static ACTIVE: Mutex<String> = Mutex::new(String::new());
/// Where the app wants the sites (logical x, y, width, height).
static BOUNDS: Mutex<(f64, f64, f64, f64)> = Mutex::new((0.0, 0.0, 1.0, 1.0));

#[derive(Clone, Serialize)]
struct Page {
    tab: String,
    url: String,
    title: String,
    loading: bool,
}

fn https(url: &str) -> Result<Url, String> {
    let url: Url = url.parse().map_err(|_| "That isn’t a link".to_string())?;
    if url.scheme() != "https" {
        return Err("Only https links open in the Infimeety browser".into());
    }
    Ok(url)
}

/// A tab id from the app: short letters and digits only.
fn label(tab: &str) -> Result<String, String> {
    if tab.is_empty() || tab.len() > 24 || !tab.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("bad tab".into());
    }
    Ok(format!("{PREFIX}{tab}"))
}

fn site(app: &AppHandle, tab: &str) -> Option<Webview> {
    app.get_webview(&label(tab).ok()?)
}

fn tabs(app: &AppHandle) -> Vec<(String, Webview)> {
    app.webviews().into_iter().filter_map(|(l, w)| l.strip_prefix(PREFIX).map(|t| (t.to_string(), w))).collect()
}

fn tell_app(app: &AppHandle, page: Page) {
    let _ = app.emit_to("main", "browser:page", page);
}

/// Shows the selected tab where the app wants it (or over the whole window in full screen), hides the rest.
fn arrange(app: &AppHandle) {
    let active = ACTIVE.lock().unwrap().clone();
    let visible = VISIBLE.load(Ordering::Relaxed);
    let full = FULL.load(Ordering::Relaxed);
    let (x, y, w, h) = if full {
        app.get_window("main")
            .and_then(|win| Some((win.inner_size().ok()?, win.scale_factor().ok()?)))
            .map(|(s, k)| (0.0, 0.0, s.width as f64 / k, s.height as f64 / k))
            .unwrap_or(*BOUNDS.lock().unwrap())
    } else {
        *BOUNDS.lock().unwrap()
    };
    for (tab, view) in tabs(app) {
        if visible && tab == active {
            let _ = view.set_position(LogicalPosition::new(x, y));
            let _ = view.set_size(LogicalSize::new(w.max(1.0), h.max(1.0)));
            let _ = view.show();
        } else {
            let _ = view.hide();
        }
    }
}

/// Opens tab `tab` at `url` (the start page without one), or takes it there; it becomes the selected tab.
#[tauri::command]
pub async fn browser_open(app: AppHandle, tab: String, url: Option<String>) -> Result<(), String> {
    let name = label(&tab)?;
    let target = match url.as_deref() {
        Some(u) => WebviewUrl::External(https(u)?),
        None => WebviewUrl::App(START.into()),
    };
    *ACTIVE.lock().unwrap() = tab.clone();
    if let Some(view) = app.get_webview(&name) {
        if let WebviewUrl::External(u) = &target {
            view.navigate(u.clone()).map_err(|e| e.to_string())?;
        }
        arrange(&app);
        return Ok(());
    }
    let window = app.get_window("main").ok_or("no main window")?;
    let profile = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("browser");
    let (page_app, title_app, new_app) = (app.clone(), app.clone(), app.clone());
    let (page_tab, title_tab) = (tab.clone(), tab.clone());
    #[allow(unused_mut)]
    let mut builder = WebviewBuilder::new(&name, target)
        // One storage for every tab: sign in once. Apart from the app's own.
        .data_directory(profile)
        .initialization_script(AGENT)
        // The app starts and resumes the movie for everyone at once, without a click in here.
        .additional_browser_args("--autoplay-policy=no-user-gesture-required --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection")
        // Web pages only: no file:// or app links from inside a site.
        .on_navigation(|url| matches!(url.scheme(), "https" | "http" | "about" | "blob" | "data"))
        // A link that wants a new window opens as a new tab.
        .on_new_window(move |url, _| {
            if url.scheme() == "https" || url.scheme() == "http" {
                let _ = new_app.emit_to("main", "browser:newtab", url.to_string());
            }
            NewWindowResponse::Deny
        })
        .on_page_load(move |webview, payload| {
            let loading = matches!(payload.event(), PageLoadEvent::Started);
            tell_app(&page_app, Page { tab: page_tab.clone(), url: payload.url().to_string(), title: String::new(), loading });
            if !loading {
                let (app, tab) = (page_app.clone(), page_tab.clone());
                let _ = webview.eval_with_callback("[location.href, document.title]", move |r| {
                    if let Ok((url, title)) = serde_json::from_str::<(String, String)>(&r) {
                        tell_app(&app, Page { tab: tab.clone(), url, title, loading: false });
                    }
                });
            }
        })
        .on_document_title_changed(move |webview, title| {
            let url = webview.url().map(|u| u.to_string()).unwrap_or_default();
            tell_app(&title_app, Page { tab: title_tab.clone(), url, title, loading: false });
        });
    // WebKit's own name lacks Safari's version, and some sites turn it away for that.
    #[cfg(target_os = "macos")]
    {
        builder = builder.user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15");
    }
    let (x, y, w, h) = *BOUNDS.lock().unwrap();
    window.add_child(builder, LogicalPosition::new(x, y), LogicalSize::new(w.max(1.0), h.max(1.0))).map_err(|e| e.to_string())?;
    arrange(&app);

    // A movie's own full-screen button (in the selected tab): the window goes full screen.
    let (watch_app, watch_name) = (app.clone(), name.clone());
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(400));
        let Some(view) = watch_app.get_webview(&watch_name) else { break };
        if !VISIBLE.load(Ordering::Relaxed) || format!("{PREFIX}{}", ACTIVE.lock().unwrap()) != watch_name {
            continue;
        }
        let app = watch_app.clone();
        let _ = view.eval_with_callback("[!!document.fullscreenElement, window.__infimeetySync ? window.__infimeetySync.signal() : [0, '']]", move |r| {
            let (full, (at, kind)) = serde_json::from_str::<(bool, (f64, String))>(&r).unwrap_or((false, (0.0, String::new())));
            // F, a double-click (full screen on/off) or Escape (leave it) in the page, passed on once.
            let at = at as u64;
            if at > 0 && at > EXIT_AT.swap(at, Ordering::Relaxed) && (kind == "full" || kind == "exit") {
                let _ = app.emit_to("main", "browser:signal", kind);
            }
            if FULL.swap(full, Ordering::Relaxed) != full {
                if let Some(window) = app.get_window("main") {
                    let _ = window.set_fullscreen(full);
                }
                let _ = app.emit_to("main", "browser:full", full);
                arrange(&app);
            }
        });
    });
    Ok(())
}

/// Selects a tab.
#[tauri::command]
pub fn browser_select(app: AppHandle, tab: String) -> Result<(), String> {
    label(&tab)?;
    *ACTIVE.lock().unwrap() = tab;
    arrange(&app);
    Ok(())
}

/// Where the websites go in the window (the browser's area), in logical pixels.
#[tauri::command]
pub fn browser_bounds(app: AppHandle, x: f64, y: f64, width: f64, height: f64) {
    *BOUNDS.lock().unwrap() = (x, y, width, height);
    arrange(&app);
}

/// The browser in front (show the selected tab) or Home (hide them all).
#[tauri::command]
pub fn browser_visible(app: AppHandle, visible: bool) {
    VISIBLE.store(visible, Ordering::Relaxed);
    arrange(&app);
    if visible {
        if let Some(view) = site(&app, &ACTIVE.lock().unwrap().clone()) {
            let _ = view.set_focus();
        }
    } else if FULL.swap(false, Ordering::Relaxed) {
        if let Some(window) = app.get_window("main") {
            let _ = window.set_fullscreen(false);
        }
    }
}

/// The toolbar's buttons for a tab: back, forward, reload, stop, or the start page.
#[tauri::command]
pub fn browser_nav(app: AppHandle, tab: String, action: String) -> Result<(), String> {
    let Some(view) = site(&app, &tab) else { return Ok(()) };
    match action.as_str() {
        "back" => view.eval("history.back()"),
        "forward" => view.eval("history.forward()"),
        "reload" => view.reload(),
        "stop" => view.eval("window.stop()"),
        "home" => view.navigate(start_url(&app)?),
        _ => Ok(()),
    }
    .map_err(|e| e.to_string())
}

fn start_url(app: &AppHandle) -> Result<Url, String> {
    #[cfg(dev)]
    {
        let base = app.config().build.dev_url.clone().ok_or("no dev url")?;
        base.join(START).map_err(|e| e.to_string())
    }
    #[cfg(not(dev))]
    {
        let _ = app;
        let base = if cfg!(windows) { "http://tauri.localhost/" } else { "tauri://localhost/" };
        Url::parse(base).and_then(|u| u.join(START)).map_err(|e| e.to_string())
    }
}

/// The address bar: a link (https added when missing) or, otherwise, a web search.
#[tauri::command]
pub fn browser_go(app: AppHandle, tab: String, text: String) -> Result<(), String> {
    let Some(view) = site(&app, &tab) else { return Ok(()) };
    let text = text.trim();
    if text.is_empty() {
        return Ok(());
    }
    let looks_like_link = !text.contains(' ') && (text.starts_with("https://") || text.starts_with("http://") || text.contains('.'));
    let url = if looks_like_link {
        let with_scheme = if text.starts_with("http://") {
            text.replacen("http://", "https://", 1)
        } else if text.starts_with("https://") {
            text.to_string()
        } else {
            format!("https://{text}")
        };
        https(&with_scheme)?
    } else {
        let mut u = Url::parse("https://www.google.com/search").map_err(|e| e.to_string())?;
        u.query_pairs_mut().append_pair("q", text);
        u
    };
    view.navigate(url).map_err(|e| e.to_string())
}

/// What a tab's video is doing: `null` when the tab is closed or the page doesn't answer.
#[tauri::command]
pub async fn browser_state(app: AppHandle, tab: String) -> Result<String, String> {
    let Some(view) = site(&app, &tab) else { return Ok("null".into()) };
    let (tx, rx) = mpsc::channel::<String>();
    view.eval_with_callback("(() => { try { return window.__infimeetySync ? window.__infimeetySync.state() : null; } catch (e) { return null; } })()", move |result| {
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
    /// Video only: the site's player fills the page (the watch party lobby's screen).
    fill: Option<bool>,
}

/// Plays, pauses or seeks a tab's video. Only these numbers reach the page.
#[tauri::command]
pub fn browser_apply(app: AppHandle, tab: String, command: Command) -> Result<(), String> {
    let Some(view) = site(&app, &tab) else { return Ok(()) };
    let clean = Command { t: command.t.filter(|t| t.is_finite() && *t >= 0.0), tol: command.tol.filter(|t| t.is_finite() && *t >= 0.0), p: command.p, fill: command.fill };
    let json = serde_json::to_string(&clean).map_err(|e| e.to_string())?;
    view.eval(format!("try {{ window.__infimeetySync && window.__infimeetySync.apply({json}); }} catch (e) {{}}")).map_err(|e| e.to_string())
}

/// Closes a tab (or, without one, all of them).
#[tauri::command]
pub fn browser_close(app: AppHandle, tab: Option<String>) {
    for (id, view) in tabs(&app) {
        if tab.as_deref().is_none_or(|t| t == id) {
            let _ = view.close();
        }
    }
    if tab.is_none() && FULL.swap(false, Ordering::Relaxed) {
        if let Some(window) = app.get_window("main") {
            let _ = window.set_fullscreen(false);
        }
    }
}
