//! The who's-talking overlay, drawn natively (Direct2D on a layered window) instead of in a
//! second browser window: a few MB instead of a whole web page, and close to nothing per frame
//! over a game. Click-through, always on top, never takes focus. The main window sends it the
//! state (`overlay_state`), avatars once each (`overlay_avatar`) and message notes.

use serde::Deserialize;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use windows::core::{w, Interface, PCWSTR};
use windows::Win32::Foundation::{COLORREF, HWND, LPARAM, LRESULT, POINT, SIZE, WPARAM};
use windows::Win32::Graphics::Direct2D::Common::{D2D1_ALPHA_MODE_PREMULTIPLIED, D2D1_COLOR_F, D2D1_PIXEL_FORMAT, D2D_RECT_F};
use windows::Win32::Graphics::Direct2D::{
    D2D1CreateFactory, ID2D1Factory, ID2D1RenderTarget, D2D1_BITMAP_INTERPOLATION_MODE_LINEAR, D2D1_DRAW_TEXT_OPTIONS_NONE, D2D1_ELLIPSE,
    D2D1_FACTORY_TYPE_SINGLE_THREADED, D2D1_FEATURE_LEVEL_DEFAULT, D2D1_RENDER_TARGET_PROPERTIES, D2D1_RENDER_TARGET_USAGE_NONE, D2D1_ROUNDED_RECT,
    D2D1_TEXT_ANTIALIAS_MODE_GRAYSCALE,
};
use windows::Win32::Graphics::DirectWrite::{
    DWriteCreateFactory, IDWriteFactory, IDWriteTextFormat, IDWriteTextLayout, DWRITE_FACTORY_TYPE_SHARED, DWRITE_FONT_STRETCH_NORMAL, DWRITE_FONT_STYLE_NORMAL, DWRITE_FONT_WEIGHT_BOLD,
    DWRITE_FONT_WEIGHT_NORMAL, DWRITE_FONT_WEIGHT_SEMI_BOLD, DWRITE_TEXT_METRICS, DWRITE_TRIMMING, DWRITE_TRIMMING_GRANULARITY_CHARACTER, DWRITE_WORD_WRAPPING_NO_WRAP,
};
use windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_B8G8R8A8_UNORM;
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetDC, ReleaseDC, SelectObject, AC_SRC_ALPHA, AC_SRC_OVER, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, BLENDFUNCTION, DIB_RGB_COLORS, HBITMAP,
    HDC,
};
use windows::Win32::Graphics::Imaging::{CLSID_WICImagingFactory, GUID_WICPixelFormat32bppPBGRA, IWICBitmapSource, IWICImagingFactory, WICBitmapDitherTypeNone, WICBitmapPaletteTypeMedianCut, WICDecodeMetadataCacheOnDemand};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetMessageW, PostMessageW, PostQuitMessage, RegisterClassW, SetTimer, SetWindowPos, ShowWindow, TranslateMessage, UpdateLayeredWindow,
    HTTRANSPARENT, HWND_TOPMOST, MSG, SWP_NOACTIVATE, SWP_NOSIZE, SW_SHOWNOACTIVATE, ULW_ALPHA, WM_APP, WM_NCHITTEST, WM_TIMER, WNDCLASSW, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
    WS_EX_TOPMOST, WS_EX_TRANSPARENT, WS_POPUP,
};

const W: f32 = 300.0;
const H: f32 = 420.0;
const WM_REDRAW: u32 = WM_APP + 1;
const WM_STOP: u32 = WM_APP + 2;
const WM_MOVE_TO: u32 = WM_APP + 3;

#[derive(Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Person {
    #[allow(dead_code)]
    peer_id: String,
    user_id: String,
    name: String,
    speaking: bool,
    muted: bool,
    screen: bool,
}

#[derive(Deserialize, Clone, Default)]
pub struct State {
    visible: bool,
    corner: String,
    show: String,
    people: Vec<Person>,
}

struct Note {
    title: String,
    body: String,
    until: Instant,
}

