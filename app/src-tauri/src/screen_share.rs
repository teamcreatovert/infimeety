//! Native screen sharing on Windows, like Discord and OBS.
//!
//! WebView2's own screen sharing shows Edge's picker ("Choose what to share with
//! http://tauri.localhost") and a "…is sharing your screen · Stop sharing · Hide" bar that no
//! setting removes. So the app captures by itself with Windows.Graphics.Capture: Infimeety's
//! own picker lists screens and windows (`screen_sources`), and the chosen one streams into the
//! page (`screen_share_start`).
//!
//! Frames travel through memory shared with the page (a WebView2 shared buffer, three slots):
//! each frame is copied into the next slot and announced with a small web message; the page
//! turns it into a video track (lib/voice/nativeScreen.ts). A 4K screen is halved on the GPU
//! first, so at most about 1080p crosses over.

use serde::Serialize;
use std::cell::RefCell;
use std::sync::{Arc, Mutex};
use tauri::{State, Webview};
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2Environment12, ICoreWebView2SharedBuffer, ICoreWebView2_17, COREWEBVIEW2_SHARED_BUFFER_ACCESS_READ_ONLY,
};
use windows::core::{Interface, BOOL, HSTRING};
use windows::Foundation::TypedEventHandler;
use windows::Graphics::Capture::{Direct3D11CaptureFramePool, GraphicsCaptureItem, GraphicsCaptureSession};
use windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
use windows::Graphics::DirectX::DirectXPixelFormat;
use windows::Graphics::SizeInt32;
use windows::Win32::Foundation::{HMODULE, HWND, LPARAM, RECT};
use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_HARDWARE;
use windows::Win32::Graphics::Direct3D11::*;
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS};
use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_SAMPLE_DESC};
use windows::Win32::Graphics::Dxgi::IDXGIDevice;
use windows::Win32::Graphics::Gdi::*;
use windows::Win32::Storage::Xps::{PrintWindow, PRINT_WINDOW_FLAGS};
use windows::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};
use windows::Win32::System::WinRT::Direct3D11::{CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess};
use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;
use windows::Win32::UI::WindowsAndMessaging::*;

/// Slots in the shared buffer: the page reads one while the next two are written.
const SLOTS: usize = 3;
/// Frames are halved on the GPU until they are at most this tall (4K becomes 1080p).
const TARGET_HEIGHT: i32 = 1080;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    id: String,
    kind: &'static str,
    name: String,
    app: String,
    thumb: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Started {
    width: i32,
    height: i32,
}

/// The running share, if any.
#[derive(Default)]
pub struct ScreenShare(Mutex<Option<Running>>);

struct Running {
    pipeline: Arc<Mutex<Pipeline>>,
    /// Kept for the whole share: its Closed event (a shared window closing) needs it alive.
    item: GraphicsCaptureItem,
    session: GraphicsCaptureSession,
    pool: Direct3D11CaptureFramePool,
    webview: Webview,
}

// The buffer lives on the UI thread with the webview; capture threads only write its memory.
thread_local! {
    static BUFFER: RefCell<Option<ICoreWebView2SharedBuffer>> = const { RefCell::new(None) };
}

// ─── Sources ────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn screen_sources() -> Result<Vec<Source>, String> {
    tauri::async_runtime::spawn_blocking(|| unsafe { list_sources() }).await.map_err(|e| e.to_string())
}

unsafe fn list_sources() -> Vec<Source> {
    let mut out = Vec::new();
    let screen = GetDC(None);
    for (i, (monitor, r)) in monitors().into_iter().enumerate() {
        let (w, h) = (r.right - r.left, r.bottom - r.top);
        out.push(Source {
            id: format!("screen:{}", monitor.0 as isize),
            kind: "screen",
            name: format!("Screen {}", i + 1),
            app: format!("{w} × {h}"),
            thumb: thumbnail(screen, r.left, r.top, w, h),
        });
    }
    let own = std::process::id();
    let mut windows: Vec<HWND> = Vec::new();
    let _ = EnumWindows(Some(collect_window), LPARAM(&mut windows as *mut Vec<HWND> as isize));
    for hwnd in windows {
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == own {
            continue;
        }
        let mut title = [0u16; 256];
        let len = GetWindowTextW(hwnd, &mut title);
        let name = String::from_utf16_lossy(&title[..len.max(0) as usize]);
        let mut rect = RECT::default();
        if DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, &mut rect as *mut RECT as _, size_of::<RECT>() as u32).is_err() {
            let _ = GetWindowRect(hwnd, &mut rect);
        }
        let (w, h) = (rect.right - rect.left, rect.bottom - rect.top);
        if w < 64 || h < 48 {
            continue;
        }
        out.push(Source { id: format!("window:{}", hwnd.0 as isize), kind: "window", name, app: process_name(pid), thumb: window_thumbnail(hwnd, w, h, screen) });
    }
    ReleaseDC(None, screen);
    out
}

