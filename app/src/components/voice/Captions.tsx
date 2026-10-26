import { Copy, Download } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { Button, Segmented } from '../ui/primitives';
import { setCaptions, transcriptText, useCaptions, useCaptionsOn } from '@/lib/captions';
import { spring } from '@/lib/motion';
import { isApp } from '@/lib/platform';
import { useAuth } from '@/stores/auth';
import { useChannels } from '@/stores/channels';
import { useSettings } from '@/stores/settings';
import { toast } from '@/stores/ui';

/** The last few lines of speech, above the call's controls, while captions are on. */
export function CaptionsOverlay() {
  const on = useCaptionsOn();
  const lines = useCaptions((s) => s.lines);
  const users = useChannels((s) => s.users);
  const meId = useAuth((s) => s.me?.id);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  if (!on) return null;
  const recent = lines.filter((l) => now - l.at < 9000).slice(-3);
  return (
    <div className="pointer-events-none absolute bottom-full left-1/2 mb-3 flex w-[min(640px,86vw)] -translate-x-1/2 flex-col items-center gap-1">
      <AnimatePresence initial={false}>
        {recent.map((l) => (
          <motion.div
            key={l.id}
            layout
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.3 } }}
            transition={spring}
            className="max-w-full rounded-[12px] bg-black/70 px-3 py-1.5 text-center text-[14px] leading-snug text-white shadow-lg backdrop-blur-md"
          >
            <span className="font-semibold text-white/75">{l.userId === meId ? 'You' : (users[l.userId]?.name ?? 'Someone')}: </span>
            {l.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/** What the captions button opens while captions are on. */
export function CaptionsMenu({ onClose }: { onClose: () => void }) {
  const language = useSettings((s) => s.captionLanguage);
  const count = useCaptions((s) => s.lines.length);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(transcriptText());
      toast({ kind: 'success', title: 'Transcript copied', body: 'Paste it anywhere.' });
    } catch {
      toast({ kind: 'error', title: 'Couldn’t copy the transcript' });
    }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([transcriptText()], { type: 'text/plain' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `Infimeety transcript ${new Date().toISOString().slice(0, 16).replace('T', ' ')}.txt` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  return (
    <div className="w-[300px] p-3">
      <div className="px-0.5 text-[13.5px] font-semibold">Live captions</div>
      <p className="mt-1 px-0.5 text-[11.5px] leading-snug text-fg-3">Everyone’s speech shows as text for the whole room. It’s turned into text by Cloudflare’s speech service and never stored.</p>
      <div className="mb-1 mt-3 px-0.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-fg-3">I’m speaking</div>
      <Segmented
        id="caption-language"
        value={language}
        onChange={(captionLanguage) => useSettings.getState().set({ captionLanguage })}
        options={[
          { value: 'auto', label: 'Detect' },
          { value: 'bn', label: 'বাংলা' },
          { value: 'en', label: 'English' },
        ]}
      />
      <div className="mt-3 flex gap-2">
        <Button size="sm" className="flex-1" icon={<Copy size={13} />} disabled={!count} onClick={() => void copy()}>
          Copy transcript
        </Button>
        {!isApp && (
          <Button size="sm" icon={<Download size={13} />} disabled={!count} onClick={download}>
            .txt
          </Button>
        )}
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="mt-2 w-full !text-danger"
        onClick={() => {
          onClose();
          setCaptions(false);
        }}
      >
        Turn off captions for everyone
      </Button>
    </div>
  );
}
