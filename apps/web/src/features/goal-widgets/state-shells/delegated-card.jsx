"use client";

/**
 * Renders in place of a widget when `spec.delegated.delegated === true`.
 *
 * The point: calm, no-demand card that tells the user "this goal is judged
 * by X, you don't self-track it". Keeps the grid uniform; the user can
 * untoggle delegation via the footer action and get the tracker back.
 */

import { WidgetShell } from "../widget-shell";

const JUDGE_LABEL = {
  manager: "Your manager",
  senior: "A senior engineer",
  peer: "A peer reviewer",
};

export function DelegatedCard({ spec, goal, variant = "light", className, onRetry, onUnsetDelegation }) {
  const judge = spec?.delegated?.judge;
  const note = spec?.delegated?.note;
  const who = JUDGE_LABEL[judge] || "Someone on your team";

  return (
    <WidgetShell
      spec={spec}
      variant={variant}
      label="Delegated"
      title={goal?.title || spec.title}
      onRetry={onRetry}
      className={className}
      footer={
        onUnsetDelegation ? (
          <button
            type="button"
            onClick={onUnsetDelegation}
            className="uppercase transition-colors hover:opacity-90"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9.5,
              letterSpacing: "0.5px",
              color: variant === "light" ? "rgba(255,255,255,0.68)" : "var(--muted-fg)",
            }}
          >
            self-track
          </button>
        ) : null
      }
    >
      <div
        className="flex h-full flex-col justify-between gap-2"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          lineHeight: 1.5,
          color: variant === "light" ? "rgba(255,255,255,0.82)" : "var(--muted-fg)",
        }}
      >
        <div>
          <span style={{ color: variant === "light" ? "#ffffff" : "var(--fg)", fontWeight: 600 }}>
            {who}
          </span>{" "}
          evaluates this goal — no self-tracking required.
        </div>
        {note ? (
          <div
            className="italic"
            style={{
              color: variant === "light" ? "rgba(255,255,255,0.62)" : "var(--muted-fg)",
              fontSize: 10.5,
            }}
          >
            {note}
          </div>
        ) : null}
      </div>
    </WidgetShell>
  );
}
