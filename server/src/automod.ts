import { DEFAULT_AUTOMOD, type AutoModRules } from '../../shared/protocol';

/** Rules as an admin sent them, made safe to store: sizes capped, words trimmed and lower-cased. */
export function cleanRules(input: unknown): AutoModRules {
  const r = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const list = (v: unknown, max: number, len: number) =>
    [...new Set((Array.isArray(v) ? v : []).map((x) => String(x ?? '').trim().toLowerCase().slice(0, len)).filter(Boolean))].slice(0, max);
  return {
    words: list(r.words, 300, 60),
    links: r.links === true,
    allowedSites: list(r.allowedSites, 50, 100).map((s) => s.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')),
    mentions: Math.max(0, Math.min(50, Math.floor(Number(r.mentions) || 0))),
    spam: r.spam === true,
  };
}

export function parseRules(json: string | null | undefined): AutoModRules {
  if (!json) return DEFAULT_AUTOMOD;
  try {
    return cleanRules(JSON.parse(json));
  } catch {
    return DEFAULT_AUTOMOD;
  }
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Letters and digits of any script count as part of a word, so this works for Bangla too.
const EDGE_BEFORE = '(?<![\\p{L}\\p{N}])';
const EDGE_AFTER = '(?![\\p{L}\\p{N}])';

const compiled = new WeakMap<string[], RegExp | null>();
function wordPattern(words: string[]) {
  if (compiled.has(words)) return compiled.get(words)!;
  const parts = words.map((w) => (w.endsWith('*') ? `${escape(w.slice(0, -1))}[\\p{L}\\p{N}]*` : escape(w)));
  const re = parts.length ? new RegExp(`${EDGE_BEFORE}(?:${parts.join('|')})${EDGE_AFTER}`, 'iu') : null;
  compiled.set(words, re);
  return re;
}

const LINK = /\b(?:https?:\/\/|www\.)[^\s<>]+|\b(?:[a-z0-9-]+\.)+(?:com|net|org|gg|io|xyz|ru|me|ly|co|app|dev|tv|link|site|online|info|biz|cc|to|tk|ml|ga|cf|gq|top|shop|store|live)\b(?:\/[^\s<>]*)?/gi;

function hostOf(link: string) {
  try {
    return new URL(/^https?:\/\//i.test(link) ? link : `http://${link}`).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Recent messages per person, for the spam rule. */
export type History = Map<string, { text: string; at: number }[]>;

/** Why AutoMod blocks this message, or null to let it through. */
export function blockedBy(rules: AutoModRules, content: string, userId: string, history?: History): string | null {
  const text = content.normalize('NFKC');
  const words = wordPattern(rules.words);
  if (words?.test(text)) return 'a blocked word';
  if (rules.links) {
    for (const link of text.match(LINK) ?? []) {
      const host = hostOf(link);
      if (!rules.allowedSites.some((site) => host === site || host.endsWith(`.${site}`))) return 'links';
    }
  }
  if (rules.mentions > 0 && (text.match(/(?:^|\s)@[\p{L}\p{N}_.-]+/gu)?.length ?? 0) > rules.mentions) return 'too many mentions';
  if (rules.spam && history) {
    const now = Date.now();
    const key = text.trim().toLowerCase();
    const recent = (history.get(userId) ?? []).filter((m) => now - m.at < 30_000);
    if (key && recent.filter((m) => m.text === key).length >= 2) return 'spam';
    recent.push({ text: key, at: now });
    history.set(userId, recent.slice(-10));
  }
  return null;
}
