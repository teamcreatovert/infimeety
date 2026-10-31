import { Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DEFAULT_AUTOMOD, type AutoModRules, type AutoModTrigger, type Room, type TriggerAction } from '../../../../shared/protocol';
import { Button, Group, Row, Select, Switch } from '../ui/primitives';
import { api } from '@/lib/api';
import { toast } from '@/stores/ui';

const MENTION_LIMITS = ['0', '3', '5', '10', '20'] as const;
const list = (text: string) =>
  text
    .split(/[\n,]/)
    .map((w) => w.trim())
    .filter(Boolean);

const ACTIONS: { value: TriggerAction; label: string }[] = [
  { value: 'chatBan', label: 'Chat ban' },
  { value: 'voiceMute', label: 'Voice mute' },
  { value: 'move', label: 'Move to a voice room' },
  { value: 'disconnect', label: 'Disconnect from voice' },
];
const DURATIONS = ['30', '60', '300', '600'] as const;
const durationLabel = (s: number) => (s % 60 === 0 ? `${s / 60} minute${s === 60 ? '' : 's'}` : `${s} seconds`);

function describe(t: AutoModTrigger, rooms: Room[]) {
  switch (t.action) {
    case 'chatBan':
      return `Chat ban for ${durationLabel(t.seconds)}`;
    case 'voiceMute':
      return `Voice mute for ${durationLabel(t.seconds)}`;
    case 'move':
      return `Move to ${rooms.find((r) => r.id === t.roomId)?.name ?? 'a voice room'}`;
    case 'disconnect':
      return 'Disconnect from voice';
  }
}

/**
 * Channel settings → AutoMod (moderators and up): what the channel blocks before a message is
 * posted, and the fun rules (say a word, get a chat ban, a voice mute or a trip to another room).
 */
export function AutoModSettings({ channelId, voiceRooms }: { channelId: string; voiceRooms: Room[] }) {
  const [saved, setSaved] = useState<AutoModRules | null>(null);
  const [rules, setRules] = useState<AutoModRules>(DEFAULT_AUTOMOD);
  const [words, setWords] = useState('');
  const [sites, setSites] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    void api<AutoModRules>(`/channels/${channelId}/automod`)
      .then((r) => {
        if (!live) return;
        setSaved(r);
        setRules(r);
        setWords(r.words.join('\n'));
        setSites(r.allowedSites.join(', '));
      })
      .catch(() => live && setSaved(DEFAULT_AUTOMOD));
    return () => void (live = false);
  }, [channelId]);

  const next: AutoModRules = { ...rules, words: list(words), allowedSites: list(sites) };
  const changed = !!saved && JSON.stringify(next) !== JSON.stringify(saved);

  const save = async (rulesToSave = next) => {
    setSaving(true);
    try {
      const r = await api<AutoModRules>(`/channels/${channelId}/automod`, { method: 'PUT', json: rulesToSave });
      setSaved(r);
      setRules(r);
      setWords(r.words.join('\n'));
      setSites(r.allowedSites.join(', '));
      toast({ kind: 'success', title: 'Rules saved' });
    } catch {
      toast({ kind: 'error', title: 'Couldn’t save the rules' });
    } finally {
      setSaving(false);
    }
  };

  const field = 'field w-full rounded-[10px] bg-transparent px-3 py-2 text-[13px] outline-none placeholder:text-fg-3 disabled:opacity-50';
  // Nothing can be edited until the saved rules are in, so they never overwrite your typing.
  const loading = !saved;
  const triggers = rules.triggers ?? [];
  // Fun rules save right away: adding or removing one is a complete change on its own.
  const setTriggers = (list: AutoModTrigger[]) => {
    setRules({ ...rules, triggers: list });
    void save({ ...next, triggers: list });
  };

  return (
    <>
      <Group title="AutoMod" footer="Checked before a message is posted. Moderators, admins and the owner are never blocked.">
        <div className="px-3.5 pb-1 pt-3">
          <div className="text-[13px]">Blocked words and phrases</div>
          <div className="mb-2 text-[12px] text-fg-3">One per line or separated by commas. Add * to block words that start with it, like spam*.</div>
          <textarea disabled={loading} value={words} onChange={(e) => setWords(e.target.value)} rows={3} placeholder={'badword\nanother phrase'} className={`${field} resize-y`} />
        </div>
        <Row label="Block links" detail="Members can’t post links, except to the sites below.">
          <Switch disabled={loading} checked={rules.links} onChange={(links) => setRules({ ...rules, links })} />
        </Row>
        {rules.links && (
          <div className="px-3.5 pb-2">
            <input disabled={loading} value={sites} onChange={(e) => setSites(e.target.value)} placeholder="Allowed sites, like youtube.com, twitch.tv" className={field} />
          </div>
        )}
        <Row label="Mention limit" detail="The most people one message can @mention.">
          <Select
            value={String(rules.mentions) as (typeof MENTION_LIMITS)[number]}
            options={MENTION_LIMITS.map((v) => ({ value: v, label: v === '0' ? 'No limit' : `${v} people` }))}
            onChange={(v) => setRules({ ...rules, mentions: Number(v) })}
          />
        </Row>
        <Row label="Block spam" detail="The same message sent 3 times within 30 seconds.">
          <Switch disabled={loading} checked={rules.spam} onChange={(spam) => setRules({ ...rules, spam })} />
        </Row>
        <div className="flex justify-end px-3.5 pb-3 pt-1">
          <Button size="sm" disabled={!changed || saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save AutoMod'}
          </Button>
        </div>
      </Group>

      <Group title="Fun rules" footer="Say one of these words in chat and Nova steps in: the message isn’t posted, and everyone sees what happened. Only moderators and admins can change these.">
        {triggers.map((t) => (
          <Row key={t.id} label={t.words.join(', ')} detail={`${describe(t, voiceRooms)}${t.everyone ? ' · moderators too' : ''}`}>
            <button aria-label="Remove this rule" disabled={loading || saving} onClick={() => setTriggers(triggers.filter((x) => x.id !== t.id))} className="grid h-7 w-7 place-items-center rounded-[8px] text-fg-3 hover:bg-danger hover:text-white">
              <Trash2 size={14} />
            </button>
          </Row>
        ))}
        <NewTrigger disabled={loading || saving || triggers.length >= 20} voiceRooms={voiceRooms} onAdd={(t) => setTriggers([...triggers, t])} />
      </Group>
    </>
  );
}

