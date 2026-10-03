import { Component, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/** Shows a friendly recovery screen instead of a blank page if React crashes. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error('[WildBlocks] UI crashed', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <FatalScreen message={this.state.error.message} />;
  }
}

export function FatalScreen({ message }: { message: string }) {
  return (
    <div className="fatal">
      <div className="panel fatal-card">
        <h1 className="panel-title">🍂 Something went wrong</h1>
        <p>The wilds hit a snag. Your world was autosaved recently, so reloading should get you back in.</p>
        <pre className="fatal-msg">{message}</pre>
        <p className="muted">WildBlocks needs a browser with WebGL 2 (recent Chrome, Edge, Firefox or Safari).</p>
        <button className="btn primary" onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    </div>
  );
}
