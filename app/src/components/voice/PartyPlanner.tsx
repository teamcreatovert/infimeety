import clsx from 'clsx';
import { Captions, ChevronDown, Film, FolderOpen, Plus, Popcorn, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DEFAULT_PARTY_SETTINGS, partyRules, type PartyRules, type PartySettings } from '../../../../shared/protocol';
import { Modal } from '../ui/overlay';
import { Button, Group, Row, Segmented, Select, Switch } from '../ui/primitives';
import { DOWNLOAD_PAGE } from '@/config';
import { formatBytes } from '@/lib/format';
import { changeMovie, createParty, OPEN_LIMIT, pickMovie, pickSubtitle, saveSettings, useParty, whenInRoom } from '@/lib/party';
import { isApp, type SharedFile } from '@/lib/platform';
import { confirmCallSwitch } from '@/lib/voice/callSwitch';
import { voice } from '@/lib/voice/engine';
import { useChannels } from '@/stores/channels';
import { toast, useUI } from '@/stores/ui';
import { useVoice } from '@/stores/voice';

const SETTINGS_KEY = 'infimeety.partySettings';
// Both Movie rows share the settings rows' padding, and their buttons share one width.
const MEDIA_ROW = 'flex min-h-[56px] items-center gap-3 px-3.5 py-2.5';
const MEDIA_BUTTON = 'w-[104px] shrink-0 justify-center';

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
  // Only rooms where an admin hasn't turned watch parties off.
  const voiceRooms = channel?.rooms.filter((r) => r.kind === 'voice' && r.allowParty !== false) ?? [];
  const myRoom = useVoice((s) => (s.channelId === channel?.id ? s.roomId : null));
  const existing = useParty((s) => (target?.edit && target.roomId ? s.parties[target.roomId] : undefined));
  const [roomId, setRoomId] = useState('');
  const [movie, setMovie] = useState<SharedFile | null>(null);
  const [subtitle, setSubtitle] = useState<SharedFile | null>(null);
  const [settings, setSettings] = useState<PartySettings>(DEFAULT_PARTY_SETTINGS);
  const [busy, setBusy] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const close = () => useUI.getState().set({ partyPlanner: null });

  // Fresh each time it opens: the room you're in (or were pointed at), your usual settings.
  useEffect(() => {
    if (!target) return;
    const allowed = (id: string | null | undefined) => (id && voiceRooms.some((r) => r.id === id) ? id : null);
    setRoomId(allowed(target.roomId) ?? allowed(myRoom) ?? voiceRooms[0]?.id ?? '');
    setMovie(null);
    setSubtitle(null);
    setSettings(existing?.settings ?? lastSettings());
    setBusy(false);
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!target || !channel) return <Modal open={false} onClose={close}>{null}</Modal>;
  const editing = !!existing;
  const set = (patch: Partial<PartySettings>) => setSettings((s) => ({ ...s, ...patch }));
  const rules = partyRules(settings);
  const setPersonal = (patch: Partial<PartyRules>) => set({ personal: { ...rules.personal, ...patch } });
  const allowed = Object.values(rules.personal).filter(Boolean).length;
  const strict = allowed === 0 && rules.changes === 'hosts';
  const relaxed = allowed === 4 && rules.changes === 'anyone';

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
    if (useVoice.getState().roomId !== roomId) {
      if (!(await confirmCallSwitch(channel.id))) return setBusy(false);
      await voice.join(channel.id, roomId, { confirmed: true });
    }
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
          <div className={MEDIA_ROW}>
            <Film size={18} className="shrink-0 text-fg-3" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium">{movie?.name ?? existing?.file.name ?? 'No movie chosen yet'}</div>
              <div className="mt-0.5 text-[11.5px] leading-snug text-fg-3">
                {movie ? formatBytes(movie.size) : existing ? `${formatBytes(existing.file.size)} · picking another sends everyone back to the lobby` : 'MP4 or WebM plays everywhere. The app plays more formats.'}
              </div>
            </div>
            <Button size="sm" variant={movie || existing ? 'secondary' : 'primary'} icon={<FolderOpen size={13} />} className={MEDIA_BUTTON} onClick={() => void chooseMovie()}>
              {movie || existing ? 'Change' : 'Choose…'}
            </Button>
          </div>
          <div className={MEDIA_ROW}>
            <Captions size={18} className="shrink-0 text-fg-3" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] text-fg-2">{subtitle?.name ?? (editing && !movie ? (existing?.subtitle?.name ?? 'No subtitles') : 'Subtitles')}</div>
              {!subtitle && !(editing && !movie && existing?.subtitle) && <div className="mt-0.5 text-[11.5px] leading-snug text-fg-3">Optional · SRT or VTT</div>}
            </div>
            {subtitle ? (
              <Button size="sm" variant="secondary" className={MEDIA_BUTTON} onClick={() => setSubtitle(null)}>
                Remove
              </Button>
            ) : (
              <Button size="sm" variant="secondary" icon={<Plus size={13} />} className={MEDIA_BUTTON} onClick={() => void chooseSubtitle()}>
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

        {/* The rules: a few short rows; what people may change for themselves opens below its row. */}
        <Group title="Rules" footer={editing ? 'Rules change for everyone right away, even in the middle of the movie.' : undefined}>
          <div className="flex gap-2 p-2.5">
            <PresetButton active={strict} onClick={() => set({ personal: { audio: false, brightness: false, subtitles: false, saturation: false }, changes: 'hosts' })} title="Strict" detail="Nobody changes the movie but the host" />
            <PresetButton active={relaxed} onClick={() => set({ personal: { audio: true, brightness: true, subtitles: true, saturation: true }, changes: 'anyone' })} title="Relaxed" detail="Everyone picks what they like" />
          </div>
          <Row label="3, 2, 1 countdown" detail="Before the movie starts, and every time it plays again after a pause.">
            <Switch checked={rules.countdown} onChange={(countdown) => set({ countdown })} />
          </Row>
          <button onClick={() => setRulesOpen((o) => !o)} className="flex min-h-[44px] w-full items-center gap-4 px-3.5 py-2 text-left">
            <div className="min-w-0 flex-1">
              <div className="text-[13px]">What people can change for themselves</div>
              <div className="mt-0.5 text-[11.5px] leading-snug text-fg-3">{allowed === 0 ? 'Nothing: everyone watches it the same way' : allowed === 4 ? 'Everything' : `${allowed} of 4 allowed`}</div>
            </div>
            <ChevronDown size={16} className={clsx('shrink-0 text-fg-3 transition-transform', rulesOpen && 'rotate-180')} />
          </button>
          {rulesOpen && (
            <div className="mx-3 mb-2.5 rounded-[12px] bg-fill-1">
              <Row label="Sound track" detail="Dual audio: pick a language just for yourself.">
                <Switch checked={rules.personal.audio} onChange={(audio) => setPersonal({ audio })} />
              </Row>
              <Row label="Brightness">
                <Switch checked={rules.personal.brightness} onChange={(brightness) => setPersonal({ brightness })} />
              </Row>
              <Row label="Subtitles" detail="Which ones, their timing.">
                <Switch checked={rules.personal.subtitles} onChange={(subtitles) => setPersonal({ subtitles })} />
              </Row>
              <Row label="Color">
                <Switch checked={rules.personal.saturation} onChange={(saturation) => setPersonal({ saturation })} />
              </Row>
              <p className="px-3.5 pb-2.5 text-[11.5px] leading-snug text-fg-3">Volume and subtitle size are always each person’s own.</p>
            </div>
          )}
          <Row
            label="Changes for everyone"
            detail={rules.changes === 'hosts' ? 'Only you and your co-hosts.' : rules.changes === 'anyone' ? 'Anyone can change it for everyone, right away.' : 'Anyone can ask; it happens only if everyone says yes.'}
          >
            <Select
              value={rules.changes}
              options={[
                { value: 'hosts', label: 'Host only' },
                { value: 'vote', label: 'Vote' },
                { value: 'anyone', label: 'Anyone' },
              ]}
              onChange={(changes) => set({ changes })}
            />
          </Row>
        </Group>

        {!editing && voiceRooms.length === 0 && (
          <p className="mb-1 rounded-[12px] bg-fill-1 px-3.5 py-3 text-[12.5px] leading-snug text-fg-2">
            Watch parties are turned off in this channel’s voice rooms. An admin can turn them on from a voice room’s menu.
          </p>
        )}
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

function PresetButton({ active, onClick, title, detail }: { active: boolean; onClick: () => void; title: string; detail: string }) {
  return (
    <button
      onClick={onClick}
      className={clsx('flex-1 rounded-[12px] px-3 py-2 text-left transition-colors', active ? 'bg-accent text-white' : 'bg-fill-1 hover:bg-fill-2')}
    >
      <div className="text-[13px] font-semibold">{title}</div>
      <div className={clsx('mt-0.5 text-[11.5px] leading-snug', active ? 'text-white/80' : 'text-fg-3')}>{detail}</div>
    </button>
  );
}
