//! Local file sharing.
//!
//! Files and folders posted in chat never leave this PC except when a friend streams them
//! peer-to-peer. This registry remembers what the user chose to share (picked, dropped or
//! pasted). The webview can only read files by registry id, so a compromised page can't
//! name arbitrary paths on disk.
//!
//! The other half receives: copies of what friends share are written straight into the
//! save folder the user picked, piece by piece and in any order (several connections deliver
//! parts of one file at once), so even huge files never sit in memory.

use crate::tarball::{self, TarEntry};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{
    ipc::{InvokeBody, Request, Response},
    AppHandle, Manager, State,
};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

const MAX_CHUNK: u64 = 8 * 1024 * 1024;
/// A shared folder's type; it streams as a tar archive and unpacks back into a folder.
const FOLDER_MIME: &str = "inode/directory";

/// Only media the chat shows inline is opened to the webview's asset protocol; other files
/// are only ever read in chunks for streaming.
fn previewable(mime: &str) -> bool {
    mime.starts_with("image/") || mime.starts_with("video/") || mime.starts_with("audio/")
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedFile {
    pub id: String,
    pub path: PathBuf,
    pub name: String,
    pub mime: String,
    pub size: u64,
}

pub struct Registry {
    files: Mutex<HashMap<String, SharedFile>>,
    /// A shared folder's files, laid out as the archive it streams as.
    folders: Mutex<HashMap<String, Arc<Vec<TarEntry>>>>,
    dropped: Mutex<Vec<PathBuf>>,
    store: PathBuf,
    folders_store: PathBuf,
    pasted_dir: PathBuf,
}

impl Registry {
    pub fn load(app: &AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let dir = app.path().app_data_dir()?;
        let pasted_dir = dir.join("Shared");
        fs::create_dir_all(&pasted_dir)?;
        let store = dir.join("shared-files.json");
        let folders_store = dir.join("shared-folders.json");
        let files: HashMap<String, SharedFile> = fs::read(&store)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        let folders: HashMap<String, Vec<TarEntry>> = fs::read(&folders_store)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();

        // Let the app preview its own files through the asset protocol (supports video seeking).
        let scope = app.asset_protocol_scope();
        for file in files.values().filter(|f| previewable(&f.mime)) {
            let _ = scope.allow_file(&file.path);
        }
        Ok(Self {
            files: Mutex::new(files),
            folders: Mutex::new(folders.into_iter().map(|(id, entries)| (id, Arc::new(entries))).collect()),
            dropped: Mutex::new(Vec::new()),
            store,
            folders_store,
            pasted_dir,
        })
    }

    pub fn set_dropped(&self, paths: Vec<PathBuf>) {
        *self.dropped.lock().unwrap() = paths;
    }

    fn persist(&self, files: &HashMap<String, SharedFile>) {
        if let Ok(bytes) = serde_json::to_vec_pretty(files) {
            let _ = fs::write(&self.store, bytes);
        }
    }

    fn persist_folders(&self) {
        let folders = self.folders.lock().unwrap();
        let plain: HashMap<&String, &Vec<TarEntry>> = folders.iter().map(|(id, entries)| (id, entries.as_ref())).collect();
        if let Ok(bytes) = serde_json::to_vec(&plain) {
            let _ = fs::write(&self.folders_store, bytes);
        }
    }

    fn register(&self, app: &AppHandle, paths: Vec<PathBuf>) -> Vec<SharedFile> {
        let mut added = Vec::new();
        let mut new_folders = false;
        for path in paths {
            let Ok(meta) = fs::metadata(&path) else { continue };
            let id = uuid::Uuid::new_v4().simple().to_string();
            let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "file".into());
            let file = if meta.is_dir() {
                let Ok((entries, size)) = tarball::layout(&path) else { continue };
                if entries.is_empty() {
                    continue;
                }
                self.folders.lock().unwrap().insert(id.clone(), Arc::new(entries));
                new_folders = true;
                SharedFile { id, path, name, mime: FOLDER_MIME.into(), size }
            } else if meta.is_file() {
                let mime = mime_guess::from_path(&path).first_or_octet_stream().essence_str().to_string();
                if previewable(&mime) {
                    let _ = app.asset_protocol_scope().allow_file(&path);
                }
                SharedFile { id, path, name, mime, size: meta.len() }
            } else {
                continue;
            };
            added.push(file);
        }
        if !added.is_empty() {
            let mut files = self.files.lock().unwrap();
            for file in &added {
                files.insert(file.id.clone(), file.clone());
            }
            self.persist(&files);
        }
        if new_folders {
            self.persist_folders();
        }
        added
    }

    fn get(&self, id: &str) -> Option<SharedFile> {
        self.files.lock().unwrap().get(id).cloned()
    }

    fn folder(&self, id: &str) -> Option<Arc<Vec<TarEntry>>> {
        self.folders.lock().unwrap().get(id).cloned()
    }

    fn forget(&self, ids: &[String]) {
        let mut folders = self.folders.lock().unwrap();
        let before = folders.len();
        for id in ids {
            folders.remove(id);
        }
        let changed = folders.len() != before;
        drop(folders);
        if changed {
            self.persist_folders();
        }
    }
}

