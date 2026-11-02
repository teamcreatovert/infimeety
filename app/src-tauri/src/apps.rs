//! "Share music": the apps you can share the sound of (Spotify, a browser playing YouTube
//! Music...), and the song each one shows in its window title.

#[derive(serde::Serialize, Clone)]
pub struct App {
    pid: u32,
    /// The program's name ("Spotify", "chrome").
    name: String,
    /// Its main window's title, which music apps set to the song.
    title: String,
}

/// Programs that play music, listed first.
const MUSIC: &[&str] = &["spotify", "chrome", "msedge", "firefox", "brave", "opera", "vivaldi", "applemusic", "itunes", "vlc", "foobar2000", "aimp", "musicbee", "youtube music"];

/// Apps with a window open, music players first.
#[tauri::command]
pub async fn audio_apps() -> Vec<App> {
    let mut apps = tauri::async_runtime::spawn_blocking(windows_list).await.unwrap_or_default();
    let rank = |a: &App| MUSIC.iter().position(|m| a.name.to_lowercase() == *m).unwrap_or(MUSIC.len());
    apps.sort_by(|a, b| rank(a).cmp(&rank(b)).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    apps
}

/// What one app's window says now (the song, for most players).
#[tauri::command]
pub async fn app_title(pid: u32) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || windows_list().into_iter().find(|a| a.pid == pid).map(|a| a.title)).await.ok().flatten()
}

/// One entry per program with a visible, titled window (its first one), never Infimeety itself.
#[cfg(windows)]
fn windows_list() -> Vec<App> {
    use windows::core::BOOL;
    use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM};
    use windows::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};
    use windows::Win32::UI::WindowsAndMessaging::{EnumWindows, GetWindow, GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible, GW_OWNER};

    unsafe extern "system" fn each(hwnd: HWND, list: LPARAM) -> BOOL {
        let list = unsafe { &mut *(list.0 as *mut Vec<(u32, String)>) };
        // Main windows only: visible, titled, not owned by another window (dialogs, tool tips).
        if !unsafe { IsWindowVisible(hwnd) }.as_bool() || unsafe { GetWindow(hwnd, GW_OWNER) }.is_ok_and(|o| !o.is_invalid()) {
            return true.into();
        }
        let mut title = [0u16; 256];
        let len = unsafe { GetWindowTextW(hwnd, &mut title) } as usize;
        let title = String::from_utf16_lossy(&title[..len]).trim().to_string();
        if title.is_empty() {
            return true.into();
        }
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
        if pid != 0 && !list.iter().any(|(p, _)| *p == pid) {
            list.push((pid, title));
        }
        true.into()
    }

    let mut found: Vec<(u32, String)> = Vec::new();
    unsafe {
        let _ = EnumWindows(Some(each), LPARAM(&mut found as *mut _ as isize));
    }
    let me = std::process::id();
    found
        .into_iter()
        .filter(|(pid, _)| *pid != me)
        .filter_map(|(pid, title)| {
            let path = unsafe {
                let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
                let mut buf = [0u16; 512];
                let mut size = buf.len() as u32;
                let ok = QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, windows::core::PWSTR(buf.as_mut_ptr()), &mut size).is_ok();
                let _ = CloseHandle(handle);
                ok.then(|| String::from_utf16_lossy(&buf[..size as usize]))?
            };
            let name = std::path::Path::new(&path).file_stem()?.to_string_lossy().to_string();
            // Infimeety's own windows and Windows' shell aren't something to share.
            let lower = name.to_lowercase();
            if ["infimeety", "explorer", "textinputhost", "applicationframehost", "shellexperiencehost", "systemsettings", "msedgewebview2"].contains(&lower.as_str()) {
                return None;
            }
            // The names people know, not the program files'.
            let known = [("spotify", "Spotify"), ("chrome", "Chrome"), ("msedge", "Edge"), ("firefox", "Firefox"), ("brave", "Brave"), ("opera", "Opera"), ("vivaldi", "Vivaldi"), ("applemusic", "Apple Music"), ("vlc", "VLC")];
            let name = known.iter().find(|(file, _)| *file == lower).map_or(name, |(_, shown)| shown.to_string());
            Some(App { pid, name, title })
        })
        .collect()
}

#[cfg(not(windows))]
fn windows_list() -> Vec<App> {
    Vec::new()
}
