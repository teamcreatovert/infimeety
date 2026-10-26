//! A shared folder streams as one tar archive that is never written to disk: its layout is
//! worked out once when the folder is shared, and any byte range of it is built on request
//! from the files themselves (several connections fetch different parts at once). The
//! receiver unpacks it back into a folder. GNU long names keep deep paths intact.

use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{self, Read, Seek, SeekFrom},
    path::Path,
};

const BLOCK: u64 = 512;

/// One file in the archive: where its header starts and where its data starts.
#[derive(Clone, Serialize, Deserialize)]
pub struct TarEntry {
    pub rel: String,
    pub size: u64,
    pub start: u64,
    pub data: u64,
}

fn padded(n: u64) -> u64 {
    n.div_ceil(BLOCK) * BLOCK
}

fn header_len(rel: &str) -> u64 {
    if rel.len() <= 100 {
        BLOCK
    } else {
        2 * BLOCK + padded(rel.len() as u64 + 1)
    }
}

/// Every file under `root` (symlinks are skipped), laid out as an archive, and its total size.
pub fn layout(root: &Path) -> io::Result<(Vec<TarEntry>, u64)> {
    let mut files = Vec::new();
    walk(root, root, &mut files)?;
    files.sort_by(|a, b| a.0.cmp(&b.0));
    let mut pos = 0;
    let mut entries = Vec::with_capacity(files.len());
    for (rel, size) in files {
        let head = header_len(&rel);
        entries.push(TarEntry { start: pos, data: pos + head, rel, size });
        pos += head + padded(size);
    }
    // An archive ends with two empty blocks.
    Ok((entries, pos + 2 * BLOCK))
}

fn walk(root: &Path, dir: &Path, out: &mut Vec<(String, u64)>) -> io::Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        let path = entry.path();
        if kind.is_dir() {
            walk(root, &path, out)?;
        } else if kind.is_file() {
            let rel = path.strip_prefix(root).unwrap_or(&path);
            let rel = rel.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/");
            out.push((rel, entry.metadata()?.len()));
        }
    }
    Ok(())
}

fn set_name(header: &mut tar::Header, name: &[u8]) {
    header.as_old_mut().name[..name.len()].copy_from_slice(name);
}

/// The header block(s) in front of a file's data.
fn header(rel: &str, size: u64) -> Vec<u8> {
    let mut out = Vec::with_capacity(header_len(rel) as usize);
    let name = rel.as_bytes();
    if name.len() > 100 {
        let mut long = tar::Header::new_gnu();
        set_name(&mut long, b"././@LongLink");
        long.set_entry_type(tar::EntryType::GNULongName);
        long.set_size(name.len() as u64 + 1);
        long.set_mode(0o644);
        long.set_cksum();
        out.extend_from_slice(long.as_bytes());
        out.extend_from_slice(name);
        out.resize(out.len() + (padded(name.len() as u64 + 1) - name.len() as u64) as usize, 0);
    }
    let mut head = tar::Header::new_gnu();
    set_name(&mut head, &name[..name.len().min(100)]);
    head.set_entry_type(tar::EntryType::Regular);
    head.set_size(size);
    head.set_mode(0o644);
    head.set_mtime(0);
    head.set_cksum();
    out.extend_from_slice(head.as_bytes());
    out
}

/// Bytes `offset..offset+len` of the folder's archive.
pub fn read(root: &Path, entries: &[TarEntry], total: u64, offset: u64, len: u64) -> Result<Vec<u8>, String> {
    let end = offset.saturating_add(len).min(total);
    let mut out = Vec::with_capacity(end.saturating_sub(offset) as usize);
    let mut pos = offset;
    let mut i = entries.partition_point(|e| e.data + padded(e.size) <= pos);
    while pos < end {
        let Some(e) = entries.get(i) else {
            out.resize(out.len() + (end - pos) as usize, 0); // the closing empty blocks
            break;
        };
        if pos < e.data {
            let head = header(&e.rel, e.size);
            let upto = e.data.min(end);
            out.extend_from_slice(&head[(pos - e.start) as usize..(upto - e.start) as usize]);
            pos = upto;
        } else if pos < e.data + e.size {
            let upto = (e.data + e.size).min(end);
            let mut file = fs::File::open(root.join(&e.rel)).map_err(|_| "gone")?;
            file.seek(SeekFrom::Start(pos - e.data)).map_err(|e| e.to_string())?;
            let at = out.len();
            out.resize(at + (upto - pos) as usize, 0);
            // A file that shrank since it was shared would corrupt the copy: stop instead.
            file.read_exact(&mut out[at..]).map_err(|_| "changed")?;
            pos = upto;
        } else {
            let upto = (e.data + padded(e.size)).min(end);
            out.resize(out.len() + (upto - pos) as usize, 0);
            pos = upto;
        }
        if pos >= e.data + padded(e.size) {
            i += 1;
        }
    }
    Ok(out)
}

/// Unpacks a received folder archive into `target` (which it creates). Paths that would
/// escape `target` are refused by the tar crate.
pub fn unpack(archive: &Path, target: &Path) -> io::Result<()> {
    fs::create_dir_all(target)?;
    let mut tar = tar::Archive::new(fs::File::open(archive)?);
    tar.set_preserve_mtime(false);
    tar.set_preserve_permissions(false);
    tar.unpack(target)
}
