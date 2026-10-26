import { ChevronLeft } from 'lucide-react';
import { useCompact } from '@/lib/responsive';
import { useAuth } from '@/stores/auth';
import { useUI } from '@/stores/ui';

/** Phones: back from an open room to the channel list. Meeting guests have no list to go back to. */
export function MobileBack() {
  const compact = useCompact();
  const guest = useAuth((s) => !!s.me?.guest);
  if (!compact || guest) return null;
  return (
    <button
      aria-label="Back"
      onClick={() => useUI.getState().set({ mobileNav: true })}
      className="-ml-2 grid h-10 w-9 shrink-0 place-items-center rounded-[10px] text-fg-2 transition-colors active:bg-fill-2"
    >
      <ChevronLeft size={24} />
    </button>
  );
}
