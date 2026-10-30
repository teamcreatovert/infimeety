// Publishes the builds made by `tauri build` as a GitHub release, plus the `latest.json` that
// installed apps poll for one-click updates. Windows, Mac or both: whatever was built, plus the
// Android app (Infimeety.apk) when the Mobile workflow built it. If the release is already out,
// these builds join it (a Mac build that finished late, say).
//
// The Release workflow (.github/workflows/release.yml) runs this after building and signing
// both apps; that's the normal way to ship. Local builds aren't code-signed, so antivirus
// is likelier to block them (docs/CODE-SIGNING.md). To publish one anyway:
//
//   1. Bump the version (package.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml)
//   2. $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content ~/.tauri/infimeety.key -Raw
//      $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
//      npx tauri build
//   3. node scripts/publish-release.mjs "What's new in this version"
//
// In CI the builds come from other jobs: `--assets <dir>` points at them, and WINDOWS_SIGNED
// says whether the Windows installer is code-signed. Requires the GitHub CLI signed in
// (`gh auth login`, or GH_TOKEN in CI).

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'teamcreatovert/infimeety';
const root = fileURLToPath(new URL('..', import.meta.url));
const { version } = JSON.parse(readFileSync(join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
const tag = `v${version}`;

const args = process.argv.slice(2);
const assetsAt = args.indexOf('--assets');
const assetsDir = assetsAt >= 0 ? args[assetsAt + 1] : null;
const notes = args.find((a, i) => !a.startsWith('--') && (assetsAt < 0 || i !== assetsAt + 1)) ?? `Infimeety ${version}`;

/** A build output: in the --assets folder (any depth) in CI, else where `tauri build` leaves it. */
function find(name, localDir) {
  if (!assetsDir) {
    const path = join(root, 'src-tauri/target', localDir, name);
    return existsSync(path) ? path : null;
  }
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        const found = walk(path);
        if (found) return found;
      } else if (entry === name) return path;
    }
    return null;
  };
  return walk(assetsDir);
}

const windows = { installer: find(`Infimeety_${version}_x64-setup.exe`, 'release/bundle/nsis') };
windows.signature = windows.installer && find(`Infimeety_${version}_x64-setup.exe.sig`, 'release/bundle/nsis');
// One universal app for both Apple Silicon and Intel Macs.
const mac = {
  dmg: find(`Infimeety_${version}_universal.dmg`, 'universal-apple-darwin/release/bundle/dmg'),
  archive: find('Infimeety.app.tar.gz', 'universal-apple-darwin/release/bundle/macos'),
};
mac.signature = mac.archive && find('Infimeety.app.tar.gz.sig', 'universal-apple-darwin/release/bundle/macos');

// Linux: the AppImage updates itself (it is its own update, signed); the .deb is for Debian and Ubuntu.
const linux = {
  appimage: find(`Infimeety_${version}_amd64.AppImage`, 'release/bundle/appimage'),
  deb: find(`Infimeety_${version}_amd64.deb`, 'release/bundle/deb'),
};
linux.signature = linux.appimage && find(`Infimeety_${version}_amd64.AppImage.sig`, 'release/bundle/appimage');

// The Android app has no updater entry: Android updates it when a newer APK is installed.
const apk = assetsDir ? find('Infimeety.apk') : null;

const hasWindows = !!(windows.installer && windows.signature);
const hasMac = !!(mac.dmg && mac.archive && mac.signature);
const hasLinux = !!(linux.appimage && linux.signature);
if (windows.installer && !windows.signature) throw new Error(`Missing ${windows.installer}.sig. Sign it for the updater first.`);
if (mac.archive && !mac.signature) throw new Error('Missing Infimeety.app.tar.gz.sig. Build the Mac app with TAURI_SIGNING_PRIVATE_KEY set.');
if (!hasWindows && !hasMac && !hasLinux) throw new Error('Nothing to publish. Run a signed `tauri build` first.');

let codeSigned = false;
if (hasWindows) {
  const status =
    process.env.WINDOWS_SIGNED !== undefined
      ? process.env.WINDOWS_SIGNED === 'true'
        ? 'Valid'
        : 'NotSigned'
      : process.platform === 'win32'
        ? execFileSync('powershell', ['-NoProfile', '-Command', '(Get-AuthenticodeSignature -LiteralPath $env:INSTALLER).Status'], {
            env: { ...process.env, INSTALLER: windows.installer },
            encoding: 'utf8',
          }).trim()
        : 'Unknown';
  codeSigned = status === 'Valid';
  if (!codeSigned) console.warn(`Warning: the Windows installer isn't code-signed (${status}). See docs/CODE-SIGNING.md.`);
}
// SignPath Foundation's terms want a "Code signing policy" link on release pages. It goes on the
// GitHub release only; latest.json keeps the plain notes for the in-app update card.
const releaseNotes = codeSigned ? `${notes}\n\n[Code signing policy](https://github.com/${REPO}#code-signing-policy)` : notes;

