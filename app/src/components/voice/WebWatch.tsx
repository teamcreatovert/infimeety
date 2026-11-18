import clsx from 'clsx';
import { Globe, LogOut, MonitorPlay, Play, Shield, X } from 'lucide-react';
import { useState } from 'react';
import type { Channel, WebStatus } from '../../../../shared/protocol';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/primitives';
import { DOWNLOAD_PAGE } from '@/config';
import { canWatchWeb, endWeb, joinWeb, leaveWeb, showBrowser, siteName, startWeb, useWeb, WEB_SITES } from '@/lib/watchWeb';
import { useAuth } from '@/stores/auth';
import { useChannels } from '@/stores/channels';
import { useVoice } from '@/stores/voice';

function useRoomPeople(roomId: string) {
  const channelId = useVoice((s) => s.channelId);
  const participants = useChannels((s) => (channelId ? s.voice[channelId]?.participants : undefined));
  return [...new Set((participants ?? []).filter((p) => p.roomId === roomId).sort((a, b) => a.joinedAt - b.joinedAt).map((p) => p.userId))];
}

/** Start watching a website together: a site's shortcut, or any link. */
export function WebStart({ roomId }: { roomId: string }) {
  const [link, setLink] = useState('');
  if (!canWatchWeb)
    return (
      <p className="mt-6 max-w-[300px] text-[12px] leading-snug text-fg-3">
        Watch Netflix, YouTube and more together, each on your own account, in the{' '}
        <a href={DOWNLOAD_PAGE} target="_blank" rel="noopener" className="text-accent hover:underline">
          Infimeety app
        </a>
        .
      </p>
    );
  const open = (url: string) => void startWeb(roomId, url);
  const typed = link.trim();
  const url = /^https:\/\//i.test(typed) ? typed : typed ? `https://${typed}` : '';
  return (
    <div className="mt-7 w-full max-w-[320px] text-left">
      <div className="flex items-center gap-2 text-[13px] font-semibold">
        <Globe size={15} className="text-accent" /> Or watch on a website
      </div>
      <p className="mt-1 text-[11.5px] leading-snug text-fg-3">Everyone signs in to their own account in the Infimeety browser. Play, pause and skips stay in sync.</p>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {WEB_SITES.map((s) => (
          <button key={s.name} onClick={() => open(s.url)} className="rounded-full bg-fill-2 px-3 py-1.5 text-[12px] font-medium transition-colors hover:bg-fill-3">
            {s.name}
          </button>
        ))}
      </div>
      <form
        className="mt-2 flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (url) open(url);
        }}
      >
        <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Or paste a link" className="field h-8 min-w-0 flex-1 px-2.5 text-[12.5px]" />
        <Button size="sm" variant="secondary" type="submit" disabled={!url}>
          Open
        </Button>
      </form>
      <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-fg-3">
        <Shield size={11} className="mt-0.5 shrink-0" /> Your logins stay on this computer. Infimeety only shares the link and play, pause and time.
      </p>
    </div>
  );
}

const STATUS: Record<WebStatus['state'], string> = { opening: 'Opening it…', signin: 'Signing in', ready: 'Ready', ad: 'Watching an ad', away: 'Not watching' };

/** A website the room is watching together: join in, or what everyone's up to. */
export function WebCard({ channel, roomId }: { channel: Channel; roomId: string }) {
  const web = useWeb((s) => s.webs[roomId]);
  const joined = useWeb((s) => s.joined === roomId);
  const statuses = useWeb((s) => s.statuses[roomId]);
  const people = useRoomPeople(roomId);
  const users = useChannels((s) => s.users);
  const me = useAuth((s) => s.me?.id);
  if (!web) return null;
  const host = users[web.hostId];
  const canEnd = web.hostId === me || channel.role !== 'member';
  return (
    <div className="scroll h-full p-3">
      <div className="flex items-center gap-3 rounded-[14px] bg-fill-1 p-3 shadow-[inset_0_0_0_0.5px_var(--hairline)]">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[13px] bg-accent text-white">
          <MonitorPlay size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-semibold">{web.title}</div>
          <div className="mt-0.5 truncate text-[11.5px] text-fg-3">
            {siteName(web.url)} · {web.hostId === me ? 'You lead' : `${host?.name ?? 'Someone'} leads`}
          </div>
        </div>
      </div>

      {!canWatchWeb ? (
        <p className="mt-3 rounded-[12px] bg-fill-1 px-3 py-2.5 text-[12px] leading-snug text-fg-2">
          Watching websites together works in the{' '}
          <a href={DOWNLOAD_PAGE} target="_blank" rel="noopener" className="text-accent hover:underline">
            Infimeety app
          </a>
          .
        </p>
      ) : joined ? (
        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="primary" className="flex-1" icon={<MonitorPlay size={13} />} onClick={showBrowser}>
            Show the browser
          </Button>
          <Button size="sm" className="flex-1" icon={<LogOut size={13} />} onClick={() => leaveWeb()}>
            Leave
          </Button>
        </div>
      ) : (
        <Button variant="primary" className="mt-3 w-full" icon={<Play size={14} fill="currentColor" />} onClick={() => void joinWeb(roomId)}>
          Join on your own account
        </Button>
      )}
      {web.hostId === me && joined && <p className="mt-2 text-[11.5px] leading-snug text-fg-3">Open any title in the browser: everyone who joined goes there with you.</p>}
      {!joined && canWatchWeb && <p className="mt-2 text-[11.5px] leading-snug text-fg-3">It opens in the Infimeety browser. Sign in there if the site asks; your login stays on this computer.</p>}

      <h4 className="mb-1.5 mt-4 px-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-fg-3">{people.length} in the room</h4>
      <div className="rounded-[14px] bg-fill-1 p-1.5 shadow-[inset_0_0_0_0.5px_var(--hairline)]">
        {people.map((id) => {
          const state = statuses?.[id]?.state ?? 'away';
          return (
            <div key={id} className="flex items-center gap-2.5 rounded-[10px] px-1.5 py-1.5">
              <Avatar user={users[id]} size={26} />
              <span className="min-w-0 flex-1 truncate text-[13px]">
                {users[id]?.name ?? 'Someone'}
                {id === me && <span className="text-fg-3"> (you)</span>}
              </span>
              <span className={clsx('shrink-0 text-[11.5px]', state === 'ready' ? 'text-success' : state === 'ad' ? 'text-warning' : 'text-fg-3')}>{STATUS[state]}</span>
            </div>
          );
        })}
      </div>

      {canEnd && (
        <Button size="sm" variant="soft-danger" className="mt-4 w-full" icon={<X size={13} />} onClick={() => endWeb(roomId)}>
          Stop watching together
        </Button>
      )}
    </div>
  );
}
