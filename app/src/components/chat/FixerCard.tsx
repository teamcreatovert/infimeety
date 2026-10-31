import clsx from 'clsx';
import { CircleAlert, CircleCheck, Info } from 'lucide-react';
import { useState } from 'react';
import type { Finding, FixerReport } from '@/lib/fixer';

/** Fixer's answer: what it found on this device, each with a one-click fix where it has one. */
export function FixerCard({ report }: { report: FixerReport }) {
  return (
    <div className="mt-1.5 flex max-w-[560px] flex-col gap-1.5">
      {report.findings.map((f, i) => (
        <FindingRow key={i} finding={f} />
      ))}
    </div>
  );
}

function FindingRow({ finding }: { finding: Finding }) {
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const icon =
    done || finding.level === 'ok' ? (
      <CircleCheck size={15} className="text-success" />
    ) : finding.level === 'problem' ? (
      <CircleAlert size={15} className="text-danger" />
    ) : (
      <Info size={15} className="text-fg-3" />
    );
  const fix = async () => {
    if (!finding.fix) return;
    setBusy(true);
    try {
      setDone(await finding.fix.run());
    } catch {
      setDone('That didn’t work. Try once more, or restart Infimeety.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-start gap-2.5 rounded-[12px] bg-fill-1 px-3 py-2.5 shadow-[inset_0_0_0_0.5px_var(--hairline)]">
      <span className="mt-[1px] shrink-0">{icon}</span>
      <div className="min-w-0 flex-1 text-[13.5px] leading-snug">
        <div className={clsx(done && 'text-fg-3 line-through decoration-fg-3/40')}>{finding.text}</div>
        {done && <div className="mt-0.5 text-success">{done}</div>}
      </div>
      {finding.fix && !done && (
        <button
          disabled={busy}
          onClick={() => void fix()}
          className="shrink-0 rounded-full bg-accent px-3 py-1 text-[12px] font-semibold text-white transition-transform hover:brightness-110 active:scale-95 disabled:opacity-60"
        >
          {finding.fix.label}
        </button>
      )}
    </div>
  );
}
