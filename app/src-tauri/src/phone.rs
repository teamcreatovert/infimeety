//! Saving copies on phones.
//!
//! A friend's file arrives in the webview's own storage, as in a phone's browser. A WebView
//! can't do a browser download, so once the copy is complete the webview hands it over here,
//! piece by piece, and it lands where the phone's Files app finds it: Downloads/Infimeety on
//! Android, Infimeety's folder in Files on iPhone. The page only picks the file's name; the
//! folder is always this one.

use crate::names::{clean_name, unique};
use serde::Serialize;
use std::{
    collections::HashMap,
    fs,
    io::Write,
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};
use tauri::{
    ipc::{InvokeBody, Request},
    AppHandle, Manager, State,
};

struct Saving {
    file: fs::File,
    /// Where the bytes go until the copy is complete.
    part: PathBuf,
    target: PathBuf,
}

/// Copies being saved, by id.
#[derive(Default)]
pub struct Saves {
    next: AtomicU64,
    open: Mutex<HashMap<u64, Saving>>,
}

#[derive(Serialize)]
pub struct Opened {
    id: u64,
    /// The file's name once saved (it may get a number if the name is taken).
    name: String,
}

/// Android: the shared Downloads folder (apps may add files there without asking), or the
/// app's own one if that fails. iPhone: the app's Documents, shown in Files › On My iPhone.
fn save_folder(app: &AppHandle) -> Result<PathBuf, String> {
    #[cfg(target_os = "android")]
    {
        if let Ok(home) = app.path().home_dir() {
            let shared = home.join("Download").join("Infimeety");
            if fs::create_dir_all(&shared).is_ok() {
                return Ok(shared);
            }
        }
        let own = app.path().download_dir().map_err(|e| e.to_string())?;
        fs::create_dir_all(&own).map_err(|e| e.to_string())?;
        Ok(own)
    }
    #[cfg(not(target_os = "android"))]
    {
        let docs = app.path().document_dir().map_err(|e| e.to_string())?;
        fs::create_dir_all(&docs).map_err(|e| e.to_string())?;
        Ok(docs)
    }
}

#[tauri::command]
pub async fn save_open(app: AppHandle, saves: State<'_, Saves>, name: String) -> Result<Opened, String> {
    let dir = save_folder(&app)?;
    let target = unique(&dir, &clean_name(&name));
    let file_name = target.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let part = dir.join(format!("{file_name}.infimeety-part"));
    let file = fs::File::create(&part).map_err(|e| format!("Can't save here: {e}"))?;
    let id = saves.next.fetch_add(1, Ordering::Relaxed);
    saves.open.lock().unwrap().insert(id, Saving { file, part, target });
    Ok(Opened { id, name: file_name })
}

/// The next piece, in order.
#[tauri::command]
pub async fn save_write(saves: State<'_, Saves>, request: Request<'_>) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw bytes".into());
    };
    let id: u64 = request.headers().get("x-save").and_then(|v| v.to_str().ok()).and_then(|v| v.parse().ok()).ok_or("missing id")?;
    let mut open = saves.open.lock().unwrap();
    let saving = open.get_mut(&id).ok_or("unknown")?;
    saving.file.write_all(bytes).map_err(|e| e.to_string())
}

/// Puts the finished file in place, or with `ok` false throws the partial copy away.
#[tauri::command]
pub async fn save_close(saves: State<'_, Saves>, id: u64, ok: bool) -> Result<(), String> {
    let saving = saves.open.lock().unwrap().remove(&id).ok_or("unknown")?;
    let Saving { file, part, target } = saving;
    let synced = file.sync_all();
    drop(file);
    if !ok {
        let _ = fs::remove_file(&part);
        return Ok(());
    }
    synced.map_err(|e| e.to_string())?;
    fs::rename(&part, &target).map_err(|e| e.to_string())
}
