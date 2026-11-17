//! Reads what's inside an MKV movie for watch parties: its tracks (which sound format, so a
//! friend can be warned before pressing play) and its built-in text subtitles, turned into
//! WebVTT the player shows. Only the parts needed are read: video and sound blocks are skipped
//! over by their sizes, so a 4 GB movie takes a moment, not a full read.

use std::fs::File;
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::path::Path;

const SEGMENT: u32 = 0x1853_8067;
const INFO: u32 = 0x1549_A966;
const TIMECODE_SCALE: u32 = 0x2A_D7B1;
const TRACKS: u32 = 0x1654_AE6B;
const TRACK_ENTRY: u32 = 0xAE;
const TRACK_NUMBER: u32 = 0xD7;
const TRACK_TYPE: u32 = 0x83;
const CODEC_ID: u32 = 0x86;
const LANGUAGE: u32 = 0x22_B59C;
const LANGUAGE_IETF: u32 = 0x22_B59D;
const NAME: u32 = 0x536E;
const FLAG_DEFAULT: u32 = 0x88;
const FLAG_FORCED: u32 = 0x55AA;
const CLUSTER: u32 = 0x1F43_B675;
const CLUSTER_TIMECODE: u32 = 0xE7;
const SIMPLE_BLOCK: u32 = 0xA3;
const BLOCK_GROUP: u32 = 0xA0;
const BLOCK: u32 = 0xA1;
const BLOCK_DURATION: u32 = 0x9B;

#[derive(serde::Serialize, Clone, Default)]
pub struct Track {
    number: u64,
    /// "video", "audio" or "subtitle".
    kind: String,
    codec: String,
    language: String,
    name: String,
    default: bool,
    forced: bool,
}

#[derive(serde::Serialize)]
pub struct Subtitle {
    track: u64,
    language: String,
    name: String,
    default: bool,
    forced: bool,
    vtt: String,
}

#[derive(serde::Serialize)]
pub struct Probe {
    tracks: Vec<Track>,
    subtitles: Vec<Subtitle>,
}

struct Cue {
    start: f64,
    end: Option<f64>,
    text: String,
}

/// Tracks and text subtitles of an MKV (or WebM) file. Not one: an error.
pub fn probe(path: &Path) -> Result<Probe, String> {
    let file = File::open(path).map_err(|e| e.to_string())?;
    let len = file.metadata().map_err(|e| e.to_string())?.len();
    let mut r = BufReader::with_capacity(64 * 1024, file);

    // EBML header, then the Segment.
    let (id, size) = header(&mut r)?;
    if id != 0x1A45_DFA3 {
        return Err("not an MKV file".into());
    }
    skip(&mut r, size)?;
    let (id, size) = header(&mut r)?;
    if id != SEGMENT {
        return Err("no segment".into());
    }
    let start = pos(&mut r)?;
    let end = size.map_or(len, |s| (start + s).min(len));

    let mut scale = 1_000_000u64; // ns per timecode unit
    let mut tracks: Vec<Track> = Vec::new();
    let mut cues: std::collections::HashMap<u64, Vec<Cue>> = Default::default();

    while pos(&mut r)? < end {
        let Ok((id, size)) = header(&mut r) else { break };
        match id {
            INFO => {
                let stop = pos(&mut r)? + size.unwrap_or(0);
                while pos(&mut r)? < stop {
                    let (cid, csize) = header(&mut r)?;
                    if cid == TIMECODE_SCALE {
                        scale = uint(&mut r, csize)?.max(1);
                    } else {
                        skip(&mut r, csize)?;
                    }
                }
            }
            TRACKS => tracks = read_tracks(&mut r, size.unwrap_or(0))?,
            CLUSTER => {
                // Subtitle tracks known (Tracks comes first in real files): only their blocks are read.
                let wanted: Vec<u64> = tracks.iter().filter(|t| t.kind == "subtitle" && is_text(&t.codec)).map(|t| t.number).collect();
                let stop = size.map_or(end, |s| pos(&mut r).unwrap_or(end) + s);
                read_cluster(&mut r, stop, scale, &wanted, &mut cues)?;
            }
            _ => skip(&mut r, size)?,
        }
    }

    let subtitles = tracks
        .iter()
        .filter(|t| t.kind == "subtitle" && is_text(&t.codec))
        .filter_map(|t| {
            let list = cues.remove(&t.number)?;
            Some(Subtitle { track: t.number, language: t.language.clone(), name: t.name.clone(), default: t.default, forced: t.forced, vtt: to_vtt(list) })
        })
        .collect();
    Ok(Probe { tracks, subtitles })
}

fn is_text(codec: &str) -> bool {
    matches!(codec, "S_TEXT/UTF8" | "S_TEXT/ASCII" | "S_TEXT/ASS" | "S_TEXT/SSA" | "S_ASS" | "S_SSA" | "S_TEXT/WEBVTT")
}