/// Windows a person would pick: visible, titled, top-level app windows (not tool windows,
/// minimized ones or the hidden "cloaked" ones Windows keeps for other desktops and the Store).
unsafe extern "system" fn collect_window(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let list = &mut *(lparam.0 as *mut Vec<HWND>);
    let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
    let mut cloaked = 0u32;
    let _ = DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, &mut cloaked as *mut u32 as _, 4);
    if IsWindowVisible(hwnd).as_bool()
        && !IsIconic(hwnd).as_bool()
        && GetWindowTextLengthW(hwnd) > 0
        && style & WS_EX_TOOLWINDOW.0 == 0
        && GetWindow(hwnd, GW_OWNER).map_or(true, |o| o.is_invalid())
        && cloaked == 0
    {
        list.push(hwnd);
    }
    true.into()
}

unsafe fn monitors() -> Vec<(HMONITOR, RECT)> {
    unsafe extern "system" fn each(monitor: HMONITOR, _: HDC, _: *mut RECT, lparam: LPARAM) -> BOOL {
        let list = &mut *(lparam.0 as *mut Vec<(HMONITOR, RECT)>);
        let mut info = MONITORINFO { cbSize: size_of::<MONITORINFO>() as u32, ..Default::default() };
        if GetMonitorInfoW(monitor, &mut info).as_bool() {
            // The main screen first, like Discord.
            if info.dwFlags & MONITORINFOF_PRIMARY != 0 {
                list.insert(0, (monitor, info.rcMonitor));
            } else {
                list.push((monitor, info.rcMonitor));
            }
        }
        true.into()
    }
    let mut list: Vec<(HMONITOR, RECT)> = Vec::new();
    let _ = EnumDisplayMonitors(None, None, Some(each), LPARAM(&mut list as *mut _ as isize));
    list
}

unsafe fn process_name(pid: u32) -> String {
    let Ok(process) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else { return String::new() };
    let mut buf = [0u16; 520];
    let mut len = buf.len() as u32;
    let ok = QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, windows::core::PWSTR(buf.as_mut_ptr()), &mut len).is_ok();
    let _ = windows::Win32::Foundation::CloseHandle(process);
    if !ok {
        return String::new();
    }
    let path = String::from_utf16_lossy(&buf[..len as usize]);
    // The app's own name ("Google Chrome", "WhatsApp"), not its file name ("chrome", "WhatsApp.Root").
    let stem = std::path::Path::new(&path).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    // Store apps all run inside ApplicationFrameHost; their window title already says which app.
    if stem.eq_ignore_ascii_case("ApplicationFrameHost") {
        return String::new();
    }
    describe(&path).unwrap_or(stem)
}

/// The FileDescription in an exe's version details, if it has one.
unsafe fn describe(path: &str) -> Option<String> {
    use windows::Win32::Storage::FileSystem::{GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW};
    let file = HSTRING::from(path);
    let size = GetFileVersionInfoSizeW(&file, None);
    if size == 0 {
        return None;
    }
    let mut data = vec![0u8; size as usize];
    GetFileVersionInfoW(&file, None, size, data.as_mut_ptr() as _).ok()?;
    // The first language the file lists.
    let mut langs = std::ptr::null_mut();
    let mut n = 0u32;
    if !VerQueryValueW(data.as_ptr() as _, &HSTRING::from(r"\VarFileInfo\Translation"), &mut langs, &mut n).as_bool() || n < 4 {
        return None;
    }
    let lang = *(langs as *const u16);
    let page = *(langs as *const u16).add(1);
    let mut text = std::ptr::null_mut();
    let key = HSTRING::from(format!(r"\StringFileInfo\{lang:04x}{page:04x}\FileDescription"));
    if !VerQueryValueW(data.as_ptr() as _, &key, &mut text, &mut n).as_bool() || n <= 1 {
        return None;
    }
    let name = String::from_utf16_lossy(std::slice::from_raw_parts(text as *const u16, n as usize - 1)).trim().to_string();
    // Store apps all run inside "Application Frame Host": their window title is the better name.
    // Packaged apps sometimes describe themselves as "WhatsApp.Root".
    let name = name.trim_end_matches(".Root").to_string();
    (!name.is_empty() && !name.contains("Application Frame Host")).then_some(name)
}

