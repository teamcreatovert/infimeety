import { motion } from 'motion/react';
import { AtSign, Check, Lock, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Me } from '../../../../shared/protocol';
import { Button, Spinner, TextField } from '../ui/primitives';
import { AvatarEditor } from './AvatarEditor';
import { api, ApiError } from '@/lib/api';
import { softSpring } from '@/lib/motion';
import { sounds } from '@/lib/sounds';
import { useAuth } from '@/stores/auth';

type Availability = 'ok' | 'checking' | 'taken' | 'invalid';
const USERNAME = /^[a-z0-9_.]{3,24}$/;

export function useUsernameCheck(username: string, current: string | null) {
  const [state, setState] = useState<Availability>('ok');
  useEffect(() => {
    const u = username.toLowerCase();
    if (u === current) return setState('ok');
    if (!USERNAME.test(u)) return setState('invalid');
    setState('checking');
    const t = setTimeout(async () => {
      try {
        const { available } = await api<{ available: boolean }>(`/me/username-available?u=${encodeURIComponent(u)}`);
        setState(available ? 'ok' : 'taken');
      } catch {
        setState('ok');
      }
    }, 350);
    return () => clearTimeout(t);
  }, [username, current]);
  return state;
}

export function UsernameStatus({ state }: { state: Availability }) {
  if (state === 'checking') return <Spinner size={14} className="text-fg-3" />;
  if (state === 'ok') return <Check size={15} className="text-success" />;
  return <X size={15} className="text-danger" />;
}

export function Onboarding() {
  const me = useAuth((s) => s.me)!;
  const setMe = useAuth((s) => s.setMe);
  const [name, setName] = useState(me.name);
  const [username, setUsername] = useState(me.username ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const availability = useUsernameCheck(username, me.username);
  const provider = me.providers.includes('google') ? 'Google' : me.providers.includes('discord') ? 'Discord' : 'your account';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (availability !== 'ok' || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api<Me>('/me', { method: 'PATCH', json: { name: name.trim(), username: username.toLowerCase(), onboarded: true } });
      sounds.join();
      setMe(updated);
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'username_taken' ? 'That username was just taken.' : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const hint =
    availability === 'invalid' ? '3–24 characters: letters, numbers, dots and underscores' : availability === 'taken' ? 'That username is taken' : 'This is how friends find and mention you';

  return (
    <div className="relative grid h-full place-items-center">
      <motion.form
        onSubmit={submit}
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, scale: 0.98 }}
        transition={softSpring}
        className="w-[440px] rounded-[32px] px-9 pb-8 pt-9 glass-pop"
      >
        <div className="text-center">
          <h1 className="font-display text-[26px] font-bold tracking-[-0.03em]">Make it yours</h1>
          <p className="mt-1 text-[13.5px] text-fg-2">Pick how friends will see you. You can change this anytime.</p>
        </div>

        <div className="mt-7">
          <AvatarEditor size={108} />
        </div>

        <div className="mt-7 flex flex-col gap-4">
          <Field label="Display name">
            <TextField value={name} onChange={(e) => setName(e.target.value)} maxLength={48} placeholder="Your name" autoFocus />
          </Field>
          <Field label="Username" hint={hint} hintTone={availability === 'invalid' || availability === 'taken' ? 'danger' : undefined}>
            <TextField
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s/g, ''))}
              maxLength={24}
              leading={<AtSign size={15} />}
              trailing={<UsernameStatus state={availability} />}
            />
          </Field>
          <Field label="Email" hint={`From ${provider}`}>
            <TextField value={me.email ?? ''} readOnly leading={<Lock size={14} />} inputClassName="text-fg-2" />
          </Field>
        </div>

        {error && <p className="mt-3 text-[12.5px] text-danger">{error}</p>}

        <Button type="submit" variant="primary" size="lg" className="mt-7 w-full" loading={busy} disabled={availability !== 'ok' || !name.trim()}>
          Continue
        </Button>
      </motion.form>
    </div>
  );
}

function Field({ label, hint, hintTone, children }: { label: string; hint?: string; hintTone?: 'danger'; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 px-0.5 text-[12px] font-semibold text-fg-2">{label}</div>
      {children}
      {hint && <div className={`mt-1.5 px-0.5 text-[11.5px] ${hintTone === 'danger' ? 'text-danger' : 'text-fg-3'}`}>{hint}</div>}
    </div>
  );
}