/// Opens the native file picker and shares the chosen files.
#[tauri::command]
pub async fn media_pick(app: AppHandle, registry: State<'_, Registry>) -> Result<Vec<SharedFile>, String> {
    let picked = app.dialog().file().blocking_pick_files();
    let paths = picked.unwrap_or_default().into_iter().filter_map(|p| p.into_path().ok()).collect();
    Ok(registry.register(&app, paths))
}

/// Opens the native folder picker and shares the chosen folder (it copies over as a whole).
#[tauri::command]
pub async fn media_pick_folder(app: AppHandle, registry: State<'_, Registry>) -> Result<Vec<SharedFile>, String> {
    let picked = app.dialog().file().set_title("Share a folder").blocking_pick_folder();
    let paths = picked.and_then(|p| p.into_path().ok()).into_iter().collect();
    Ok(registry.register(&app, paths))
}

/// Shares the files (and folders) from the most recent drag-and-drop onto the window.
#[tauri::command]
pub async fn media_take_dropped(app: AppHandle, registry: State<'_, Registry>) -> Result<Vec<SharedFile>, String> {
    let paths = std::mem::take(&mut *registry.dropped.lock().unwrap());
    Ok(registry.register(&app, paths))
}

/// Saves pasted clipboard bytes into the app's Shared folder and shares them.
#[tauri::command]
pub async fn media_save_bytes(
    app: AppHandle,
    registry: State<'_, Registry>,
    request: Request<'_>,
) -> Result<SharedFile, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw bytes".into());
    };
    let name = request.headers().get("x-file-name").and_then(|v| v.to_str().ok()).unwrap_or("pasted.png");
    let safe: String = name.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_')).take(80).collect();
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let path = registry.pasted_dir.join(format!("{stamp}-{}", if safe.is_empty() { "pasted.png" } else { &safe }));
    fs::write(&path, bytes).map_err(|e| e.to_string())?;
    registry.register(&app, vec![path]).into_iter().next().ok_or_else(|| "unsupported file type".into())
}

/// Reads a chunk of a shared file (or of a shared folder's archive) for peer-to-peer streaming.
#[tauri::command]
pub async fn media_read(registry: State<'_, Registry>, id: String, offset: u64, length: u64) -> Result<Response, String> {
    let file = registry.get(&id).ok_or("unknown")?;
    if file.mime == FOLDER_MIME {
        let entries = registry.folder(&id).ok_or("unknown")?;
        return tarball::read(&file.path, &entries, file.size, offset, length.min(MAX_CHUNK)).map(Response::new);
    }
    let mut handle = fs::File::open(&file.path).map_err(|_| "gone")?;
    handle.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
    let mut buf = Vec::with_capacity(length.min(MAX_CHUNK) as usize);
    handle.take(length.min(MAX_CHUNK)).read_to_end(&mut buf).map_err(|e| e.to_string())?;
    Ok(Response::new(buf))
}

/// Returns the file if it is still shared and present on disk.
#[tauri::command]
pub async fn media_stat(registry: State<'_, Registry>, id: String) -> Result<Option<SharedFile>, String> {
    Ok(registry.get(&id).and_then(|mut f| {
        let meta = fs::metadata(&f.path).ok()?;
        // A folder's size is its archive's, fixed when it was shared.
        if f.mime != FOLDER_MIME {
            f.size = meta.len();
        }
        Some(f)
    }))
}

/// Finds shared files that were deleted from disk, forgets them and returns their ids.
#[tauri::command]
pub async fn media_missing(registry: State<'_, Registry>) -> Result<Vec<String>, String> {
    let mut files = registry.files.lock().unwrap();
    let missing: Vec<String> = files.values().filter(|f| !f.path.exists()).map(|f| f.id.clone()).collect();
    if !missing.is_empty() {
        for id in &missing {
            files.remove(id);
        }
        registry.persist(&files);
        drop(files);
        registry.forget(&missing);
    }
    Ok(missing)
}

/// Stops sharing a file (e.g. after its message was deleted). Pasted copies are deleted too.
#[tauri::command]
pub async fn media_forget(registry: State<'_, Registry>, id: String) -> Result<(), String> {
    let mut files = registry.files.lock().unwrap();
    if let Some(file) = files.remove(&id) {
        if file.path.starts_with(&registry.pasted_dir) {
            let _ = fs::remove_file(&file.path);
        }
        registry.persist(&files);
        drop(files);
        registry.forget(&[id]);
    }
    Ok(())
}

/// Shows a shared or received file in Explorer / Finder. By id, so the page can't point at arbitrary paths.
#[tauri::command]
pub fn media_reveal(app: AppHandle, registry: State<'_, Registry>, id: String) -> Result<(), String> {
    let file = registry.get(&id).ok_or("unknown")?;
    app.opener().reveal_item_in_dir(&file.path).map_err(|e| e.to_string())
}

// ─── Receiving copies ──────────────────────────────────────────────────────────