#[derive(Default)]
struct Shared {
    state: State,
    notes: Vec<Note>,
    /// Avatar pictures (PNG, already round) by user id.
    avatars: HashMap<String, Arc<Vec<u8>>>,
    /// The window (as a number: HWND isn't Send), while it runs.
    hwnd: Option<isize>,
    /// Physical top-left and scale, for the next placement.
    place: (i32, i32, f32),
}

fn shared() -> &'static Mutex<Shared> {
    static S: OnceLock<Mutex<Shared>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(Shared::default()))
}

fn post(msg: u32) {
    let hwnd = shared().lock().unwrap().hwnd;
    if let Some(h) = hwnd {
        unsafe {
            let _ = PostMessageW(Some(HWND(h as *mut _)), msg, WPARAM(0), LPARAM(0));
        }
    }
}

/// Opens the overlay at `(x, y)` (physical pixels) with the screen's `scale`, or moves it there.
fn trace(m: &str) {
    if !cfg!(debug_assertions) {
        return;
    }
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(std::env::temp_dir().join("infimeety-overlay.log")) {
        let _ = writeln!(f, "{m}");
    }
}

pub fn open(x: i32, y: i32, scale: f32) {
    let mut s = shared().lock().unwrap();
    s.place = (x, y, scale);
    if s.hwnd.is_some() {
        drop(s);
        return post(WM_MOVE_TO);
    }
    s.hwnd = Some(0); // starting
    drop(s);
    std::thread::spawn(run);
}

pub fn close() {
    post(WM_STOP);
}

pub fn set_state(state: State) {
    shared().lock().unwrap().state = state;
    post(WM_REDRAW);
}

pub fn set_avatar(user_id: String, png: Vec<u8>) {
    if png.len() > 512 * 1024 {
        return;
    }
    shared().lock().unwrap().avatars.insert(user_id, Arc::new(png));
    post(WM_REDRAW);
}

pub fn note(title: String, body: String) {
    let mut s = shared().lock().unwrap();
    s.notes.retain(|n| n.until > Instant::now());
    if s.notes.len() >= 3 {
        s.notes.remove(0);
    }
    s.notes.push(Note { title: title.chars().take(80).collect(), body: body.chars().take(120).collect(), until: Instant::now() + Duration::from_secs(6) });
    drop(s);
    post(WM_REDRAW);
}

unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if msg == WM_NCHITTEST {
        return LRESULT(HTTRANSPARENT as isize);
    }
    DefWindowProcW(hwnd, msg, wparam, lparam)
}

fn run() {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let Ok(module) = GetModuleHandleW(None) else {
            trace("overlay: no module handle");
            return finish();
        };
        let class = w!("InfimeetyOverlay");
        let wc = WNDCLASSW { lpfnWndProc: Some(wndproc), hInstance: module.into(), lpszClassName: class, ..Default::default() };
        RegisterClassW(&wc); // already registered on a second open: fine
        let (x, y, scale) = shared().lock().unwrap().place;
        let (w, h) = ((W * scale).round() as i32, (H * scale).round() as i32);
        let Ok(hwnd) = CreateWindowExW(
            WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
            class,
            w!("Infimeety overlay"),
            WS_POPUP,
            x,
            y,
            w,
            h,
            None,
            None,
            Some(module.into()),
            None,
        ) else {
            trace(&format!("overlay: CreateWindowExW failed: {:?}", windows::core::Error::from_thread()));
            return finish();
        };
        shared().lock().unwrap().hwnd = Some(hwnd.0 as isize);
        let Some(mut painter) = Painter::new(scale) else {
            trace("overlay: Direct2D setup failed");
            let _ = DestroyWindow(hwnd);
            return finish();
        };
        let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        painter.paint(hwnd, x, y);
        // Notes expire on their own: a look every half second.
        SetTimer(Some(hwnd), 1, 500, None);
        let mut had_notes = false;
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            match msg.message {
                WM_REDRAW => {
                    let (x, y, _) = shared().lock().unwrap().place;
                    painter.paint(hwnd, x, y);
                }
                WM_MOVE_TO => {
                    let (x, y, _) = shared().lock().unwrap().place;
                    let _ = SetWindowPos(hwnd, Some(HWND_TOPMOST), x, y, 0, 0, SWP_NOSIZE | SWP_NOACTIVATE);
                    painter.paint(hwnd, x, y);
                }
                WM_TIMER => {
                    let now = Instant::now();
                    let mut s = shared().lock().unwrap();
                    let before = s.notes.len();
                    s.notes.retain(|n| n.until > now);
                    let changed = s.notes.len() != before || (had_notes && s.notes.is_empty());
                    had_notes = !s.notes.is_empty();
                    let (x, y, _) = s.place;
                    drop(s);
                    if changed {
                        painter.paint(hwnd, x, y);
                    }
                    // Games that grab "topmost" for themselves: stay above them.
                    let _ = SetWindowPos(hwnd, Some(HWND_TOPMOST), 0, 0, 0, 0, SWP_NOSIZE | SWP_NOACTIVATE | windows::Win32::UI::WindowsAndMessaging::SWP_NOMOVE);
                }
                WM_STOP => {
                    let _ = DestroyWindow(hwnd);
                    PostQuitMessage(0);
                }
                _ => {
                    let _ = TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
            }
        }
        finish();
    }
}

