import { Component, type ErrorInfo, type ReactNode } from 'react';
import { markCrashed, recentCrashes, resetApp, restartInSafeMode, safeMode } from '@/lib/boot';
import { reportError } from '@/lib/errors';

interface Props {
  children: ReactNode;
  /**
   * A part of the app (the call, the chat, the sidebar). When it breaks, only that part shows
   * a small "Try again" card and the rest keeps working. Without one, this is the last resort
   * for the whole window.
   */
  area?: string;
  /** Going somewhere else (another room, another channel) clears the error by itself. */
  resetKey?: unknown;
  /** Floating pieces (menus, pop-ups, dialogs): just disappear when broken. */
  quiet?: boolean;
}

interface State {
  error: Error | null;
  /** resetKey when the error happened. */
  at: unknown;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, at: undefined };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (state.error && state.at !== props.resetKey) return { error: null, at: props.resetKey };
    return state.error ? null : { at: props.resetKey };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[infimeety] ${this.props.area ?? 'app'} crashed`, error);
    reportError(Object.assign(new Error(error.message), { stack: `${error.stack ?? ''}\n${info.componentStack ?? ''}` }), `render:${this.props.area ?? 'app'}`);
    if (!this.props.area && !this.props.quiet) markCrashed();
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.quiet) return null;
    if (this.props.area) return <AreaError message={error.message} onRetry={() => this.setState({ error: null })} />;
    return <AppError message={error.message} />;
  }
}

function AreaError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="grid h-full min-h-[160px] w-full place-items-center p-6">
      <div className="max-w-[320px] text-center">
        <div className="emoji text-[30px]">🫧</div>
        <h2 className="mt-2 font-display text-[15px] font-semibold tracking-[-0.015em]">This part hit a snag</h2>
        <p className="mt-1 text-[12.5px] leading-relaxed text-fg-2">Everything else still works. Try again, or open something else.</p>
        <button onClick={onRetry} className="mt-4 h-8 rounded-[9px] bg-fill-2 px-4 text-[12.5px] font-semibold shadow-[inset_0_0_0_0.5px_var(--hairline-strong)] hover:bg-fill-3">
          Try again
        </button>
        <p className="selectable mt-3 truncate text-[11px] text-fg-3" title={message}>
          {message}
        </p>
      </div>
    </div>
  );
}

/** The whole window failed. Reload usually fixes it; if it keeps happening, Safe Mode or a reset will. */
function AppError({ message }: { message: string }) {
  const again = recentCrashes > 0 || safeMode;
  return (
    <div className="grid h-full place-items-center p-6">
      <div className="w-full max-w-[380px] rounded-[24px] p-7 text-center glass-pop">
        <div className="emoji text-[40px]">🫧</div>
        <h1 className="mt-3 font-display text-[19px] font-semibold tracking-[-0.02em]">Something went wrong</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-fg-2">
          {again
            ? 'This keeps happening. Safe Mode starts Infimeety with default settings; a reset clears what this device remembers. You stay signed in either way.'
            : 'Infimeety hit a snag drawing this screen. Reloading fixes it, and you’ll stay signed in.'}
        </p>
        <button onClick={() => (again && !safeMode ? restartInSafeMode() : location.reload())} className="mt-5 h-9 w-full rounded-[10px] bg-accent text-[13px] font-semibold text-white hover:brightness-110">
          {again && !safeMode ? 'Restart in Safe Mode' : 'Reload Infimeety'}
        </button>
        {again && (
          <button onClick={resetApp} className="mt-2 h-9 w-full rounded-[10px] bg-fill-2 text-[13px] font-semibold shadow-[inset_0_0_0_0.5px_var(--hairline-strong)] hover:bg-fill-3">
            Reset Infimeety
          </button>
        )}
        <p className="selectable mt-4 truncate text-[11px] text-fg-3" title={message}>
          {message}
        </p>
      </div>
    </div>
  );
}
