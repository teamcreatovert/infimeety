// Builds the Microsoft Store package (MSIX) from an already built Windows app:
//   npx tauri build --no-bundle   (or the release workflow's build)
//   node scripts/store-package.mjs
// Output: src-tauri/target/store/Infimeety_<version>_x64.msix, uploaded unsigned to Partner
// Center (the Store signs it). The Store copy updates through the Store (lib/updater.ts).
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const tauri = join(here, '..', 'src-tauri');
const { version } = JSON.parse(readFileSync(join(tauri, 'tauri.conf.json'), 'utf8'));
const exe = join(tauri, 'target', 'release', 'infimeety.exe');
if (!existsSync(exe)) throw new Error(`Build the app first: ${exe} is missing.`);

const out = join(tauri, 'target', 'store');
const layout = join(out, 'layout');
rmSync(out, { recursive: true, force: true });
mkdirSync(join(layout, 'Assets'), { recursive: true });

copyFileSync(exe, join(layout, 'infimeety.exe'));
// Every size Windows asks for: the taskbar and Start take the "unplated" target sizes (no
// colored square behind the icon); store/Assets is made from icons/icon.png.
for (const icon of readdirSync(join(tauri, 'store', 'Assets'))) copyFileSync(join(tauri, 'store', 'Assets', icon), join(layout, 'Assets', icon));
// The Store wants four numbers, the last one 0.
const storeVersion = `${version.split('-')[0]}.0`;
writeFileSync(join(layout, 'AppxManifest.xml'), readFileSync(join(tauri, 'store', 'AppxManifest.xml'), 'utf8').replace('Version="{VERSION}"', `Version="${storeVersion}"`));

/** A tool from the newest Windows SDK on this machine. */
function sdkTool(name) {
  const bin = 'C:\\Program Files (x86)\\Windows Kits\\10\\bin';
  const sdks = existsSync(bin) ? readdirSync(bin).filter((d) => /^10\./.test(d)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) : [];
  for (const sdk of sdks.reverse()) {
    const tool = join(bin, sdk, 'x64', name);
    if (existsSync(tool)) return tool;
  }
  throw new Error(`${name} not found: install the Windows SDK.`);
}

// The index (resources.pri) that lets Windows find the sized icons above.
const priConfig = join(out, 'priconfig.xml');
execFileSync(sdkTool('makepri.exe'), ['createconfig', '/cf', priConfig, '/dq', 'en-US', '/pv', '10.0.0', '/o'], { stdio: 'inherit' });
// One index in one package: without this it splits off per-scale files meant for bundles.
writeFileSync(priConfig, readFileSync(priConfig, 'utf8').replace(/<packaging>[\s\S]*?<\/packaging>/, ''));
execFileSync(sdkTool('makepri.exe'), ['new', '/pr', layout, '/cf', priConfig, '/of', join(layout, 'resources.pri'), '/o'], { stdio: 'inherit' });

const msix = join(out, `Infimeety_${version}_x64.msix`);
execFileSync(sdkTool('makeappx.exe'), ['pack', '/d', layout, '/p', msix, '/o'], { stdio: 'inherit' });
console.log(`Store package: ${msix} (version ${storeVersion})`);
