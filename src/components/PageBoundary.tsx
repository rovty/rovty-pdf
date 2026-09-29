import { Component, type ReactNode } from 'react';

// Keep navigation available if a screen or a downloaded module fails.
export default class PageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="empty-search" role="alert">
        <h1>This view couldn’t open.</h1>
        <p>
          Check your connection and reload the page. Your original document stays unchanged; unsaved
          edits may need to be repeated.
        </p>
        <button className="button" onClick={() => location.reload()}>
          Reload page
        </button>
      </div>
    );
  }
}
