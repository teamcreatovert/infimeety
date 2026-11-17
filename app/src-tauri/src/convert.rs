//! Watch parties: a movie whose sound web engines can't play (Dolby, DTS) gets a copy with AAC
//! sound, made by the small ffmpeg bundled next to the app (scripts/build-ffmpeg.sh). The picture
//! is copied as it is, so it's quick: about a minute or two for a whole movie.

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::ipc::Channel;

/// The bundled ffmpeg (Tauri puts it next to the app's own executable), if it's there.
pub fn ffmpeg() -> Option<PathBuf> {
    let name = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
    let path = std::env::current_exe().ok()?.parent()?.join(name);
    path.exists().then_some(path)
}

/// Writes `output` (MP4): the first picture track copied, audio track `audio` (or every one, so
/// dual-audio movies keep both) as stereo AAC. `hevc`: label HEVC video `hvc1`, which Macs need.
/// `on_progress` hears 0 to 1 as it goes.
pub fn to_aac(input: &Path, output: &Path, audio: Option<u32>, hevc: bool, on_progress: &Channel<f64>) -> Result<(), String> {
    let ffmpeg = ffmpeg().ok_or("The converter isn't installed with this copy of Infimeety.")?;
    let mut cmd = Command::new(ffmpeg);
    cmd.args(["-hide_banner", "-nostdin", "-y", "-i"])
        .arg(input)
        .args(["-map", "0:v:0?", "-map", &audio.map_or("0:a?".to_string(), |a| format!("0:a:{a}")), "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ac", "2"])
        .args(if hevc { &["-tag:v", "hvc1"][..] } else { &[][..] })
        .args(["-sn", "-dn", "-movflags", "+faststart", "-progress", "pipe:1", "-nostats"])
        .arg(output)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: no console flashing up
    }
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;

    // The length comes on stderr ("Duration: 01:52:10.04"), progress on stdout ("out_time_us=").
    let stderr = child.stderr.take().unwrap();
    let (tx, rx) = std::sync::mpsc::channel::<(f64, String)>();
    let errors = std::thread::spawn(move || {
        let mut tail = Vec::new();
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if let Some(d) = line.trim().strip_prefix("Duration: ").and_then(|r| r.split(',').next()).and_then(clock) {
                let _ = tx.send((d, String::new()));
            }
            tail.push(line);
            if tail.len() > 8 {
                tail.remove(0);
            }
        }
        tail.join("\n")
    });
    let mut duration = 0.0;
    for line in BufReader::new(child.stdout.take().unwrap()).lines().map_while(Result::ok) {
        if let Ok((d, _)) = rx.try_recv() {
            duration = d;
        }
        if let Some(us) = line.strip_prefix("out_time_us=").and_then(|v| v.parse::<f64>().ok()) {
            if duration > 0.0 {
                let _ = on_progress.send((us / 1e6 / duration).clamp(0.0, 0.99));
            }
        }
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    let tail = errors.join().unwrap_or_default();
    if !status.success() {
        let _ = std::fs::remove_file(output);
        return Err(format!("The converter stopped: {}", tail.lines().last().unwrap_or("unknown error")));
    }
    let _ = on_progress.send(1.0);
    Ok(())
}

/// "01:52:10.04" in seconds.
fn clock(s: &str) -> Option<f64> {
    let mut parts = s.trim().split(':');
    let (h, m, sec) = (parts.next()?.parse::<f64>().ok()?, parts.next()?.parse::<f64>().ok()?, parts.next()?.parse::<f64>().ok()?);
    Some(h * 3600.0 + m * 60.0 + sec)
}
