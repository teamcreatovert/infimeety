//! Local media sharing.
//!
//! Files posted in chat (images, GIFs, videos, documents, anything) never leave this PC
//! except when a friend streams them peer-to-peer. This registry remembers which files the user chose to
//! share (picked, dropped or pasted). The webview can only read files by registry id,
//! so a compromised page can't name arbitrary paths on disk.

use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    io::{Read, Seek, SeekFrom},
    path::PathBuf,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{
    ipc::{InvokeBody, Request, Response},
    AppHandle, Manager, State,
};
use tauri_plugin_dialog::DialogExt;

const MAX_FILE_SIZE: u64 = 2 * 1024 * 1024 * 1024;
const MAX_CHUNK: u64 = 4 * 1024 * 1024;

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
    dropped: Mutex<Vec<PathBuf>>,
    store: PathBuf,
    pasted_dir: PathBuf,
}

impl Registry {
    pub fn load(app: &AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let dir = app.path().app_data_dir()?;
        let pasted_dir = dir.join("Shared");
        fs::create_dir_all(&pasted_dir)?;
        let store = dir.join("shared-files.json");
        let files: HashMap<String, SharedFile> = fs::read(&store)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();

        // Let the app preview its own files through the asset protocol (supports video seeking).
        let scope = app.asset_protocol_scope();
        for file in files.values().filter(|f| previewable(&f.mime)) {
            let _ = scope.allow_file(&file.path);
        }
        Ok(Self { files: Mutex::new(files), dropped: Mutex::new(Vec::new()), store, pasted_dir })
    }

    pub fn set_dropped(&self, paths: Vec<PathBuf>) {
        *self.dropped.lock().unwrap() = paths;
    }

    fn persist(&self, files: &HashMap<String, SharedFile>) {
        if let Ok(bytes) = serde_json::to_vec_pretty(files) {
            let _ = fs::write(&self.store, bytes);
        }
    }

    fn register(&self, app: &AppHandle, paths: Vec<PathBuf>) -> Vec<SharedFile> {
        let mut files = self.files.lock().unwrap();
        let mut added = Vec::new();
        for path in paths {
            let Ok(meta) = fs::metadata(&path) else { continue };
            if !meta.is_file() || meta.len() > MAX_FILE_SIZE {
                continue;
            }
            let mime = mime_guess::from_path(&path).first_or_octet_stream().essence_str().to_string();
            let file = SharedFile {
                id: uuid::Uuid::new_v4().simple().to_string(),
                name: path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "file".into()),
                path: path.clone(),
                mime,
                size: meta.len(),
            };
            if previewable(&file.mime) {
                let _ = app.asset_protocol_scope().allow_file(&path);
            }
            files.insert(file.id.clone(), file.clone());
            added.push(file);
        }
        if !added.is_empty() {
            self.persist(&files);
        }
        added
    }

    fn get(&self, id: &str) -> Option<SharedFile> {
        self.files.lock().unwrap().get(id).cloned()
    }
}

/// Opens the native file picker and shares the chosen files.
#[tauri::command]
pub async fn media_pick(app: AppHandle, registry: State<'_, Registry>) -> Result<Vec<SharedFile>, String> {
    let picked = app.dialog().file().blocking_pick_files();
    let paths = picked.unwrap_or_default().into_iter().filter_map(|p| p.into_path().ok()).collect();
    Ok(registry.register(&app, paths))
}

/// Shares the files from the most recent drag-and-drop onto the window.
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

/// Saves a file received in chat wherever the user picks. Returns where, or nothing if cancelled.
#[tauri::command]
pub async fn media_save_as(app: AppHandle, request: Request<'_>) -> Result<Option<String>, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw bytes".into());
    };
    let name = request
        .headers()
        .get("x-file-name")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| percent_decode(v))
        .unwrap_or_else(|| "file".into());
    // The name comes from whoever sent the file: keep it a plain file name.
    let safe: String = name.chars().filter(|c| !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') && !c.is_control()).take(120).collect();
    let Some(target) = app.dialog().file().set_file_name(if safe.trim().is_empty() { "file" } else { safe.trim() }).blocking_save_file() else {
        return Ok(None);
    };
    let path = target.into_path().map_err(|e| e.to_string())?;
    fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Undoes JavaScript's encodeURIComponent (header values are ASCII-only).
fn percent_decode(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = std::str::from_utf8(bytes.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// Reads a chunk of a shared file as raw bytes (for peer-to-peer streaming).
#[tauri::command]
pub async fn media_read(registry: State<'_, Registry>, id: String, offset: u64, length: u64) -> Result<Response, String> {
    let file = registry.get(&id).ok_or("unknown")?;
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
        f.size = meta.len();
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
    }
    Ok(())
}
