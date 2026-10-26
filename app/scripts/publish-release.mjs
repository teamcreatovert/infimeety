// Publishes the signed installer built by `tauri build` as a GitHub release, plus the
// `latest.json` that installed apps poll for one-click updates.
//
// The Release workflow (.github/workflows/release.yml) runs this after code-signing the
// installer; that's the normal way to ship. Local builds aren't code-signed, so antivirus
// is likelier to block them (docs/CODE-SIGNING.md). To publish one anyway:
//
//   1. Bump the version (package.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml)
//   2. $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content ~/.tauri/infimeety.key -Raw
//      $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
//      npx tauri build
//   3. node scripts/publish-release.mjs "What's new in this version"
//
// Requires the GitHub CLI signed in (`gh auth login`, or GH_TOKEN in CI).

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'teamcreatovert/infimeety';
const root = fileURLToPath(new URL('..', import.meta.url));
const { version } = JSON.parse(readFileSync(join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
const tag = `v${version}`;
const bundle = join(root, 'src-tauri/target/release/bundle/nsis');
const installer = join(bundle, `Infimeety_${version}_x64-setup.exe`);
const signature = `${installer}.sig`;
const notes = process.argv[2] ?? `Infimeety ${version}`;

for (const file of [installer, signature]) {
  if (!existsSync(file)) throw new Error(`Missing ${file}. Run a signed \`tauri build\` first.`);
}
const authenticode = execFileSync(
  'powershell',
  ['-NoProfile', '-Command', '(Get-AuthenticodeSignature -LiteralPath $env:INSTALLER).Status'],
  { env: { ...process.env, INSTALLER: installer }, encoding: 'utf8' },
).trim();
if (authenticode !== 'Valid') console.warn(`Warning: the installer isn't code-signed (${authenticode}). See docs/CODE-SIGNING.md.`);
// SignPath Foundation's terms want a "Code signing policy" link on release pages. It goes on the
// GitHub release only; latest.json keeps the plain notes for the in-app update card.
const releaseNotes = authenticode === 'Valid' ? `${notes}\n\n[Code signing policy](https://github.com/${REPO}#code-signing-policy)` : notes;

const out = mkdtempSync(join(tmpdir(), 'infimeety-release-'));
const assetUrl = `https://github.com/${REPO}/releases/download/${tag}/Infimeety_${version}_x64-setup.exe`;
const platform = { signature: readFileSync(signature, 'utf8').trim(), url: assetUrl };
writeFileSync(
  join(out, 'latest.json'),
  JSON.stringify(
    {
      version,
      notes,
      pub_date: new Date().toISOString(),
      platforms: { 'windows-x86_64': platform, 'windows-x86_64-nsis': platform },
    },
    null,
    2,
  ),
);
// Stable name for the website's direct download link (…/releases/latest/download/Infimeety-Setup.exe).
copyFileSync(installer, join(out, 'Infimeety-Setup.exe'));

// In CI, a release started from the Actions tab has no tag yet: create it at the commit that was built.
const target = process.env.GITHUB_SHA ? ['--target', process.env.GITHUB_SHA] : [];
execFileSync(
  'gh',
  ['release', 'create', tag, installer, signature, join(out, 'Infimeety-Setup.exe'), join(out, 'latest.json'), '--repo', REPO, '--title', `Infimeety ${version}`, '--notes', releaseNotes, '--latest', ...target],
  { stdio: 'inherit' },
);
console.log(`\nPublished ${tag}: https://github.com/${REPO}/releases/tag/${tag}`);