fn read_tracks(r: &mut BufReader<File>, size: u64) -> Result<Vec<Track>, String> {
    let stop = pos(r)? + size;
    let mut out = Vec::new();
    while pos(r)? < stop {
        let (id, esize) = header(r)?;
        if id != TRACK_ENTRY {
            skip(r, esize)?;
            continue;
        }
        let end = pos(r)? + esize.unwrap_or(0);
        let mut t = Track { language: "eng".into(), default: true, ..Default::default() };
        let mut ietf = String::new();
        while pos(r)? < end {
            let (cid, csize) = header(r)?;
            match cid {
                TRACK_NUMBER => t.number = uint(r, csize)?,
                TRACK_TYPE => {
                    t.kind = match uint(r, csize)? {
                        1 => "video",
                        2 => "audio",
                        0x11 => "subtitle",
                        _ => "other",
                    }
                    .into()
                }
                CODEC_ID => t.codec = string(r, csize)?,
                LANGUAGE => t.language = string(r, csize)?,
                LANGUAGE_IETF => ietf = string(r, csize)?,
                NAME => t.name = string(r, csize)?,
                FLAG_DEFAULT => t.default = uint(r, csize)? != 0,
                FLAG_FORCED => t.forced = uint(r, csize)? != 0,
                _ => skip(r, csize)?,
            }
        }
        if !ietf.is_empty() {
            t.language = ietf;
        }
        out.push(t);
    }
    Ok(out)
}

fn read_cluster(r: &mut BufReader<File>, stop: u64, scale: u64, wanted: &[u64], cues: &mut std::collections::HashMap<u64, Vec<Cue>>) -> Result<(), String> {
    let mut base = 0u64;
    while pos(r)? < stop {
        let here = pos(r)?;
        let Ok((id, size)) = header(r) else { return Ok(()) };
        match id {
            CLUSTER_TIMECODE => base = uint(r, size)?,
            SIMPLE_BLOCK => block(r, size.unwrap_or(0), base, scale, None, wanted, cues)?,
            BLOCK_GROUP => {
                let end = pos(r)? + size.unwrap_or(0);
                let mut duration = None;
                let mut found: Option<(u64, u64)> = None; // block start, size
                while pos(r)? < end {
                    let (cid, csize) = header(r)?;
                    match cid {
                        BLOCK => {
                            found = Some((pos(r)?, csize.unwrap_or(0)));
                            skip(r, csize)?;
                        }
                        BLOCK_DURATION => duration = Some(uint(r, csize)?),
                        _ => skip(r, csize)?,
                    }
                }
                if let Some((at, bsize)) = found {
                    let back = pos(r)?;
                    r.seek(SeekFrom::Start(at)).map_err(|e| e.to_string())?;
                    block(r, bsize, base, scale, duration, wanted, cues)?;
                    r.seek(SeekFrom::Start(back)).map_err(|e| e.to_string())?;
                }
            }
            // The next Cluster in a file whose clusters don't say their size.
            CLUSTER => {
                r.seek(SeekFrom::Start(here)).map_err(|e| e.to_string())?;
                return Ok(());
            }
            _ => skip(r, size)?,
        }
    }
    Ok(())
}

/// One block: kept if it belongs to a subtitle track, otherwise skipped without reading it.
fn block(r: &mut BufReader<File>, size: u64, base: u64, scale: u64, duration: Option<u64>, wanted: &[u64], cues: &mut std::collections::HashMap<u64, Vec<Cue>>) -> Result<(), String> {
    let start = pos(r)?;
    let (track, tlen) = vint(r, false)?;
    if !wanted.contains(&track) || size < tlen as u64 + 3 {
        r.seek(SeekFrom::Start(start + size)).map_err(|e| e.to_string())?;
        return Ok(());
    }
    let mut head = [0u8; 3];
    r.read_exact(&mut head).map_err(|e| e.to_string())?;
    let rel = i16::from_be_bytes([head[0], head[1]]) as i64;
    let mut data = vec![0u8; (size - tlen as u64 - 3) as usize];
    r.read_exact(&mut data).map_err(|e| e.to_string())?;
    let secs = |units: i64| units as f64 * scale as f64 / 1e9;
    let at = secs(base as i64 + rel);
    let text = String::from_utf8_lossy(&data).into_owned();
    cues.entry(track).or_default().push(Cue { start: at, end: duration.map(|d| at + secs(d as i64)), text });
    Ok(())
}

