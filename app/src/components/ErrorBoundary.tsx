import { Component, type ReactNode } from 'react';

/**
 * Safety net: if any screen throws while rendering, show a calm recovery card instead of
 * a blank window. Reloading keeps the session (it lives in the WebView profile).
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('[infimeety] render error', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="grid h-full place-items-center p-6">
        <div className="w-[380px] rounded-[24px] p-7 text-center glass-pop">
          <div className="emoji text-[40px]">🫧</div>
          <h1 className="mt-3 font-display text-[19px] font-semibold tracking-[-0.02em]">Something went wrong</h1>
          <p className="mt-1.5 text-[13px] leading-relaxed text-fg-2">Infimeety hit a snag drawing this screen. Reloading fixes it, and you’ll stay signed in.</p>
          <button
            onClick={() => location.reload()}
            className="mt-5 h-9 w-full rounded-[10px] bg-accent text-[13px] font-semibold text-white hover:brightness-110"
          >
            Reload Infimeety
          </button>
          <p className="selectable mt-4 truncate text-[11px] text-fg-3" title={this.state.error.message}>
            {this.state.error.message}
          </p>
        </div>
      </div>
    );
  }
}