/// The user picks the folder copies are saved to (asked once, changeable in Settings).
#[tauri::command]
pub async fn media_choose_folder(app: AppHandle, title: String) -> Result<Option<String>, String> {
    let mut dialog = app.dialog().file().set_title(title);
    if let Ok(downloads) = app.path().download_dir() {
        dialog = dialog.set_directory(downloads);
    }
    Ok(dialog.blocking_pick_folder().and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().into_owned()))
}

struct Receiving {
    file: fs::File,
    /// Where the bytes land until the copy is complete.
    part: PathBuf,
    target: PathBuf,
    folder: bool,
}

/// Copies being received, by id. Each has its own lock so several copies write at once.
#[derive(Default)]
pub struct Receivers(Mutex<HashMap<String, Arc<Mutex<Receiving>>>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiveTarget {
    id: String,
    path: PathBuf,
}

/// A name a friend chose, made safe to use as one file name on any system.
fn clean_name(name: &str) -> String {
    let cleaned: String = name.chars().map(|c| if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control() { '_' } else { c }).take(150).collect();
    let cleaned = cleaned.trim().trim_end_matches(['.', ' ']).to_string();
    let reserved = ["CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "LPT1", "LPT2", "LPT3"];
    let stem = cleaned.split('.').next().unwrap_or("").to_ascii_uppercase();
    if cleaned.is_empty() || (cleaned.starts_with('.') && cleaned.len() <= 2) {
        "file".into()
    } else if reserved.contains(&stem.as_str()) {
        format!("_{cleaned}")
    } else {
        cleaned
    }
}

/// `name` in `dir`, or "name (2).ext", "name (3).ext"… if it's taken.
fn unique(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    (2..10_000).map(|n| dir.join(format!("{stem} ({n}){ext}"))).find(|p| !p.exists()).unwrap_or(first)
}

/// Starts receiving a copy of `size` bytes into `dir`. A folder arrives as an archive and is
/// unpacked when complete.
#[tauri::command]
pub async fn media_receive_open(receivers: State<'_, Receivers>, dir: String, name: String, size: u64, folder: bool) -> Result<ReceiveTarget, String> {
    let dir = PathBuf::from(dir);
    fs::create_dir_all(&dir).map_err(|e| format!("Can't save to that folder: {e}"))?;
    let target = unique(&dir, &clean_name(&name));
    let part_name = format!("{}.infimeety-part", target.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default());
    let part = dir.join(part_name);
    let file = fs::OpenOptions::new().create(true).write(true).truncate(true).open(&part).map_err(|e| format!("Can't save to that folder: {e}"))?;
    // Reserve the space up front: a full disk fails now, not at 90%.
    file.set_len(size).map_err(|e| format!("Not enough space: {e}"))?;
    let id = uuid::Uuid::new_v4().simple().to_string();
    receivers.0.lock().unwrap().insert(id.clone(), Arc::new(Mutex::new(Receiving { file, part, target: target.clone(), folder })));
    Ok(ReceiveTarget { id, path: target })
}

/// Writes one piece of a copy at its place in the file.
#[tauri::command]
pub async fn media_receive_write(receivers: State<'_, Receivers>, request: Request<'_>) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw bytes".into());
    };
    let header = |name: &str| request.headers().get(name).and_then(|v| v.to_str().ok());
    let id = header("x-receive").ok_or("missing id")?;
    let offset: u64 = header("x-offset").and_then(|v| v.parse().ok()).ok_or("missing offset")?;
    let receiving = receivers.0.lock().unwrap().get(id).cloned().ok_or("unknown")?;
    let mut r = receiving.lock().unwrap();
    r.file.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
    r.file.write_all(bytes).map_err(|e| e.to_string())
}

/// Finishes a copy: puts the file (or unpacked folder) in place and shares it on, so it can be
/// played and passed along from this PC. With `ok` false the partial copy is deleted.
#[tauri::command]
pub async fn media_receive_close(
    app: AppHandle,
    registry: State<'_, Registry>,
    receivers: State<'_, Receivers>,
    id: String,
    ok: bool,
) -> Result<Option<SharedFile>, String> {
    let receiving = receivers.0.lock().unwrap().remove(&id).ok_or("unknown")?;
    let (part, target, folder) = {
        let r = receiving.lock().unwrap();
        let _ = r.file.sync_all();
        (r.part.clone(), r.target.clone(), r.folder)
    };
    drop(receiving);
    if !ok {
        let _ = fs::remove_file(&part);
        return Ok(None);
    }
    let placed = tauri::async_runtime::spawn_blocking(move || -> Result<PathBuf, String> {
        let target = if target.exists() { unique(target.parent().unwrap_or(Path::new(".")), &target.file_name().unwrap_or_default().to_string_lossy()) } else { target };
        if folder {
            let unpacked = tarball::unpack(&part, &target).map_err(|e| format!("Couldn't unpack the folder: {e}"));
            let _ = fs::remove_file(&part);
            unpacked?;
        } else {
            fs::rename(&part, &target).map_err(|e| e.to_string())?;
        }
        Ok(target)
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(registry.register(&app, vec![placed]).into_iter().next())
}
