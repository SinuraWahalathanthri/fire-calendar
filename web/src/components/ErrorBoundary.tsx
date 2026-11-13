import { Component, type ReactNode } from 'react';

/** Keeps the app shell alive if one page throws; offers a reload instead of a blank screen. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error(error); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card empty-state">
        <h2>Something went wrong on this page</h2>
        <p className="muted">{this.state.error.message}</p>
        <button className="btn" onClick={() => { this.setState({ error: null }); location.reload(); }}>Reload</button>
      </div>
    );
  }
}