fn finish() {
    shared().lock().unwrap().hwnd = None;
}

struct Painter {
    scale: f32,
    d2d: ID2D1Factory,
    dwrite: IDWriteFactory,
    wic: Option<IWICImagingFactory>,
    name: IDWriteTextFormat,
    small: IDWriteTextFormat,
    bold: IDWriteTextFormat,
    dc: HDC,
    bitmap: HBITMAP,
    target: ID2D1RenderTarget,
    /// What it draws into (software, with transparency); copied to the window each paint.
    canvas: windows::Win32::Graphics::Imaging::IWICBitmap,
    /// Decoded avatars, by user id (the PNG they came from, to notice a change).
    pictures: HashMap<String, (Arc<Vec<u8>>, IWICBitmapSource)>,
    bits: *mut u8,
    size: (i32, i32),
}

impl Drop for Painter {
    fn drop(&mut self) {
        unsafe {
            let _ = DeleteObject(self.bitmap.into());
            let _ = DeleteDC(self.dc);
        }
    }
}

fn color(r: u8, g: u8, b: u8, a: f32) -> D2D1_COLOR_F {
    D2D1_COLOR_F { r: r as f32 / 255.0, g: g as f32 / 255.0, b: b as f32 / 255.0, a }
}

fn pt(x: f32, y: f32) -> windows_numerics::Vector2 {
    windows_numerics::Vector2 { X: x, Y: y }
}

fn rect(left: f32, top: f32, right: f32, bottom: f32) -> D2D_RECT_F {
    D2D_RECT_F { left, top, right, bottom }
}

