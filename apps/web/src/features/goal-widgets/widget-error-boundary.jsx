"use client";

import { Component } from "react";
import { Button, Card } from "@/components/ui";

/**
 * Isolates widget render failures so one bad spec doesn't nuke the whole
 * grid. Class component because error boundaries still can't be written
 * with hooks (as of React 19). Kept minimal on purpose.
 *
 * Falls back to a compact "widget error" card with an optional retry
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
    // Always log, including in production: this is a browser-only console
    // message (nothing server-side captures it), so silencing it there just
    // means a real bug looks like nothing happened — the exact gap that made
    // a prior crash here show up as an untraceable "Uncaught" with no route
    // back to which component or field caused it.
    // eslint-disable-next-line no-console
    console.error("GoalWidget crashed:", error, info?.componentStack);
  }

  reset = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <Card tone="peach" className="flex flex-col gap-1.5" style={{ minHeight: 100 }}>
        <div className="text-[12px] font-semibold text-peach-ink">Widget error</div>
        <div className="text-[13px] leading-[1.4] text-peach-ink">
          {String(this.state.error?.message || this.state.error).slice(0, 160)}
        </div>
        {this.props.onRetry ? (
          <Button
            type="button"
            variant="soft"
            size="sm"
            className="mt-auto self-start"
            onClick={() => {
              this.reset();
              this.props.onRetry?.();
            }}
          >
            Re-analyze
          </Button>
        ) : null}
      </Card>
    );
  }
}
