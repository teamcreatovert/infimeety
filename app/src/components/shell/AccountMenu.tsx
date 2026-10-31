import { LogOut, Settings, UserPlus } from 'lucide-react';
import { Avatar } from '../ui/Avatar';
import { MenuItem, MenuSeparator } from '../ui/overlay';
import { addAccount, savedAccounts, switchAccount } from '@/lib/accounts';
import { confirmDialog } from '@/lib/confirm';
import { voice } from '@/lib/voice/engine';
import { useAuth } from '@/stores/auth';
import { useUI } from '@/stores/ui';
import { useVoice } from '@/stores/voice';

/** Up to this many accounts on one device. */
export const MAX_ACCOUNTS = 5;

/** Leaving a call to change accounts asks first, like leaving it for another call. */
export async function okToLeaveCall() {
  if (!useVoice.getState().roomId) return true;
  const ok = await confirmDialog({ title: 'Switch accounts?', body: 'You’ll leave the call you’re in.', confirm: 'Switch', cancel: 'Stay' });
  if (ok) voice.leave({ silent: true });
  return ok;
}

/**
 * The account menu under your name (bottom left), like Discord's: switch to another account on
 * this device in one click, add one without signing out, open settings or sign out.
 */
export function AccountMenu({ onClose }: { onClose: () => void }) {
  const me = useAuth((s) => s.me);
  const accounts = savedAccounts();
  const others = accounts.filter((a) => a.id !== me?.id);
  if (!me) return null;

  const go = async (action: () => void) => {
    onClose();
    if (await okToLeaveCall()) action();
  };

  return (
    <>
      <div className="flex items-center gap-2.5 px-2.5 pb-2 pt-1.5">
        <Avatar user={me} size={32} />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold">{me.name}</div>
          <div className="truncate text-[11.5px] text-fg-3">@{me.username}</div>
        </div>
      </div>
      {others.length > 0 && (
        <>
          <MenuSeparator />
          <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-fg-3">Switch to</div>
          {others.map((a) => (
            <MenuItem key={a.id} icon={<Avatar user={a} size={18} />} onClick={() => void go(() => switchAccount(a.id))}>
              {a.name} <span className="opacity-60">@{a.username}</span>
            </MenuItem>
          ))}
        </>
      )}
      <MenuSeparator />
      <MenuItem icon={<UserPlus size={15} />} disabled={accounts.length >= MAX_ACCOUNTS} onClick={() => void go(addAccount)}>
        {accounts.length >= MAX_ACCOUNTS ? `Up to ${MAX_ACCOUNTS} accounts` : 'Add account'}
      </MenuItem>
      <MenuItem icon={<Settings size={15} />} onClick={() => (onClose(), useUI.getState().set({ settingsTab: 'account' }))}>
        Settings
      </MenuItem>
      <MenuItem icon={<LogOut size={15} />} danger onClick={() => void go(() => void useAuth.getState().signOut())}>
        {others.length ? `Sign out of ${me.name}` : 'Sign out'}
      </MenuItem>
    </>
  );
}
