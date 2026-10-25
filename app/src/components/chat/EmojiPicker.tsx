import clsx from 'clsx';
import { Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { EMOJI_GROUPS, loadEmoji, recentEmoji, rememberEmoji, type EmojiItem } from '@/lib/emoji';
import { Spinner } from '../ui/primitives';

export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [all, setAll] = useState<EmojiItem[] | null>(null);
  const [query, setQuery] = useState('');
  const [hovered, setHovered] = useState<EmojiItem | null>(null);
  const [activeGroup, setActiveGroup] = useState(-1);
  const scroller = useRef<HTMLDivElement>(null);
  const sections = useRef<Record<number, HTMLDivElement | null>>({});
  const recent = useMemo(recentEmoji, []);

  useEffect(() => {
    void loadEmoji().then(setAll);
  }, []);

  const byGroup = useMemo(() => {
    const map = new Map<number, EmojiItem[]>();
    for (const e of all ?? []) map.set(e.group, [...(map.get(e.group) ?? []), e]);
    return map;
  }, [all]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !all) return null;
    return all.filter((e) => e.label.toLowerCase().includes(q) || e.tags.some((t) => t.toLowerCase().startsWith(q))).slice(0, 160);
  }, [query, all]);

  const pick = (e: string) => {
    rememberEmoji(e);
    onPick(e);
  };

  const onScroll = () => {
    const top = scroller.current?.scrollTop ?? 0;
    let current = -1;
    for (const g of EMOJI_GROUPS) {
      const el = sections.current[g.id];
      if (el && el.offsetTop - 40 <= top) current = g.id;
    }
    setActiveGroup(current);
  };

  const cell = (e: EmojiItem | string) => {
    const item = typeof e === 'string' ? { e, label: '', tags: [], group: -1 } : e;
    return (
      <button
        key={item.e}
        onClick={() => pick(item.e)}
        onMouseEnter={() => setHovered(item)}
        className="emoji grid h-9 w-9 place-items-center rounded-[9px] text-[22px] transition-transform duration-100 hover:scale-110 hover:bg-fill-2"
      >
        {item.e}
      </button>
    );
  };

  return (
    <div className="flex h-[380px] w-[344px] flex-col">
      <div className="p-2.5 pb-1.5">
        <label className="field flex h-8 items-center gap-2 px-2.5">
          <Search size={14} className="text-fg-3" />
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search emoji" className="h-full w-full bg-transparent text-[13px] outline-none placeholder:text-fg-3" />
        </label>
      </div>
      {!results && (
        <div className="flex justify-between px-2.5 pb-1">
          {EMOJI_GROUPS.map((g) => (
            <button
              key={g.id}
              title={g.label}
              onClick={() => scroller.current?.scrollTo({ top: (sections.current[g.id]?.offsetTop ?? 0) - 4, behavior: 'smooth' })}
              className={clsx('emoji grid h-7 w-7 place-items-center rounded-[7px] text-[15px] transition', activeGroup === g.id ? 'bg-fill-3' : 'opacity-60 hover:bg-fill-2 hover:opacity-100')}
            >
              {g.icon}
            </button>
          ))}
        </div>
      )}
      <div ref={scroller} onScroll={onScroll} className="scroll relative flex-1 px-2 pb-2" style={{ scrollbarGutter: 'auto' }}>
        {!all ? (
          <div className="grid h-full place-items-center text-fg-3">
            <Spinner />
          </div>
        ) : results ? (
          results.length ? (
            <div className="grid grid-cols-8">{results.map(cell)}</div>
          ) : (
            <div className="grid h-full place-items-center text-[12.5px] text-fg-3">No emoji found</div>
          )
        ) : (
          EMOJI_GROUPS.map((g) => {
            const items = g.id === -1 ? recent : byGroup.get(g.id);
            if (!items?.length) return null;
            return (
              <div key={g.id} ref={(el) => void (sections.current[g.id] = el)}>
                <div className="sticky top-0 z-10 bg-[var(--glass-pop)] px-1.5 py-1 text-[11px] font-semibold text-fg-3 backdrop-blur-md">{g.label}</div>
                <div className="grid grid-cols-8">{items.map(cell)}</div>
              </div>
            );
          })
        )}
      </div>
      <div className="hairline-t flex h-10 items-center gap-2 px-3">
        {hovered ? (
          <>
            <span className="emoji text-[22px]">{hovered.e}</span>
            <span className="truncate text-[12px] capitalize text-fg-2">{hovered.label}</span>
          </>
        ) : (
          <span className="text-[12px] text-fg-3">Pick an emoji</span>
        )}
      </div>
    </div>
  );
}
