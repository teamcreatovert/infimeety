import type { ReactNode } from 'react';
import { openExternal } from './platform';

const TOKEN =
  /(```[\s\S]+?```|`[^`\n]+`|\*\*[^*\n]+\*\*|~~[^~\n]+~~|(?<![\w*])\*[^*\n]+\*(?![\w*])|(?<![\w])_[^_\n]+_(?![\w])|https?:\/\/[^\s<]+[^\s<.,:;"')\]!?]|(?<![\w])@[a-z0-9_.]{3,24})/gi;

/** Safe, tiny markdown subset: code, bold, italic, strike, links and @mentions. No HTML injection. */
export function renderRich(text: string, myUsername?: string | null): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(TOKEN)) {
    const t = m[0];
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    last = at + t.length;
    const k = key++;

    if (t.startsWith('```')) {
      out.push(
        <pre key={k} className="my-1 overflow-x-auto rounded-xl bg-black/25 px-3 py-2 font-mono text-[12.5px] leading-relaxed">
          <code>{t.slice(3, -3).replace(/^[\w-]*\n/, '')}</code>
        </pre>,
      );
    } else if (t.startsWith('`')) {
      out.push(
        <code key={k} className="rounded-md bg-fill-3 px-1.5 py-px font-mono text-[0.9em]">
          {t.slice(1, -1)}
        </code>,
      );
    } else if (t.startsWith('**')) {
      out.push(<strong key={k} className="font-semibold">{t.slice(2, -2)}</strong>);
    } else if (t.startsWith('~~')) {
      out.push(<del key={k} className="opacity-70">{t.slice(2, -2)}</del>);
    } else if (t.startsWith('*') || t.startsWith('_')) {
      out.push(<em key={k}>{t.slice(1, -1)}</em>);
    } else if (t.startsWith('http')) {
      out.push(
        <a
          key={k}
          href={t}
          onClick={(e) => {
            e.preventDefault();
            void openExternal(t);
          }}
          className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
        >
          {t}
        </a>,
      );
    } else {
      const self = myUsername && t.slice(1).toLowerCase() === myUsername.toLowerCase();
      out.push(
        <span
          key={k}
          className="rounded-md px-1 font-medium"
          style={{
            background: `color-mix(in srgb, var(--accent) ${self ? 28 : 16}%, transparent)`,
            color: self ? 'var(--fg)' : 'var(--accent)',
          }}
        >
          {t}
        </span>,
      );
    }
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
