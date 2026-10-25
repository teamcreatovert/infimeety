export interface EmojiItem {
  e: string;
  label: string;
  tags: string[];
  group: number;
}

export const EMOJI_GROUPS = [
  { id: -1, label: 'Recently used', icon: '🕘' },
  { id: 0, label: 'Smileys & emotion', icon: '😀' },
  { id: 1, label: 'People & body', icon: '👋' },
  { id: 3, label: 'Animals & nature', icon: '🐻' },
  { id: 4, label: 'Food & drink', icon: '🍔' },
  { id: 5, label: 'Travel & places', icon: '✈️' },
  { id: 6, label: 'Activities', icon: '⚽' },
  { id: 7, label: 'Objects', icon: '💡' },
  { id: 8, label: 'Symbols', icon: '💜' },
  { id: 9, label: 'Flags', icon: '🏁' },
];

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉', '👀'];

let cache: Promise<EmojiItem[]> | null = null;

/**
 * Detects emoji the system font can't draw (newer Unicode releases on older Windows),
 * by comparing each glyph against the font's "missing glyph" box and checking that
 * ZWJ sequences render as a single glyph.
 */
function makeSupportCheck() {
  const size = 20;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return () => true;
  ctx.font = `${size - 4}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
  ctx.textBaseline = 'top';
  const pixels = (text: string) => {
    ctx.clearRect(0, 0, size, size);
    ctx.fillText(text, 0, 0);
    return ctx.getImageData(0, 0, size, size).data;
  };
  const tofu = pixels('\u{10FFFD}');
  const base = ctx.measureText('😀').width;
  return (e: string) => {
    if (ctx.measureText(e).width > base * 1.6) return false; // sequence fell apart into several glyphs
    const p = pixels(e);
    for (let i = 0; i < p.length; i++) if (p[i] !== tofu[i]) return true;
    return false;
  };
}

/** Emoji data is ~300 KB, so it loads on first use. */
export function loadEmoji() {
  return (cache ??= import('emojibase-data/en/compact.json').then((mod) => {
    const supported = makeSupportCheck();
    return (mod.default as Array<{ unicode: string; label: string; tags?: string[]; group?: number; order?: number }>)
      .filter((e) => e.group !== undefined && e.group !== 2 && supported(e.unicode))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((e) => ({ e: e.unicode, label: e.label, tags: e.tags ?? [], group: e.group! }));
  }));
}

const RECENT_KEY = 'infimeety.recentEmoji';

export function recentEmoji(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function rememberEmoji(e: string) {
  localStorage.setItem(RECENT_KEY, JSON.stringify([e, ...recentEmoji().filter((x) => x !== e)].slice(0, 32)));
}