impl Painter {
    unsafe fn new(scale: f32) -> Option<Self> {
        let d2d: ID2D1Factory = D2D1CreateFactory(D2D1_FACTORY_TYPE_SINGLE_THREADED, None).ok()?;
        let dwrite: IDWriteFactory = DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED).ok()?;
        let wic: Option<IWICImagingFactory> = CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER).ok();
        let format = |size: f32, weight| dwrite.CreateTextFormat(w!("Segoe UI"), None, weight, DWRITE_FONT_STYLE_NORMAL, DWRITE_FONT_STRETCH_NORMAL, size, w!("en-us")).ok();
        let name = format(13.0, DWRITE_FONT_WEIGHT_SEMI_BOLD)?;
        let small = format(12.0, DWRITE_FONT_WEIGHT_NORMAL)?;
        let bold = format(9.5, DWRITE_FONT_WEIGHT_BOLD)?;
        for f in [&name, &small, &bold] {
            let _ = f.SetWordWrapping(DWRITE_WORD_WRAPPING_NO_WRAP);
        }
        let screen = GetDC(None);
        let dc = CreateCompatibleDC(Some(screen));
        ReleaseDC(None, screen);
        let (w, h) = ((W * scale).round() as i32, (H * scale).round() as i32);
        let info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER { biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32, biWidth: w, biHeight: -h, biPlanes: 1, biBitCount: 32, biCompression: BI_RGB.0, ..Default::default() },
            ..Default::default()
        };
        let mut bits: *mut core::ffi::c_void = std::ptr::null_mut();
        let bitmap = CreateDIBSection(Some(dc), &info, DIB_RGB_COLORS, &mut bits, None, 0).ok()?;
        SelectObject(dc, bitmap.into());
        let props = D2D1_RENDER_TARGET_PROPERTIES {
            r#type: windows::Win32::Graphics::Direct2D::D2D1_RENDER_TARGET_TYPE_SOFTWARE,
            pixelFormat: D2D1_PIXEL_FORMAT { format: DXGI_FORMAT_B8G8R8A8_UNORM, alphaMode: D2D1_ALPHA_MODE_PREMULTIPLIED },
            dpiX: 96.0 * scale,
            dpiY: 96.0 * scale,
            usage: D2D1_RENDER_TARGET_USAGE_NONE,
            minLevel: D2D1_FEATURE_LEVEL_DEFAULT,
        };
        let canvas = wic.as_ref()?.CreateBitmap(w as u32, h as u32, &GUID_WICPixelFormat32bppPBGRA, windows::Win32::Graphics::Imaging::WICBitmapCacheOnLoad).ok()?;
        let target = d2d.CreateWicBitmapRenderTarget(&canvas, &props).ok()?;
        target.SetTextAntialiasMode(D2D1_TEXT_ANTIALIAS_MODE_GRAYSCALE);
        Some(Self { scale, d2d, dwrite, wic, name, small, bold, dc, bitmap, target, canvas, pictures: HashMap::new(), bits: bits as *mut u8, size: (w, h) })
    }

    unsafe fn layout(&self, text: &str, format: &IDWriteTextFormat, max: f32) -> Option<(IDWriteTextLayout, f32, f32)> {
        let wide: Vec<u16> = text.encode_utf16().collect();
        let layout = self.dwrite.CreateTextLayout(&wide, format, max, 40.0).ok()?;
        let sign = self.dwrite.CreateEllipsisTrimmingSign(format).ok();
        let trim = DWRITE_TRIMMING { granularity: DWRITE_TRIMMING_GRANULARITY_CHARACTER, delimiter: 0, delimiterCount: 0 };
        let _ = layout.SetTrimming(&trim, sign.as_ref());
        let mut m = DWRITE_TEXT_METRICS::default();
        layout.GetMetrics(&mut m).ok()?;
        Some((layout, m.widthIncludingTrailingWhitespace.min(max), m.height))
    }

    unsafe fn picture(&mut self, user_id: &str, png: &Arc<Vec<u8>>) -> Option<IWICBitmapSource> {
        if let Some((from, source)) = self.pictures.get(user_id) {
            if Arc::ptr_eq(from, png) {
                return Some(source.clone());
            }
        }
        let wic = self.wic.as_ref()?;
        let stream = wic.CreateStream().ok()?;
        stream.InitializeFromMemory(png).ok()?;
        let decoder = wic.CreateDecoderFromStream(&stream, std::ptr::null(), WICDecodeMetadataCacheOnDemand).ok()?;
        let frame = decoder.GetFrame(0).ok()?;
        let converter = wic.CreateFormatConverter().ok()?;
        converter.Initialize(&frame, &GUID_WICPixelFormat32bppPBGRA, WICBitmapDitherTypeNone, None, 0.0, WICBitmapPaletteTypeMedianCut).ok()?;
        let source: IWICBitmapSource = converter.cast().ok()?;
        self.pictures.insert(user_id.to_string(), (png.clone(), source.clone()));
        Some(source)
    }

    unsafe fn paint(&mut self, hwnd: HWND, x: i32, y: i32) {
        let (state, notes, avatars) = {
            let s = shared().lock().unwrap();
            let notes: Vec<(String, String)> = s.notes.iter().filter(|n| n.until > Instant::now()).map(|n| (n.title.clone(), n.body.clone())).collect();
            (s.state.clone(), notes, s.avatars.clone())
        };
        let right = state.corner.ends_with("right");
        let bottom = state.corner.starts_with("bottom");
        let everyone = state.show == "everyone";
        let people: Vec<&Person> = if state.visible { state.people.iter().filter(|p| everyone || p.speaking).collect() } else { vec![] };

        let target = self.target.clone();
        let t: &ID2D1RenderTarget = &target;
        t.BeginDraw();
        t.Clear(Some(&color(0, 0, 0, 0.0)));
        let Ok(pill) = t.CreateSolidColorBrush(&color(14, 14, 20, 0.74), None) else { let _ = t.EndDraw(None, None); return };
        let white = t.CreateSolidColorBrush(&color(255, 255, 255, 1.0), None).ok();
        let soft = t.CreateSolidColorBrush(&color(255, 255, 255, 0.72), None).ok();
        let edge = t.CreateSolidColorBrush(&color(255, 255, 255, 0.14), None).ok();
        let green = t.CreateSolidColorBrush(&color(35, 165, 90, 1.0), None).ok();
        let red = t.CreateSolidColorBrush(&color(237, 66, 69, 1.0), None).ok();

        // Rows, from the chosen corner: notes first (nearest the corner), then people.
        let gap = 6.0;
        let pad = 8.0;
        let mut cursor = if bottom { H - pad } else { pad };
        let place = |cursor: &mut f32, height: f32| -> f32 {
            let top = if bottom { *cursor - height } else { *cursor };
            *cursor = if bottom { top - gap } else { top + height + gap };
            top
        };

        for (title, body) in &notes {
            let max = 244.0;
            let (Some((tl, tw, _)), Some((bl, bw, _))) = (self.layout(title, &self.name, max), self.layout(body, &self.small, max)) else { continue };
            let width = tw.max(bw) + 24.0;
            let top = place(&mut cursor, 46.0);
            let left = if right { W - pad - width } else { pad };
            let r = D2D1_ROUNDED_RECT { rect: rect(left, top, left + width, top + 46.0), radiusX: 14.0, radiusY: 14.0 };
            t.FillRoundedRectangle(&r, &pill);
            if let Some(e) = &edge {
                t.DrawRoundedRectangle(&r, e, 0.5, None);
            }
            if let (Some(w), Some(s)) = (&white, &soft) {
                t.DrawTextLayout(pt(left + 12.0, top + 5.0), &tl, w, D2D1_DRAW_TEXT_OPTIONS_NONE);
                t.DrawTextLayout(pt(left + 12.0, top + 23.0), &bl, s, D2D1_DRAW_TEXT_OPTIONS_NONE);
            }
        }

        for p in people {
            let dim = everyone && !p.speaking;
            let extra = if p.screen { 40.0 } else { 0.0 } + if p.muted { 18.0 } else { 0.0 };
            let Some((nl, nw, nh)) = self.layout(&p.name, &self.name, 284.0 - 52.0 - extra) else { continue };
            let width = 4.0 + 28.0 + 8.0 + nw + extra + 14.0;
            let top = place(&mut cursor, 36.0);
            let left = if right { W - pad - width } else { pad };
            let r = D2D1_ROUNDED_RECT { rect: rect(left, top, left + width, top + 36.0), radiusX: 18.0, radiusY: 18.0 };
            // A quiet person (everyone shown) is dimmed.
            let alpha = if dim { 0.5 } else { 1.0 };
            pill.SetOpacity(alpha);
            t.FillRoundedRectangle(&r, &pill);
            if let Some(e) = &edge {
                e.SetOpacity(alpha);
                t.DrawRoundedRectangle(&r, e, 0.5, None);
            }
            // The avatar (round), or a disc with the first letter.
            let cx = left + 4.0 + 14.0;
            let cy = top + 18.0;
            let avatar = avatars.get(&p.user_id).cloned().and_then(|png| self.picture(&p.user_id, &png));
            let drawn = avatar.and_then(|src| t.CreateBitmapFromWicBitmap(&src, None).ok()).map(|bmp| {
                t.DrawBitmap(&bmp, Some(&rect(cx - 14.0, cy - 14.0, cx + 14.0, cy + 14.0)), alpha, D2D1_BITMAP_INTERPOLATION_MODE_LINEAR, None);
            });
            if drawn.is_none() {
                if let Ok(disc) = t.CreateSolidColorBrush(&tint(&p.user_id, alpha), None) {
                    t.FillEllipse(&D2D1_ELLIPSE { point: pt(cx, cy), radiusX: 14.0, radiusY: 14.0 }, &disc);
                }
                let letter: String = p.name.chars().next().map(|c| c.to_uppercase().collect()).unwrap_or_default();
                if let (Some((ll, lw, lh)), Some(w)) = (self.layout(&letter, &self.name, 28.0), &white) {
                    w.SetOpacity(alpha);
                    t.DrawTextLayout(pt(cx - lw / 2.0, cy - lh / 2.0), &ll, w, D2D1_DRAW_TEXT_OPTIONS_NONE);
                }
            }
            if p.speaking {
                if let Some(g) = &green {
                    t.DrawEllipse(&D2D1_ELLIPSE { point: pt(cx, cy), radiusX: 15.0, radiusY: 15.0 }, g, 2.0, None);
                }
            }
            let mut tx = left + 4.0 + 28.0 + 8.0;
            if let Some(w) = &white {
                w.SetOpacity(alpha);
                t.DrawTextLayout(pt(tx, cy - nh / 2.0), &nl, w, D2D1_DRAW_TEXT_OPTIONS_NONE);
            }
            tx += nw + 6.0;
            if p.screen {
                if let (Some(rb), Some(w), Some((ll, lw, lh))) = (&red, &white, self.layout("LIVE", &self.bold, 40.0)) {
                    rb.SetOpacity(alpha);
                    let lr = D2D1_ROUNDED_RECT { rect: rect(tx, cy - 8.0, tx + lw + 10.0, cy + 8.0), radiusX: 4.0, radiusY: 4.0 };
                    t.FillRoundedRectangle(&lr, rb);
                    t.DrawTextLayout(pt(tx + 5.0, cy - lh / 2.0), &ll, w, D2D1_DRAW_TEXT_OPTIONS_NONE);
                    tx += lw + 16.0;
                }
            }
            if p.muted {
                if let Some(s) = &soft {
                    // A small microphone with a slash.
                    s.SetOpacity(0.6 * alpha);
                    let m = D2D1_ROUNDED_RECT { rect: rect(tx + 3.0, cy - 6.0, tx + 8.0, cy + 2.0), radiusX: 2.5, radiusY: 2.5 };
                    t.DrawRoundedRectangle(&m, s, 1.3, None);
                    t.DrawLine(pt(tx + 5.5, cy + 3.5), pt(tx + 5.5, cy + 6.0), s, 1.3, None);
                    t.DrawLine(pt(tx, cy - 7.0), pt(tx + 11.0, cy + 6.0), s, 1.3, None);
                }
            }
            pill.SetOpacity(1.0);
        }
        let _ = t.EndDraw(None, None);
        // Into the window's bitmap, row for row.
        {
            let (w, h) = self.size;
            let px = std::slice::from_raw_parts_mut(self.bits, (w * h * 4) as usize);
            let _ = self.canvas.CopyPixels(std::ptr::null(), (w * 4) as u32, px);
        }

        // Hand the picture (with its transparency) to Windows.
        let size = SIZE { cx: (W * self.scale).round() as i32, cy: (H * self.scale).round() as i32 };
        let from = POINT { x: 0, y: 0 };
        let to = POINT { x, y };
        let blend = BLENDFUNCTION { BlendOp: AC_SRC_OVER as u8, BlendFlags: 0, SourceConstantAlpha: 255, AlphaFormat: AC_SRC_ALPHA as u8 };
        let screen = GetDC(None);
        let _ = UpdateLayeredWindow(hwnd, Some(screen), Some(&to), Some(&size), Some(self.dc), Some(&from), COLORREF(0), Some(&blend), ULW_ALPHA);
        ReleaseDC(None, screen);
        let _ = PCWSTR::null();
        let _ = &self.d2d;
    }
}

/// The same color per person as the app's letter avatars (roughly).
fn tint(id: &str, alpha: f32) -> D2D1_COLOR_F {
    const COLORS: [(u8, u8, u8); 6] = [(242, 126, 76), (88, 101, 242), (35, 165, 90), (235, 69, 158), (250, 166, 26), (0, 168, 252)];
    let n = id.bytes().fold(0u32, |h, b| h.wrapping_mul(31).wrapping_add(b as u32)) as usize;
    let (r, g, b) = COLORS[n % COLORS.len()];
    color(r, g, b, alpha)
}