const out = mkdtempSync(join(tmpdir(), 'infimeety-release-'));
const download = (name) => `https://github.com/${REPO}/releases/download/${tag}/${name}`;
const files = [];
const platforms = {};

if (hasWindows) {
  const platform = { signature: readFileSync(windows.signature, 'utf8').trim(), url: download(`Infimeety_${version}_x64-setup.exe`) };
  platforms['windows-x86_64'] = platform;
  platforms['windows-x86_64-nsis'] = platform;
  // Stable name for the download page (…/releases/latest/download/Infimeety-Setup.exe).
  copyFileSync(windows.installer, join(out, 'Infimeety-Setup.exe'));
  files.push(windows.installer, windows.signature, join(out, 'Infimeety-Setup.exe'));
}

if (hasMac) {
  const archive = `Infimeety_${version}_universal.app.tar.gz`;
  copyFileSync(mac.archive, join(out, archive));
  copyFileSync(mac.signature, join(out, `${archive}.sig`));
  const platform = { signature: readFileSync(mac.signature, 'utf8').trim(), url: download(archive) };
  for (const arch of ['aarch64', 'x86_64']) {
    platforms[`darwin-${arch}`] = platform;
    platforms[`darwin-${arch}-app`] = platform;
  }
  // Stable name for the download page (…/releases/latest/download/Infimeety.dmg).
  copyFileSync(mac.dmg, join(out, 'Infimeety.dmg'));
  files.push(mac.dmg, join(out, 'Infimeety.dmg'), join(out, archive), join(out, `${archive}.sig`));
}

if (hasLinux) {
  const platform = { signature: readFileSync(linux.signature, 'utf8').trim(), url: download(`Infimeety_${version}_amd64.AppImage`) };
  platforms['linux-x86_64'] = platform;
  platforms['linux-x86_64-appimage'] = platform;
  // Stable names for the download page (…/releases/latest/download/Infimeety.AppImage, Infimeety.deb).
  copyFileSync(linux.appimage, join(out, 'Infimeety.AppImage'));
  files.push(linux.appimage, linux.signature, join(out, 'Infimeety.AppImage'));
  if (linux.deb) {
    copyFileSync(linux.deb, join(out, 'Infimeety.deb'));
    files.push(linux.deb, join(out, 'Infimeety.deb'));
  }
}

if (apk) files.push(apk);

const released = (() => {
  try {
    execFileSync('gh', ['release', 'view', tag, '--repo', REPO], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
let pubDate = new Date().toISOString();
if (released) {
  // Keep the platforms already in the release's latest.json; these builds add to them.
  const dir = mkdtempSync(join(tmpdir(), 'infimeety-latest-'));
  try {
    execFileSync('gh', ['release', 'download', tag, '--repo', REPO, '--pattern', 'latest.json', '--dir', dir], { stdio: 'ignore' });
    const before = JSON.parse(readFileSync(join(dir, 'latest.json'), 'utf8'));
    for (const [key, value] of Object.entries(before.platforms ?? {})) platforms[key] ??= value;
    pubDate = before.pub_date ?? pubDate;
  } catch {
    /* no latest.json yet */
  }
}
writeFileSync(join(out, 'latest.json'), JSON.stringify({ version, notes, pub_date: pubDate, platforms }, null, 2));
files.push(join(out, 'latest.json'));

const built = [hasWindows && 'Windows', hasMac && 'Mac', hasLinux && 'Linux', apk && 'Android'].filter(Boolean).join(' + ');
if (released) {
  execFileSync('gh', ['release', 'upload', tag, ...files, '--repo', REPO, '--clobber'], { stdio: 'inherit' });
  console.log(`\nAdded ${built} to ${tag}: https://github.com/${REPO}/releases/tag/${tag}`);
} else {
  // In CI, a release started from the Actions tab has no tag yet: create it at the commit that was built.
  const target = process.env.GITHUB_SHA ? ['--target', process.env.GITHUB_SHA] : [];
  execFileSync('gh', ['release', 'create', tag, ...files, '--repo', REPO, '--title', `Infimeety ${version}`, '--notes', releaseNotes, '--latest', ...target], {
    stdio: 'inherit',
  });
  console.log(`\nPublished ${tag} (${built}): https://github.com/${REPO}/releases/tag/${tag}`);
}