fn to_vtt(mut list: Vec<Cue>) -> String {
    list.sort_by(|a, b| a.start.total_cmp(&b.start));
    let mut out = String::from("WEBVTT\n\n");
    for i in 0..list.len() {
        let c = &list[i];
        // No duration: until the next line, at most 5 s.
        let end = c.end.unwrap_or_else(|| list.get(i + 1).map_or(c.start + 3.0, |n| n.start.min(c.start + 5.0)));
        let text = clean(&c.text);
        if text.is_empty() {
            continue;
        }
        out.push_str(&format!("{} --> {}\n{}\n\n", stamp(c.start), stamp(end.max(c.start + 0.2)), text));
    }
    out
}

/// ASS lines carry 8 fields before the text; both formats lose their styling tags.
fn clean(raw: &str) -> String {
    let text = if raw.matches(',').count() >= 8 && raw.split(',').next().is_some_and(|f| f.trim().parse::<i64>().is_ok()) {
        raw.splitn(9, ',').nth(8).unwrap_or("").to_string()
    } else {
        raw.to_string()
    };
    let mut out = String::new();
    let mut depth = 0;
    for ch in text.replace("\\N", "\n").replace("\\n", "\n").replace("\\h", " ").chars() {
        match ch {
            '{' => depth += 1,
            '}' if depth > 0 => depth -= 1,
            _ if depth == 0 => out.push(ch),
            _ => {}
        }
    }
    // A cue that ends early would close the VTT cue, so no blank lines inside one.
    out.lines().map(str::trim).filter(|l| !l.is_empty()).collect::<Vec<_>>().join("\n").replace("-->", "->")
}

fn stamp(secs: f64) -> String {
    let ms = (secs.max(0.0) * 1000.0).round() as u64;
    format!("{:02}:{:02}:{:02}.{:03}", ms / 3_600_000, (ms / 60_000) % 60, (ms / 1000) % 60, ms % 1000)
}

// ─── EBML ────────────────────────────────────────────────────────────────────

fn pos(r: &mut BufReader<File>) -> Result<u64, String> {
    r.stream_position().map_err(|e| e.to_string())
}

/// An element's id and size (None: unknown size).
fn header(r: &mut BufReader<File>) -> Result<(u32, Option<u64>), String> {
    let (id, _) = vint(r, true)?;
    let (size, len) = vint(r, false)?;
    let unknown = size == (1u64 << (7 * len)) - 1;
    Ok((id as u32, if unknown { None } else { Some(size) }))
}

/// A variable-length number. Ids keep their length marker; sizes and track numbers don't.
fn vint(r: &mut BufReader<File>, keep_marker: bool) -> Result<(u64, usize), String> {
    let mut b = [0u8; 1];
    r.read_exact(&mut b).map_err(|e| e.to_string())?;
    let first = b[0];
    let len = first.leading_zeros() as usize + 1;
    if len > 8 {
        return Err("bad number".into());
    }
    let mut v = if keep_marker { first as u64 } else { ((first as u16) & (0xFFu16 >> len)) as u64 };
    for _ in 1..len {
        r.read_exact(&mut b).map_err(|e| e.to_string())?;
        v = (v << 8) | b[0] as u64;
    }
    Ok((v, len))
}

fn uint(r: &mut BufReader<File>, size: Option<u64>) -> Result<u64, String> {
    let size = size.unwrap_or(0).min(8) as usize;
    let mut buf = [0u8; 8];
    r.read_exact(&mut buf[..size]).map_err(|e| e.to_string())?;
    Ok(buf[..size].iter().fold(0u64, |v, b| (v << 8) | *b as u64))
}

fn string(r: &mut BufReader<File>, size: Option<u64>) -> Result<String, String> {
    let size = size.unwrap_or(0).min(4096) as usize;
    let mut buf = vec![0u8; size];
    r.read_exact(&mut buf).map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&buf).trim_end_matches('\0').to_string())
}

fn skip(r: &mut BufReader<File>, size: Option<u64>) -> Result<(), String> {
    match size {
        Some(s) => r.seek_relative(s as i64).map_err(|e| e.to_string()),
        None => Ok(()), // unknown size: its children follow, read on
    }
}

#[cfg(test)]
mod tests {
    /// MKV_TEST_DIR: a folder with subs.mkv, ac3.mkv and live.mkv (made with ffmpeg). Skipped without it.
    #[test]
    fn reads_tracks_and_subtitles() {
        let Ok(dir) = std::env::var("MKV_TEST_DIR") else { return };
        for name in ["subs.mkv", "ac3.mkv", "live.mkv"] {
            let p = super::probe(&std::path::Path::new(&dir).join(name)).expect(name);
            println!("== {name}");
            for t in &p.tracks {
                println!("track {} {} {} {} default={}", t.number, t.kind, t.codec, t.language, t.default);
            }
            for s in &p.subtitles {
                println!("-- subtitle {} {} {}\n{}", s.track, s.language, s.name, s.vtt);
            }
        }
    }
}