/// A window drawn into memory (it may be behind others), then shrunk into a thumbnail.
unsafe fn window_thumbnail(hwnd: HWND, w: i32, h: i32, screen: HDC) -> String {
    let dc = CreateCompatibleDC(Some(screen));
    let bitmap = CreateCompatibleBitmap(screen, w, h);
    let old = SelectObject(dc, bitmap.into());
    // PW_RENDERFULLCONTENT (2): also windows drawn by the GPU, like browsers and games.
    let _ = PrintWindow(hwnd, dc, PRINT_WINDOW_FLAGS(2));
    let thumb = thumbnail(dc, 0, 0, w, h);
    SelectObject(dc, old);
    let _ = DeleteObject(bitmap.into());
    let _ = DeleteDC(dc);
    thumb
}

/// A 240-pixel-wide picture of part of `src`, as a BMP data URL the page can show directly.
unsafe fn thumbnail(src: HDC, x: i32, y: i32, w: i32, h: i32) -> String {
    let tw = 240i32;
    let th = ((h as i64 * tw as i64 / w.max(1) as i64) as i32).clamp(1, 180);
    let dc = CreateCompatibleDC(Some(src));
    let mut info = BITMAPINFO::default();
    info.bmiHeader = BITMAPINFOHEADER {
        biSize: size_of::<BITMAPINFOHEADER>() as u32,
        biWidth: tw,
        biHeight: -th,
        biPlanes: 1,
        biBitCount: 24,
        biCompression: BI_RGB.0,
        ..Default::default()
    };
    let mut bits = std::ptr::null_mut();
    let Ok(dib) = CreateDIBSection(Some(dc), &info, DIB_RGB_COLORS, &mut bits, None, 0) else {
        let _ = DeleteDC(dc);
        return String::new();
    };
    let old = SelectObject(dc, dib.into());
    SetStretchBltMode(dc, HALFTONE);
    let _ = StretchBlt(dc, 0, 0, tw, th, Some(src), x, y, w, h, SRCCOPY);
    let _ = GdiFlush();
    let row = ((tw * 3 + 3) & !3) as usize;
    let pixels = std::slice::from_raw_parts(bits as *const u8, row * th as usize);
    let mut bmp = Vec::with_capacity(54 + pixels.len());
    let file_size = 54 + pixels.len() as u32;
    bmp.extend_from_slice(b"BM");
    bmp.extend_from_slice(&file_size.to_le_bytes());
    bmp.extend_from_slice(&0u32.to_le_bytes());
    bmp.extend_from_slice(&54u32.to_le_bytes());
    bmp.extend_from_slice(&40u32.to_le_bytes());
    bmp.extend_from_slice(&tw.to_le_bytes());
    bmp.extend_from_slice(&(-th).to_le_bytes());
    bmp.extend_from_slice(&1u16.to_le_bytes());
    bmp.extend_from_slice(&24u16.to_le_bytes());
    bmp.extend_from_slice(&[0u8; 24]);
    bmp.extend_from_slice(pixels);
    SelectObject(dc, old);
    let _ = DeleteObject(dib.into());
    let _ = DeleteDC(dc);
    format!("data:image/bmp;base64,{}", base64(&bmp))
}

fn base64(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let n = (chunk[0] as u32) << 16 | (*chunk.get(1).unwrap_or(&0) as u32) << 8 | *chunk.get(2).unwrap_or(&0) as u32;
        for (i, shift) in [18, 12, 6, 0].into_iter().enumerate() {
            out.push(if i <= chunk.len() { T[(n >> shift & 63) as usize] as char } else { '=' });
        }
    }
    out
}

// ─── Capture ────────────────────────────────────────────────────────────────

