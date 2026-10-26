import { motion } from 'motion/react';
import { Video } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { MeetingPreview } from '../../../../shared/protocol';
import { Avatar } from '../ui/Avatar';
import { Modal } from '../ui/overlay';
import { Button, Spinner, TextField } from '../ui/primitives';
import { ApiError } from '@/lib/api';
import { channelGradient } from '@/lib/format';
import { loadMeetingPreview, parseMeetingInput } from '@/lib/meeting';
import { useChannels } from '@/stores/channels';
import { useMeetings } from '@/stores/meetings';
import { toast } from '@/stores/ui';

/** "Join ⟨host⟩'s meeting?" for meeting links opened from outside the app or pasted in; '' asks for a link or code. */
export function JoinMeetingModal() {
  const joining = useMeetings((s) => s.joining);
  const close = () => useMeetings.getState().set({ joining: null });
  return (
    <Modal open={joining !== null} onClose={close} width={380}>
      {joining !== null && <JoinMeeting key={joining} initial={joining} onClose={close} />}
    </Modal>
  );
}

function JoinMeeting({ initial, onClose }: { initial: string; onClose: () => void }) {
  const [code, setCode] = useState<string | null>(initial || null);
  const [input, setInput] = useState('');
  const [preview, setPreview] = useState<MeetingPreview | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const existing = useChannels((s) => s.channels.find((c) => c.kind === 'meeting' && c.inviteCode === code));

  useEffect(() => {
    if (!code) return;
    setPreview(undefined);
    void loadMeetingPreview(code).then(setPreview);
  }, [code]);

  const join = async (camera: boolean) => {
    if (!code) return;
    setBusy(true);
    try {
      const meetings = useMeetings.getState();
      const channel = existing ?? (await meetings.join(code));
      useChannels.getState().select(channel.id);
      onClose();
      await meetings.enterCall(channel, { camera });
    } catch (err) {
      const removed = err instanceof ApiError && err.code === 'removed';
      toast({ kind: 'error', title: removed ? 'You were removed from this meeting' : 'This meeting has ended' });
      setBusy(false);
    }
  };

  if (!code) {
    const parsed = parseMeetingInput(input);
    return (
      <form
        className="p-7 text-center"
        onSubmit={(e) => {
          e.preventDefault();
          if (parsed) setCode(parsed);
        }}
      >
        <MeetingTile color="teal" />
        <h2 className="mt-4 font-display text-[21px] font-bold tracking-[-0.025em]">Join a meeting</h2>
        <p className="mt-1 text-[13px] text-fg-2">Paste the meeting link, or type its code.</p>
        <TextField
          autoFocus
          className="mt-5 h-12!"
          inputClassName="text-center font-mono text-[17px]! tracking-[0.08em]"
          placeholder="abcd-efgh-ijk"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPaste={(e) => {
            const pasted = parseMeetingInput(e.clipboardData.getData('text'));
            if (pasted) {
              e.preventDefault();
              setCode(pasted);
            }
          }}
        />
        <div className="mt-6 flex gap-2">
          <Button type="button" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" className="flex-1" disabled={!parsed}>
            Continue
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="p-7 text-center">
      {preview === undefined ? (
        <div className="grid h-[200px] place-items-center text-fg-3">
          <Spinner />
        </div>
      ) : preview === null ? (
        <>
          <MeetingTile color="graphite" />
          <h2 className="mt-4 font-display text-[19px] font-bold">This meeting has ended</h2>
          <p className="mt-1 text-[13px] leading-snug text-fg-2">Meetings close a day after they start, or once nobody has been in them for an hour. Ask for a new link.</p>
          <Button className="mt-6 w-full" onClick={onClose}>
            Close
          </Button>
        </>
      ) : (
        <>
          <MeetingTile color="teal" />
          <p className="mt-4 text-[12.5px] text-fg-2">You’re invited to a meeting</p>
          <h2 className="font-display text-[22px] font-bold tracking-[-0.025em]">{preview.name}</h2>
          <p className="mt-1 flex items-center justify-center gap-1.5 text-[12.5px] text-fg-3">
            <Avatar user={preview.host} size={16} />
            {preview.inCall > 0 ? `${preview.inCall} in the call` : 'Nobody’s in the call yet'}
          </p>
          <div className="mt-6 flex gap-2">
            <Button className="flex-1" onClick={onClose}>
              Not now
            </Button>
            <Button variant="primary" className="flex-1" loading={busy} onClick={() => void join(false)}>
              {existing ? 'Rejoin' : 'Join'}
            </Button>
          </div>
          <button disabled={busy} onClick={() => void join(true)} className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-accent hover:underline disabled:opacity-50">
            <Video size={13} /> Join with video
          </button>
        </>
      )}
    </div>
  );
}

function MeetingTile({ color }: { color: string }) {
  return (
    <motion.div
      initial={{ scale: 0.8, rotate: -6 }}
      animate={{ scale: 1, rotate: 0 }}
      className="mx-auto grid h-[76px] w-[76px] place-items-center rounded-[24px] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_14px_34px_rgba(0,0,0,0.3)]"
      style={{ background: channelGradient(color) }}
    >
      <Video size={34} strokeWidth={1.8} />
    </motion.div>
  );
}
