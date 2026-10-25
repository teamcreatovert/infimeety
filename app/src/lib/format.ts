export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

const GRADIENTS = [
  ['#5E9BFF', '#7B61FF'],
  ['#FF7AA2', '#FF5E62'],
  ['#45D4A8', '#1E9BD7'],
  ['#FFB547', '#FF6A3D'],
  ['#B57BFF', '#6A5BFF'],
  ['#5AC8FA', '#007AFF'],
  ['#FF9F0A', '#FF375F'],
  ['#34C759', '#30B0C7'],
];

export function gradientFor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  const [a, b] = GRADIENTS[Math.abs(h) % GRADIENTS.length];
  return `linear-gradient(135deg, ${a}, ${b})`;
}

export const CHANNEL_COLORS: Record<string, [string, string]> = {
  blue: ['#5E9BFF', '#3D6BFF'],
  purple: ['#B57BFF', '#7B61FF'],
  pink: ['#FF7AA2', '#FF4F8B'],
  orange: ['#FFB547', '#FF7A3D'],
  green: ['#4CD964', '#2BB673'],
  teal: ['#5AD8E6', '#2A9BD7'],
  graphite: ['#8E8E93', '#5A5A60'],
};

export const channelGradient = (color: string) => {
  const [a, b] = CHANNEL_COLORS[color] ?? CHANNEL_COLORS.blue;
  return `linear-gradient(145deg, ${a}, ${b})`;
};

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
const fullFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' });

export const formatTime = (ms: number) => timeFmt.format(ms);
export const formatFull = (ms: number) => fullFmt.format(ms);

export function formatDay(ms: number) {
  const d = new Date(ms);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return dayFmt.format(d);
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`;
}

/** Messages containing only 1–3 emoji render large, like iMessage. */
export function isJumboEmoji(text: string) {
  const t = text.trim();
  if (!t || t.length > 24) return false;
  const stripped = t.replace(/\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️|\s/gu, '');
  if (stripped.length) return false;
  const count = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(t)].filter((s) => s.segment.trim()).length;
  return count > 0 && count <= 3;
}
