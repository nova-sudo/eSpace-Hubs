"use client";

import { Component } from "react";

/**
 * Isolates widget render failures so one bad spec doesn't nuke the whole
 * grid. Class component because error boundaries still can't be written
 * with hooks (as of React 19). Kept minimal on purpose.
 *
 * Falls back to a compact "widget error" chip with an optional re-analyze
 * callback the parent can wire up.
 */
export class WidgetErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Soft-log in dev so we don't silently swallow bugs.
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.error("GoalWidget crashed:", error, info?.componentStack);
    }
  }

  reset = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        className="flex flex-col gap-1 rounded-[var(--radius-tile)] border p-3"
        style={{
          background: "rgba(255,255,255,0.06)",
          borderColor: "rgba(255,255,255,0.18)",
          color: "rgba(255,255,255,0.88)",
          minHeight: 100,
        }}
      >
        <div
          className="uppercase tracking-[0.5px]"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "rgba(255,255,255,0.65)",
          }}
        >
          Widget error
        </div>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            lineHeight: 1.35,
            color: "rgba(255,255,255,0.85)",
          }}
        >
          {String(this.state.error?.message || this.state.error).slice(0, 160)}
        </div>
        {this.props.onRetry ? (
          <button
            type="button"
            onClick={() => {
              this.reset();
              this.props.onRetry?.();
            }}
            className="mt-auto self-start rounded-[var(--radius-sub)] px-2 py-1 uppercase transition-colors hover:bg-[rgba(255,255,255,0.14)]"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              letterSpacing: "0.5px",
              color: "#fff",
              border: "1px solid rgba(255,255,255,0.25)",
            }}
          >
            Re-analyze
          </button>
        ) : null}
      </div>
    );
  }
}