struct Pipeline {
    context: ID3D11DeviceContext,
    device: ID3D11Device,
    d3d: IDirect3DDevice,
    size: SizeInt32,
    /// The GPU texture that halves big frames (level 0 = full size), with its view.
    mips: Option<(ID3D11Texture2D, ID3D11ShaderResourceView, i32, i32, u32)>,
    /// Where finished frames are read back from the GPU.
    staging: Option<(ID3D11Texture2D, i32, i32)>,
    /// The shared buffer's memory, `SLOTS` frames of `slot` bytes.
    memory: usize,
    slot: usize,
    next: usize,
    seq: u64,
    /// Fewest 100-ns ticks between frames sent (the chosen frame rate).
    interval: i64,
    last: i64,
    stopped: bool,
    webview: Webview,
}

// SAFETY: the D3D objects are only used under the pipeline's lock, one frame at a time; the
// buffer memory stays valid until `stopped` is set under the same lock.
unsafe impl Send for Pipeline {}

#[tauri::command]
pub async fn screen_share_start(webview: Webview, state: State<'_, ScreenShare>, id: String, fps: u32) -> Result<Started, String> {
    stop(&state);
    let item = capture_item(&id).map_err(|e| format!("Couldn't open that {}: {e}", if id.starts_with("window") { "window" } else { "screen" }))?;
    let size = item.Size().map_err(|e| e.to_string())?;
    // Room for the biggest frame this share can send: the largest screen, halved like frames are.
    let (mut mw, mut mh) = unsafe { monitors() }.iter().fold((size.Width, size.Height), |(w, h), (_, r)| (w.max(r.right - r.left), h.max(r.bottom - r.top)));
    while mh > TARGET_HEIGHT * 3 / 2 {
        mw /= 2;
        mh /= 2;
    }
    let slot = (mw * mh * 4) as usize;
    let memory = create_buffer(&webview, slot * SLOTS)?;

    let (device, context) = unsafe { d3d_device() }.map_err(|e| e.to_string())?;
    let d3d: IDirect3DDevice = unsafe { CreateDirect3D11DeviceFromDXGIDevice(&device.cast::<IDXGIDevice>().map_err(|e| e.to_string())?) }
        .and_then(|i| i.cast())
        .map_err(|e| e.to_string())?;
    let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(&d3d, DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, size).map_err(|e| e.to_string())?;
    let session = pool.CreateCaptureSession(&item).map_err(|e| e.to_string())?;
    let _ = session.SetIsCursorCaptureEnabled(true);
    // Windows 11: no yellow border around what's shared. Older systems keep it.
    let _ = session.SetIsBorderRequired(false);

    let pipeline = Arc::new(Mutex::new(Pipeline {
        context,
        device,
        d3d,
        size,
        mips: None,
        staging: None,
        memory,
        slot,
        next: 0,
        seq: 0,
        interval: 10_000_000 / fps.clamp(5, 60) as i64 - 20_000,
        last: 0,
        stopped: false,
        webview: webview.clone(),
    }));
    let frames = pipeline.clone();
    pool.FrameArrived(&TypedEventHandler::new(move |pool: windows::core::Ref<Direct3D11CaptureFramePool>, _| {
        if let Some(pool) = pool.as_ref() {
            if let Ok(mut p) = frames.lock() {
                let _ = unsafe { p.frame(pool) };
            }
        }
        Ok(())
    }))
    .map_err(|e| e.to_string())?;
    // The shared window closed: the page ends the share.
    let ended = webview.clone();
    let _ = item.Closed(&TypedEventHandler::new(move |_, _| {
        post(&ended, r#"{"infimeety":"screen","t":"ended"}"#.into());
        Ok(())
    }));
    session.StartCapture().map_err(|e| e.to_string())?;
    // Backup for the Closed event: a shared window that no longer exists ends the share.
    if let Some(raw) = id.strip_prefix("window:").and_then(|r| r.parse::<isize>().ok()) {
        let (watch, gone) = (pipeline.clone(), webview.clone());
        std::thread::spawn(move || loop {
            std::thread::sleep(std::time::Duration::from_secs(1));
            if watch.lock().map_or(true, |p| p.stopped) {
                break;
            }
            if !unsafe { IsWindow(Some(HWND(raw as *mut core::ffi::c_void))) }.as_bool() {
                post(&gone, r#"{"infimeety":"screen","t":"ended"}"#.into());
                break;
            }
        });
    }
    *state.0.lock().unwrap() = Some(Running { pipeline, item, session, pool, webview });
    Ok(Started { width: size.Width, height: size.Height })
}

#[tauri::command]
pub fn screen_share_stop(state: State<'_, ScreenShare>) {
    stop(&state);
}

fn stop(state: &ScreenShare) {
    let Some(running) = state.0.lock().unwrap().take() else { return };
    // Under the lock: no frame is being written, and none will be after this.
    if let Ok(mut p) = running.pipeline.lock() {
        p.stopped = true;
    }
    let _ = running.session.Close();
    drop(running.item);
    let _ = running.pool.Close();
    let _ = running.webview.with_webview(|_| {
        BUFFER.with(|b| {
            if let Some(buffer) = b.borrow_mut().take() {
                let _ = unsafe { buffer.Close() };
            }
        })
    });
}

fn capture_item(id: &str) -> windows::core::Result<GraphicsCaptureItem> {
    let interop = windows::core::factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()?;
    let (kind, raw) = id.split_once(':').unwrap_or(("", ""));
    let handle = raw.parse::<isize>().unwrap_or(0) as *mut core::ffi::c_void;
    unsafe {
        match kind {
            "window" => interop.CreateForWindow(HWND(handle)),
            _ => interop.CreateForMonitor(HMONITOR(handle)),
        }
    }
}

unsafe fn d3d_device() -> windows::core::Result<(ID3D11Device, ID3D11DeviceContext)> {
    let mut device = None;
    let mut context = None;
    D3D11CreateDevice(None, D3D_DRIVER_TYPE_HARDWARE, HMODULE::default(), D3D11_CREATE_DEVICE_BGRA_SUPPORT, None, D3D11_SDK_VERSION, Some(&mut device), None, Some(&mut context))?;
    Ok((device.unwrap(), context.unwrap()))
}

/// Makes the shared buffer on the UI thread and hands it to the page; returns its memory.
fn create_buffer(webview: &Webview, size: usize) -> Result<usize, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    webview
        .with_webview(move |platform| {
            let made = (|| unsafe {
                let env: ICoreWebView2Environment12 = platform.environment().cast()?;
                let buffer = env.CreateSharedBuffer(size as u64)?;
                let mut memory = std::ptr::null_mut();
                buffer.Buffer(&mut memory)?;
                let core: ICoreWebView2_17 = platform.controller().CoreWebView2()?.cast()?;
                let meta = HSTRING::from(format!(r#"{{"infimeety":"screen","slots":{SLOTS},"slot":{}}}"#, size / SLOTS));
                core.PostSharedBufferToScript(&buffer, COREWEBVIEW2_SHARED_BUFFER_ACCESS_READ_ONLY, &meta)?;
                BUFFER.with(|b| {
                    if let Some(old) = b.borrow_mut().replace(buffer) {
                        let _ = old.Close();
                    }
                });
                windows::core::Result::Ok(memory as usize)
            })();
            let _ = tx.send(made.map_err(|e| e.to_string()));
        })
        .map_err(|e| e.to_string())?;
    rx.recv_timeout(std::time::Duration::from_secs(5)).map_err(|_| "The window went away".to_string())?
}

/// A small message to the page, sent from the UI thread.
fn post(webview: &Webview, json: String) {
    let _ = webview.with_webview(move |platform| unsafe {
        if let Ok(core) = platform.controller().CoreWebView2() {
            let _ = core.PostWebMessageAsJson(&HSTRING::from(json));
        }
    });
}

impl Pipeline {
    unsafe fn frame(&mut self, pool: &Direct3D11CaptureFramePool) -> windows::core::Result<()> {
        let frame = pool.TryGetNextFrame()?;
        if self.stopped {
            return Ok(());
        }
        let content = frame.ContentSize()?;
        // A window was resized: the pool follows (from the next frame on).
        if content.Width != self.size.Width || content.Height != self.size.Height {
            self.size = content;
            pool.Recreate(&self.d3d, DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, content)?;
        }
        let time = frame.SystemRelativeTime()?.Duration;
        if time - self.last < self.interval {
            return Ok(());
        }
        self.last = time;

        let texture: ID3D11Texture2D = frame.Surface()?.cast::<IDirect3DDxgiInterfaceAccess>()?.GetInterface()?;
        let mut desc = D3D11_TEXTURE2D_DESC::default();
        texture.GetDesc(&mut desc);
        let (w, h) = (content.Width.min(desc.Width as i32).max(1), content.Height.min(desc.Height as i32).max(1));
        // Halve until it's about 1080p and fits a slot.
        let mut level = 0u32;
        while (h >> level) > TARGET_HEIGHT * 3 / 2 || ((w >> level) * (h >> level) * 4) as usize > self.slot {
            level += 1;
        }
        let (ow, oh) = ((w >> level).max(1), (h >> level).max(1));
        let staging = self.staging_for(ow, oh)?;
        let region = D3D11_BOX { left: 0, top: 0, front: 0, right: w as u32, bottom: h as u32, back: 1 };
        if level == 0 {
            self.context.CopySubresourceRegion(&staging, 0, 0, 0, 0, &texture, 0, Some(&region));
        } else {
            let (mips, view) = self.mips_for(w, h, level + 1)?;
            self.context.CopySubresourceRegion(&mips, 0, 0, 0, 0, &texture, 0, Some(&region));
            self.context.GenerateMips(&view);
            self.context.CopySubresourceRegion(&staging, 0, 0, 0, 0, &mips, level, None);
        }
        let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
        self.context.Map(&staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped))?;
        let slot = self.next;
        let dst = (self.memory + slot * self.slot) as *mut u8;
        let row = ow as usize * 4;
        for y in 0..oh as usize {
            std::ptr::copy_nonoverlapping((mapped.pData as *const u8).add(y * mapped.RowPitch as usize), dst.add(y * row), row);
        }
        self.context.Unmap(&staging, 0);
        self.next = (slot + 1) % SLOTS;
        self.seq += 1;
        post(
            &self.webview,
            format!(r#"{{"infimeety":"screen","t":"frame","slot":{slot},"w":{ow},"h":{oh},"seq":{},"time":{}}}"#, self.seq, time / 10),
        );
        Ok(())
    }

    unsafe fn staging_for(&mut self, w: i32, h: i32) -> windows::core::Result<ID3D11Texture2D> {
        if let Some((t, sw, sh)) = &self.staging {
            if *sw == w && *sh == h {
                return Ok(t.clone());
            }
        }
        let desc = D3D11_TEXTURE2D_DESC {
            Width: w as u32,
            Height: h as u32,
            MipLevels: 1,
            ArraySize: 1,
            Format: DXGI_FORMAT_B8G8R8A8_UNORM,
            SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
            Usage: D3D11_USAGE_STAGING,
            BindFlags: 0,
            CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
            MiscFlags: 0,
        };
        let mut texture = None;
        self.device.CreateTexture2D(&desc, None, Some(&mut texture))?;
        let texture = texture.unwrap();
        self.staging = Some((texture.clone(), w, h));
        Ok(texture)
    }

    unsafe fn mips_for(&mut self, w: i32, h: i32, levels: u32) -> windows::core::Result<(ID3D11Texture2D, ID3D11ShaderResourceView)> {
        if let Some((t, v, mw, mh, ml)) = &self.mips {
            if *mw == w && *mh == h && *ml == levels {
                return Ok((t.clone(), v.clone()));
            }
        }
        let desc = D3D11_TEXTURE2D_DESC {
            Width: w as u32,
            Height: h as u32,
            MipLevels: levels,
            ArraySize: 1,
            Format: DXGI_FORMAT_B8G8R8A8_UNORM,
            SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
            Usage: D3D11_USAGE_DEFAULT,
            BindFlags: (D3D11_BIND_SHADER_RESOURCE.0 | D3D11_BIND_RENDER_TARGET.0) as u32,
            CPUAccessFlags: 0,
            MiscFlags: D3D11_RESOURCE_MISC_GENERATE_MIPS.0 as u32,
        };
        let mut texture = None;
        self.device.CreateTexture2D(&desc, None, Some(&mut texture))?;
        let texture = texture.unwrap();
        let mut view = None;
        self.device.CreateShaderResourceView(&texture, None, Some(&mut view))?;
        let view = view.unwrap();
        self.mips = Some((texture.clone(), view.clone(), w, h, levels));
        Ok((texture, view))
    }
}
