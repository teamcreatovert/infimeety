//! Native system-sound capture for screen sharing.
//!
//! WebView2's screen capture comes without system audio, so the desktop app records it
//! itself: every app's sound *except Infimeety's own* (WASAPI process loopback in
//! "exclude" mode, Windows 10 2004+). Excluding ourselves means friends' voices coming
//! out of your speakers are never sent back to them as an echo.
//!
//! All of Infimeety's sound is played by WebView2's audio service. Windows' loopback does
//! not count the WebView2 browser as part of `infimeety.exe`'s process tree (verified by
//! capture tests), so we exclude the WebView2 browser process tree instead.
//!
//! Samples stream to the webview as raw 48 kHz stereo f32 chunks over a Tauri channel.

use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc::Sender,
    Arc, Mutex,
};
use std::time::Duration;
use tauri::{
    ipc::{Channel, InvokeResponseBody},
    State, Webview,
};

/// Stop flags of the running captures, by kind: a screen share's (`false`: everything but us)
/// and a music share's (`true`: one app).
#[derive(Default)]
pub struct SystemAudio(Mutex<std::collections::HashMap<bool, Arc<AtomicBool>>>);

impl SystemAudio {
    fn stop(&self, app: bool) {
        if let Some(flag) = self.0.lock().unwrap().remove(&app) {
            flag.store(true, Ordering::Relaxed);
        }
    }
}

#[tauri::command]
pub async fn system_audio_start(
    webview: Webview,
    state: State<'_, SystemAudio>,
    on_data: Channel<InvokeResponseBody>,
    app_pid: Option<u32>,
) -> Result<(), String> {
    // With an app: only its sound (and its helpers', like a browser's audio process).
    let include = app_pid.is_some();
    state.stop(include);
    let pid = match app_pid {
        Some(pid) => pid,
        None => webview_browser_pid(&webview).ok_or("Couldn't find Infimeety's audio process")?,
    };
    let stop = Arc::new(AtomicBool::new(false));
    let (ready_tx, ready_rx) = std::sync::mpsc::channel();
    let flag = stop.clone();
    std::thread::Builder::new()
        .name("system-audio".into())
        .spawn(move || capture(pid, include, on_data, flag, ready_tx))
        .map_err(|e| e.to_string())?;
    ready_rx
        .recv_timeout(Duration::from_secs(5))
        .map_err(|_| "Timed out starting system sound capture".to_string())??;
    state.0.lock().unwrap().insert(include, stop);
    Ok(())
}

#[tauri::command]
pub fn system_audio_stop(state: State<'_, SystemAudio>, app: Option<bool>) {
    state.stop(app.unwrap_or(false));
}

/// Process id of the WebView2 browser process that hosts (and plays audio for) this webview.
#[cfg(windows)]
fn webview_browser_pid(webview: &Webview) -> Option<u32> {
    let (tx, rx) = std::sync::mpsc::channel();
    webview
        .with_webview(move |platform| {
            let mut pid = 0u32;
            // SAFETY: plain COM getters on the live controller, called on the UI thread by Tauri.
            let ok = unsafe { platform.controller().CoreWebView2().and_then(|core| core.BrowserProcessId(&mut pid)).is_ok() };
            let _ = tx.send(ok.then_some(pid));
        })
        .ok()?;
    rx.recv_timeout(Duration::from_secs(2)).ok().flatten()
}

#[cfg(not(windows))]
fn webview_browser_pid(_webview: &Webview) -> Option<u32> {
    Some(std::process::id())
}

#[cfg(windows)]
fn capture(pid: u32, include: bool, out: Channel<InvokeResponseBody>, stop: Arc<AtomicBool>, ready: Sender<Result<(), String>>) {
    use std::collections::VecDeque;
    use wasapi::{initialize_mta, AudioClient, Direction, SampleType, StreamMode, WaveFormat};

    let started = (|| -> Result<_, Box<dyn std::error::Error>> {
        initialize_mta().ok()?;
        let format = WaveFormat::new(32, 32, &SampleType::Float, 48_000, 2, None);
        let block = format.get_blockalign() as usize;
        // `false` = PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE: everything but our webview's
        // audio; `true` = only that app's process tree.
        let mut client = AudioClient::new_application_loopback_client(pid, include)?;
        client.initialize_client(&format, &Direction::Capture, &StreamMode::EventsShared { autoconvert: true, buffer_duration_hns: 0 })?;
        let event = client.set_get_eventhandle()?;
        let capture = client.get_audiocaptureclient()?;
        client.start_stream()?;
        Ok((client, capture, event, block))
    })();

    let (client, capture, event, block) = match started {
        Ok(parts) => {
            let _ = ready.send(Ok(()));
            parts
        }
        Err(err) => {
            let _ = ready.send(Err(format!("Couldn't capture system sound: {err}")));
            return;
        }
    };

    let chunk_bytes = 480 * block; // 10 ms per message
    let mut queue: VecDeque<u8> = VecDeque::with_capacity(chunk_bytes * 16);
    while !stop.load(Ordering::Relaxed) {
        // No events arrive while nothing is playing; just keep waiting.
        if event.wait_for_event(100).is_err() {
            continue;
        }
        while let Ok(Some(frames)) = capture.get_next_packet_size() {
            if frames == 0 {
                break;
            }
            let before = queue.len();
            match capture.read_from_device_to_deque(&mut queue) {
                // Silent packets may hold garbage; the spec says to treat them as zeros.
                Ok(info) if info.flags.silent => queue.range_mut(before..).for_each(|b| *b = 0),
                Ok(_) => {}
                Err(_) => break,
            }
        }
        while queue.len() >= chunk_bytes {
            let chunk: Vec<u8> = queue.drain(..chunk_bytes).collect();
            if out.send(InvokeResponseBody::Raw(chunk)).is_err() {
                stop.store(true, Ordering::Relaxed); // webview went away
                break;
            }
        }
    }
    let _ = client.stop_stream();
}

#[cfg(not(windows))]
fn capture(_pid: u32, _include: bool, _out: Channel<InvokeResponseBody>, _stop: Arc<AtomicBool>, ready: Sender<Result<(), String>>) {
    let _ = ready.send(Err("System sound capture is only available on Windows".into()));
}
