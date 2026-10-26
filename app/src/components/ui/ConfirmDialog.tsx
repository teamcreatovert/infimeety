import { useEffect, useRef } from 'react';
import { Modal } from './overlay';
import { Button } from './primitives';
import { answerConfirm, useConfirm } from '@/lib/confirm';

/** The one confirm dialog the app shows (see confirmDialog). Enter confirms, Escape cancels. */
export function ConfirmDialog() {
  const ask = useConfirm((s) => s.ask);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (ask) requestAnimationFrame(() => confirmRef.current?.focus());
  }, [ask]);

  return (
    <Modal open={!!ask} onClose={() => answerConfirm(false)} width={380}>
      {ask && (
        <div className="p-5">
          <h2 className="font-display text-[17px] font-semibold tracking-[-0.015em]">{ask.title}</h2>
          {ask.body && <p className="mt-1.5 text-[13.5px] leading-[1.45] text-fg-2">{ask.body}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <Button onClick={() => answerConfirm(false)}>{ask.cancel ?? 'Cancel'}</Button>
            <Button ref={confirmRef} variant={ask.danger ? 'danger' : 'primary'} onClick={() => answerConfirm(true)}>
              {ask.confirm}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
