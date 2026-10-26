import { create } from 'zustand';

/** An in-app "are you sure?" (instead of the browser's plain confirm box). */
export interface ConfirmOptions {
  title: string;
  body?: string;
  confirm: string;
  cancel?: string;
  danger?: boolean;
}

export const useConfirm = create<{ ask: (ConfirmOptions & { resolve: (ok: boolean) => void }) | null }>()(() => ({ ask: null }));

/** Shows the dialog; resolves true for the confirm button, false for anything else. */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  useConfirm.getState().ask?.resolve(false);
  return new Promise((resolve) => useConfirm.setState({ ask: { ...options, resolve } }));
}

export function answerConfirm(ok: boolean) {
  const ask = useConfirm.getState().ask;
  if (!ask) return;
  useConfirm.setState({ ask: null });
  ask.resolve(ok);
}
