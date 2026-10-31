import { useEffect, useState } from 'react';
import { DEFAULT_AUTOMOD, type AutoModRules } from '../../../../shared/protocol';
import { Button, Group, Row, Select, Switch } from '../ui/primitives';
import { api } from '@/lib/api';
import { toast } from '@/stores/ui';

const MENTION_LIMITS = ['0', '3', '5', '10', '20'] as const;
const list = (text: string) =>
  text
    .split(/[\n,]/)
    .map((w) => w.trim())
    .filter(Boolean);

/**
 * Channel settings → AutoMod (admins): what the channel blocks before a message is posted.
 * Moderators and up are never blocked.
 */
export function AutoModSettings({ channelId }: { channelId: string }) {
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

  const save = async () => {
    setSaving(true);
    try {
      const r = await api<AutoModRules>(`/channels/${channelId}/automod`, { method: 'PUT', json: next });
      setSaved(r);
      setRules(r);
      setWords(r.words.join('\n'));
      setSites(r.allowedSites.join(', '));
      toast({ kind: 'success', title: 'AutoMod saved' });
    } catch {
      toast({ kind: 'error', title: 'Couldn’t save AutoMod' });
    } finally {
      setSaving(false);
    }
  };

  const field = 'field w-full rounded-[10px] bg-transparent px-3 py-2 text-[13px] outline-none placeholder:text-fg-3 disabled:opacity-50';
  // Nothing can be edited until the saved rules are in, so they never overwrite your typing.
  const loading = !saved;

  return (
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
  );
}
