import { Bot as BotIcon, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Channel } from '../../../../shared/protocol';
import { Button, Group, TextField } from '../ui/primitives';
import { api, ApiError } from '@/lib/api';
import { confirmDialog } from '@/lib/confirm';
import { useChannels, type Bot } from '@/stores/channels';
import { toast } from '@/stores/ui';

const ERRORS: Record<string, string> = {
  bad_name: 'Use one word, 2–24 letters or numbers (people call it with @Name).',
  bad_instructions: 'Say what it does in a sentence or two.',
  name_taken: 'There’s already a bot with that name here.',
  too_many: 'A channel can have up to 10 bots of its own.',
};

/**
 * Channel settings → AI bots. Everyone sees which bots are here and how to call them; admins
 * make their own (a name and what it does) and remove them. Free: Cloudflare's Workers AI,
 * with a daily cap per channel.
 */
export function BotSettings({ channel }: { channel: Channel }) {
  const bots = useChannels((s) => s.bots[channel.id]);
  const admin = channel.role === 'owner' || channel.role === 'admin';
  const [name, setName] = useState('');
  const [job, setJob] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!bots) void useChannels.getState().loadMembers(channel.id).catch(() => {});
  }, [bots, channel.id]);

  const reload = () => useChannels.getState().loadMembers(channel.id).catch(() => {});

  const create = async () => {
    setBusy(true);
    try {
      await api<Bot>(`/channels/${channel.id}/bots`, { method: 'POST', json: { name: name.trim(), instructions: job.trim() } });
      toast({ kind: 'success', title: `${name.trim()} is ready`, body: `Anyone here can ask it something with @${name.trim()}.` });
      setName('');
      setJob('');
      await reload();
    } catch (err) {
      toast({ kind: 'error', title: 'Couldn’t make the bot', body: (err instanceof ApiError && ERRORS[err.code ?? '']) || 'Check your connection and try again.' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (bot: Bot) => {
    if (!(await confirmDialog({ title: `Remove ${bot.name}?`, body: 'Its old answers stay, but nobody can call it anymore.', confirm: 'Remove', danger: true }))) return;
    try {
      await api(`/channels/${channel.id}/bots/${bot.id}`, { method: 'DELETE' });
      await reload();
    } catch {
      toast({ kind: 'error', title: 'Couldn’t remove the bot' });
    }
  };

  return (
    <Group title="AI bots" footer="Free AI that answers right in the chat. Write @ and a bot's name with your question, like “@Nova what's a black hole?”.">
      {(bots ?? []).map((b) => (
        <div key={b.id} className="hairline-b flex items-start gap-3 px-4 py-3 last:border-0">
          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent text-white">
            <BotIcon size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-semibold">
              @{b.name} {b.builtIn && <span className="ml-1 text-[11px] font-medium text-fg-3">built in</span>}
            </div>
            <div className="mt-0.5 text-[12.5px] leading-snug text-fg-2">{b.instructions}</div>
          </div>
          {admin && !b.builtIn && (
            <button aria-label={`Remove ${b.name}`} onClick={() => void remove(b)} className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] text-fg-3 hover:bg-fill-2 hover:text-danger">
              <Trash2 size={15} />
            </button>
          )}
        </div>
      ))}
      {admin && (
        <div className="flex flex-col gap-2 px-4 py-3">
          <div className="text-[12.5px] font-medium text-fg-2">Make a bot for this channel</div>
          <TextField value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, one word (e.g. Chef)" maxLength={24} />
          <TextField value={job} onChange={(e) => setJob(e.target.value)} placeholder="What it does (e.g. suggests recipes from what's in the fridge)" maxLength={1000} />
          <div className="flex justify-end">
            <Button variant="primary" size="sm" loading={busy} disabled={name.trim().length < 2 || job.trim().length < 5} onClick={() => void create()}>
              Make bot
            </Button>
          </div>
        </div>
      )}
    </Group>
  );
}
