import { Captions, Film, FolderOpen, Popcorn, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DEFAULT_PARTY_SETTINGS, type PartySettings } from '../../../../shared/protocol';
import { Modal } from '../ui/overlay';
import { Button, Group, Row, Segmented, Select, Switch } from '../ui/primitives';
import { DOWNLOAD_PAGE } from '@/config';
import { formatBytes } from '@/lib/format';
import { changeMovie, createParty, OPEN_LIMIT, pickMovie, pickSubtitle, saveSettings, useParty, whenInRoom } from '@/lib/party';
import { isApp, type SharedFile } from '@/lib/platform';
import { voice } from '@/lib/voice/engine';
import { useChannels } from '@/stores/channels';
import { toast, useUI } from '@/stores/ui';
import { useVoice } from '@/stores/voice';

const SETTINGS_KEY = 'infimeety.partySettings';

function lastSettings(): PartySettings {
  try {
    return { ...DEFAULT_PARTY_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return DEFAULT_PARTY_SETTINGS;
  }
}

/**
 * Plans a watch party: the movie and subtitles, where to watch, and how it runs. Creating it
 * opens a lobby in that voice room (joining its call), where everyone gets the movie and says
 * they're ready. The host reopens this as the party's settings.
 */
export function PartyPlanner() {
  const target = useUI((s) => s.partyPlanner);
  const channel = useChannels((s) => s.channels.find((c) => c.id === target?.channelId));
  const voiceRooms = channel?.rooms.filter((r) => r.kind === 'voice') ?? [];
  const myRoom = useVoice((s) => (s.channelId === channel?.id ? s.roomId : null));
  const existing = useParty((s) => (target?.edit && target.roomId ? s.parties[target.roomId] : undefined));
  const [roomId, setRoomId] = useState('');
  const [movie, setMovie] = useState<SharedFile | null>(null);
  const [subtitle, setSubtitle] = useState<SharedFile | null>(null);
  const [settings, setSettings] = useState<PartySettings>(DEFAULT_PARTY_SETTINGS);
  const [busy, setBusy] = useState(false);
  const close = () => useUI.getState().set({ partyPlanner: null });

  // Fresh each time it opens: the room you're in (or were pointed at), your usual settings.
  useEffect(() => {
    if (!target) return;
    setRoomId(target.roomId ?? myRoom ?? voiceRooms[0]?.id ?? '');
    setMovie(null);
    setSubtitle(null);
    setSettings(existing?.settings ?? lastSettings());
    setBusy(false);
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!target || !channel) return <Modal open={false} onClose={close}>{null}</Modal>;
  const editing = !!existing;
  const set = (patch: Partial<PartySettings>) => setSettings((s) => ({ ...s, ...patch }));

  const chooseMovie = async () => {
    const picked = await pickMovie();
    if (!picked.movie) return;
    setMovie(picked.movie);
    if (picked.subtitle) setSubtitle(picked.subtitle);
  };
  const chooseSubtitle = async () => {
    const file = await pickSubtitle();
    if (file) setSubtitle(file);
  };

  const create = async () => {
    if (!movie || !roomId) return;
    setBusy(true);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* private mode */
    }
    if (useVoice.getState().roomId !== roomId) await voice.join(channel.id, roomId);
    if (!(await whenInRoom(roomId))) {
      setBusy(false);
      return toast({ kind: 'error', title: 'Couldn’t join the call', body: 'Check your connection and try again.' });
    }
    // Show the lobby: spaces open the voice room; DMs and meetings show their call.
    if (channel.kind === 'space') useChannels.getState().selectRoom(channel.id, roomId);
    else useChannels.getState().select(channel.id);
    useUI.getState().set({ partyView: true, focusedPeer: null });
    createParty(roomId, movie, subtitle, settings);
    close();
  };

  const save = () => {
    if (!existing || !target.roomId) return;
    saveSettings(target.roomId, settings);
    if (movie) changeMovie(target.roomId, movie, subtitle);
    close();
  };

  return (
    <Modal open onClose={close} width={520}>
      <div className="relative px-6 pb-6 pt-6 compact:px-4">
        <button aria-label="Close" onClick={close} className="absolute right-4 top-4 grid h-7 w-7 place-items-center rounded-full bg-fill-2 text-fg-2 hover:bg-fill-3">
          <X size={14} />
        </button>
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-[14px] bg-accent text-white">
            <Popcorn size={22} />
          </span>
          <div>
            <h2 className="font-display text-[19px] font-bold tracking-[-0.02em]">{editing ? 'Watch party settings' : 'Plan a watch party'}</h2>
            <p className="text-[12.5px] text-fg-2">{editing ? 'Changes apply for everyone right away.' : 'Everyone gets the movie, says they’re ready, and you start it together.'}</p>
          </div>
        </div>

        <div className="h-5" />
        <Group title="Movie">
          <div className="flex items-center gap-3 p-3">
            <Film size={18} className="shrink-0 text-fg-3" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium">{movie?.name ?? existing?.file.name ?? 'No movie chosen yet'}</div>
              <div className="text-[11.5px] text-fg-3">
                {movie ? formatBytes(movie.size) : existing ? `${formatBytes(existing.file.size)} · picking another sends everyone back to the lobby` : 'MP4 or WebM play everywhere; the app plays more'}
              </div>
            </div>
            <Button size="sm" variant={movie || existing ? 'ghost' : 'primary'} icon={<FolderOpen size={13} />} onClick={() => void chooseMovie()}>
              {movie || existing ? 'Change' : 'Choose…'}
            </Button>
          </div>
          <div className="flex items-center gap-3 p-3 pt-0">
            <Captions size={18} className="shrink-0 text-fg-3" />
            <div className="min-w-0 flex-1 truncate text-[13px] text-fg-2">{subtitle?.name ?? (editing && !movie ? (existing?.subtitle?.name ?? 'No subtitles') : 'No subtitles (optional)')}</div>
            {subtitle ? (
              <Button size="sm" variant="ghost" onClick={() => setSubtitle(null)}>
                Remove
              </Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => void chooseSubtitle()}>
                Add…
              </Button>
            )}
          </div>
        </Group>

        {!editing && channel.kind === 'space' && voiceRooms.length > 1 && (
          <Group title="Watch in" footer={roomId !== myRoom ? 'You’ll join this voice room’s call.' : undefined}>
            <Row label="Voice room">
              <Select value={roomId} options={voiceRooms.map((r) => ({ value: r.id, label: r.name }))} onChange={setRoomId} />
            </Row>
          </Group>
        )}

        <Group
          title="Who can play, pause and skip"
          footer={
            settings.control === 'auto'
              ? `Everyone, until more than ${OPEN_LIMIT} people are watching. Then only you and the co-hosts you pick.`
              : settings.control === 'hosts'
                ? 'Only you and the co-hosts you pick (from the People tab).'
                : 'Anyone watching.'
          }
        >
          <div className="p-2.5">
            <Segmented
              id="party-control"
              value={settings.control}
              onChange={(control) => set({ control })}
              options={[
                { value: 'everyone', label: 'Everyone' },
                { value: 'auto', label: 'Automatic' },
                { value: 'hosts', label: 'Host & co-hosts' },
              ]}
            />
          </div>
        </Group>

        <Group>
          <Row label="Others can send requests" detail="“Play from 1:43:28”, “Pause”… you tap Accept and it happens for everyone.">
            <Switch checked={settings.requests} onChange={(requests) => set({ requests })} />
          </Row>
          <Row label="Start when everyone’s ready" detail="Otherwise you start it yourself, ready or not; latecomers join in where you are.">
            <Switch checked={settings.autoStart} onChange={(autoStart) => set({ autoStart })} />
          </Row>
        </Group>

        {!isApp && (
          <a href={DOWNLOAD_PAGE} target="_blank" rel="noopener" className="mt-4 block text-[12px] text-fg-3 hover:text-accent">
            Movies copy faster and more formats play in the Infimeety app →
          </a>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          {editing ? (
            <Button variant="primary" onClick={save}>
              Save
            </Button>
          ) : (
            <Button variant="primary" icon={<Popcorn size={15} />} disabled={!movie || !roomId} loading={busy} onClick={() => void create()}>
              Open the lobby
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
