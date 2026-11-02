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

/// Apps playing sound right now, music players first. An app plays through a helper process
/// at times (a browser's audio service): that sound counts for the app whose window it belongs to.
#[tauri::command]
pub async fn audio_apps() -> Vec<App> {
    tauri::async_runtime::spawn_blocking(|| {
        let playing = playing_pids();
        let parents = parent_pids();
        let windows = windows_list();
        let owner = |mut pid: u32| {
            for _ in 0..6 {
                if windows.iter().any(|a| a.pid == pid) {
                    return Some(pid);
                }
                pid = *parents.get(&pid)?;
            }
            None
        };
        let sounding: Vec<u32> = playing.into_iter().filter_map(owner).collect();
        let mut apps: Vec<App> = windows.iter().filter(|a| sounding.contains(&a.pid)).cloned().collect();
        let rank = |a: &App| MUSIC.iter().position(|m| a.name.to_lowercase() == *m).unwrap_or(MUSIC.len());
        apps.sort_by(|a, b| rank(a).cmp(&rank(b)).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
        apps
    })
    .await
    .unwrap_or_default()
}

/// Processes with sound playing now, on any output device (Windows' audio sessions).
#[cfg(windows)]
fn playing_pids() -> Vec<u32> {
    use windows::core::Interface;
    use windows::Win32::Media::Audio::{eRender, AudioSessionStateActive, IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator, MMDeviceEnumerator, DEVICE_STATE_ACTIVE};
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};
    let mut out = Vec::new();
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let Ok(enumerator) = CoCreateInstance::<_, IMMDeviceEnumerator>(&MMDeviceEnumerator, None, CLSCTX_ALL) else { return out };
        let Ok(devices) = enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE) else { return out };
        for i in 0..devices.GetCount().unwrap_or(0) {
            let Ok(device) = devices.Item(i) else { continue };
            let Ok(manager) = device.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None) else { continue };
            let Ok(sessions) = manager.GetSessionEnumerator() else { continue };
            for j in 0..sessions.GetCount().unwrap_or(0) {
                let Ok(session) = sessions.GetSession(j) else { continue };
                if session.GetState().ok() != Some(AudioSessionStateActive) {
                    continue;
                }
                if let Ok(pid) = session.cast::<IAudioSessionControl2>().and_then(|s| s.GetProcessId()) {
                    if pid != 0 && !out.contains(&pid) {
                        out.push(pid);
                    }
                }
            }
        }
    }
    out
}

/// Every process's parent, to find the app a helper process plays for.
#[cfg(windows)]
fn parent_pids() -> std::collections::HashMap<u32, u32> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
    let mut out = std::collections::HashMap::new();
    unsafe {
        let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return out };
        let mut entry = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        let mut more = Process32FirstW(snap, &mut entry).is_ok();
        while more {
            out.insert(entry.th32ProcessID, entry.th32ParentProcessID);
            more = Process32NextW(snap, &mut entry).is_ok();
        }
        let _ = CloseHandle(snap);
    }
    out
}

#[cfg(not(windows))]
fn playing_pids() -> Vec<u32> {
    Vec::new()
}

#[cfg(not(windows))]
fn parent_pids() -> std::collections::HashMap<u32, u32> {
    Default::default()
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
            let name = known
                .iter()
                .find(|(file, _)| *file == lower)
                .map(|(_, shown)| shown.to_string())
                .or_else(|| crate::games::game_name(&format!("{lower}.exe")).map(str::to_string))
                .unwrap_or(name);
            Some(App { pid, name, title })
        })
        .collect()
}

#[cfg(not(windows))]
fn windows_list() -> Vec<App> {
    Vec::new()
}
