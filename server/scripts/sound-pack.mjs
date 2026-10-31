// Publishes the repo's sounds folder with the website (pages/public/sounds) plus sounds.json,
// the list every app syncs from at start (app/src/lib/soundPack.ts). Add a file to sounds/ and
// deploy: everyone gets it; delete one: it disappears from everyone's soundboard.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const from = join(here, '..', '..', 'sounds');
const to = join(here, '..', 'pages', 'public', 'sounds');
const KINDS = new Set(['.mp3', '.ogg', '.wav', '.m4a', '.webm']);
/** Long clips don't belong on a soundboard. */
const MAX_BYTES = 1024 * 1024;

/**
 * A readable name from the file name: "bruh-sound-effect_WstdzdM.mp3" → "Bruh", "applause_2.mp3"
 * → "Applause". Downloader-site leftovers (prefixes, ids, time ranges) are dropped; rename a file
 * to choose its name exactly.
 */
function prettyName(file, fallback) {
  const base = file
    .slice(0, -extname(file).length)
    .replace(/^(yt1s(\.com)?|ny[-_ ]video[-_ ]online[-_ ]audio[-_ ]converter)[-_ ]*/i, '')
    .replace(/_[A-Za-z0-9]{5,}$/, '')
    .replace(/_\d+$/, '');
  const words = base
    .replace(/[-_]+/g, ' ')
    .replace(/\bsound effect\b/gi, '')
    .replace(/\b\d+s \d+s\b/g, '')
    .replace(/\b(?=\w*\d)\w{7,}\b/g, '')
    .replace(/\b(copy|hd)\b/gi, '')
    .replace(/\s\d+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : fallback;
}

const slug = (file) => file.slice(0, -extname(file).length).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });
const sounds = [];
for (const file of existsSync(from) ? readdirSync(from).sort() : []) {
  if (!KINDS.has(extname(file).toLowerCase())) continue;
  const bytes = readFileSync(join(from, file));
  if (bytes.length > MAX_BYTES) {
    console.warn(`Skipping ${file}: over 1 MB`);
    continue;
  }
  const out = `${slug(file)}${extname(file).toLowerCase()}`;
  copyFileSync(join(from, file), join(to, out));
  const name = prettyName(file, `Sound ${sounds.length + 1}`);
  sounds.push({ id: slug(file), name, file: `sounds/${out}`, size: bytes.length, hash: createHash('sha1').update(bytes).digest('hex').slice(0, 12) });
}
const version = createHash('sha1').update(JSON.stringify(sounds)).digest('hex').slice(0, 12);
writeFileSync(join(to, 'sounds.json'), JSON.stringify({ version, sounds }, null, 2));
console.log(`Sound pack: ${sounds.length} sounds (version ${version})`);