function NewTrigger({ disabled, voiceRooms, onAdd }: { disabled: boolean; voiceRooms: Room[]; onAdd: (t: AutoModTrigger) => void }) {
  const [words, setWords] = useState('');
  const [action, setAction] = useState<TriggerAction>('chatBan');
  const [seconds, setSeconds] = useState<(typeof DURATIONS)[number]>('60');
  const [roomId, setRoomId] = useState(voiceRooms[0]?.id ?? '');
  const [everyone, setEveryone] = useState(false);
  const timed = action === 'chatBan' || action === 'voiceMute';
  const ready = list(words).length > 0 && (action !== 'move' || !!roomId);

  const add = () => {
    onAdd({ id: crypto.randomUUID().slice(0, 8), words: list(words).map((w) => w.toLowerCase()), action, seconds: Number(seconds), ...(action === 'move' ? { roomId } : {}), ...(everyone ? { everyone } : {}) });
    setWords('');
  };

  return (
    <div className="flex flex-col gap-2.5 px-3.5 py-3">
      <div className="text-[13px] font-medium">New rule</div>
      <input
        disabled={disabled}
        value={words}
        onChange={(e) => setWords(e.target.value)}
        placeholder="Words, like computer, kill"
        className="field w-full rounded-[10px] bg-transparent px-3 py-2 text-[13px] outline-none placeholder:text-fg-3 disabled:opacity-50"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Select value={action} options={ACTIONS} onChange={setAction} />
        {timed && <Select value={seconds} options={DURATIONS.map((v) => ({ value: v, label: durationLabel(Number(v)) }))} onChange={setSeconds} />}
        {action === 'move' && (voiceRooms.length ? <Select value={roomId} options={voiceRooms.map((r) => ({ value: r.id, label: r.name }))} onChange={setRoomId} /> : <span className="text-[12px] text-fg-3">Add a voice room first.</span>)}
      </div>
      <label className="flex items-center gap-2 text-[12.5px] text-fg-2">
        <Switch checked={everyone} onChange={setEveryone} disabled={disabled} />
        Moderators and admins get caught too
      </label>
      <div className="flex justify-end">
        <Button size="sm" variant="primary" disabled={disabled || !ready} onClick={add}>
          Add rule
        </Button>
      </div>
    </div>
  );
}
