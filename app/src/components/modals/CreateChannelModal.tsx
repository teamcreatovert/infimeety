import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { EmojiPicker } from '../chat/EmojiPicker';
import { Modal, Popover, type Anchor } from '../ui/overlay';
import { Button, Segmented, TextField } from '../ui/primitives';
import { ApiError } from '@/lib/api';
import { CHANNEL_COLORS, channelGradient } from '@/lib/format';
import { parseJoinInput } from '@/lib/invite';
import { parseMeetingInput } from '@/lib/meeting';
import { spring } from '@/lib/motion';
import { sounds } from '@/lib/sounds';
import { useChannels } from '@/stores/channels';
import { useMeetings } from '@/stores/meetings';
import { toast, useUI } from '@/stores/ui';

export function CreateChannelModal() {
  const mode = useUI((s) => s.createChannel);
  const close = () => useUI.getState().set({ createChannel: null });
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('🎬');
  const [color, setColor] = useState('purple');
  const [code, setCode] = useState('');
  const [picker, setPicker] = useState<Anchor | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode) {
      setError(null);
      setBusy(false);
    }
  }, [mode]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'create') {
        const ch = await useChannels.getState().create({ name: name.trim(), emoji, color });
        toast({ kind: 'success', title: `${ch.name} is ready`, body: 'Invite friends from the channel menu.' });
        setName('');
      } else {
        const ch = await useChannels.getState().join(code);
        toast({ kind: 'success', title: `Welcome to ${ch.name}` });
        setCode('');
      }
      sounds.pop();
      close();
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'invalid_code' ? 'That invite code doesn’t exist.' : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={!!mode} onClose={close} width={440}>
      <form onSubmit={submit} className="p-7">
        <Segmented
          id="create-join"
          value={mode ?? 'create'}
          onChange={(v) => useUI.getState().set({ createChannel: v })}
          options={[
            { value: 'create', label: 'Create a channel' },
            { value: 'join', label: 'Join with a code' },
          ]}
        />
        <AnimatePresence mode="wait" initial={false}>
          {mode === 'join' ? (
            <motion.div key="join" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={spring} className="pt-7 text-center">
              <div className="text-[44px]">🎟️</div>
              <h2 className="mt-2 font-display text-[22px] font-bold tracking-[-0.025em]">Join your friends</h2>
              <p className="mt-1 text-[13px] text-fg-2">Enter the invite code someone shared with you.</p>
              <TextField
                autoFocus
                className="mt-6 h-12!"
                inputClassName="text-center font-mono text-[20px]! tracking-[0.3em] uppercase"
                placeholder="ABCD2345"
                value={code}
                onChange={(e) => {
                  // A meeting link pasted here opens the "Join meeting?" sheet instead.
                  const meeting = parseMeetingInput(e.target.value);
                  if (meeting) {
                    close();
                    useMeetings.getState().set({ joining: meeting });
                  } else setCode(parseJoinInput(e.target.value));
                }}
              />
              <p className="mt-2.5 text-[11.5px] text-fg-3">Got a meeting link? Paste it here too.</p>
            </motion.div>
          ) : (
            <motion.div key="create" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} transition={spring} className="pt-7 text-center">
              <motion.button
                type="button"
                whileHover={{ scale: 1.05, rotate: -3 }}
                whileTap={{ scale: 0.95 }}
                onClick={(e) => setPicker(e.currentTarget.getBoundingClientRect())}
                className="emoji mx-auto grid h-[84px] w-[84px] place-items-center rounded-[26px] text-[42px] shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_14px_34px_rgba(0,0,0,0.3)]"
                style={{ background: channelGradient(color) }}
              >
                {emoji}
              </motion.button>
              <div className="mt-4 flex justify-center gap-2.5">
                {Object.keys(CHANNEL_COLORS).map((c) => (
                  <button key={c} type="button" aria-label={c} onClick={() => setColor(c)} className="relative h-5 w-5 rounded-full transition-transform hover:scale-110" style={{ background: channelGradient(c) }}>
                    {color === c && <motion.span layoutId="color-ring" transition={spring} className="absolute -inset-[3px] rounded-full shadow-[0_0_0_2px_var(--fg)]" />}
                  </button>
                ))}
              </div>
              <TextField autoFocus className="mt-6 h-11!" inputClassName="text-center text-[15px]!" placeholder="Movie Club, The Squad, Study Hall…" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
              <p className="mt-2.5 text-[11.5px] text-fg-3">You’ll get a #general chat room plus Lounge and Movie Night voice rooms. Add as many more as you like.</p>
            </motion.div>
          )}
        </AnimatePresence>
        {error && <p className="mt-3 text-center text-[12.5px] text-danger">{error}</p>}
        <div className="mt-7 flex gap-2">
          <Button type="button" className="flex-1" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" className="flex-1" loading={busy} disabled={mode === 'join' ? code.length < 8 : !name.trim()}>
            {mode === 'join' ? 'Join channel' : 'Create channel'}
          </Button>
        </div>
      </form>
      <Popover open={!!picker} anchor={picker} onClose={() => setPicker(null)} side="right" align="center">
        <EmojiPicker
          onPick={(e) => {
            setEmoji(e);
            setPicker(null);
          }}
        />
      </Popover>
    </Modal>
  );
}
