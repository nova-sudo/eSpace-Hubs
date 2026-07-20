"use client";

/**
 * Renders in place of a widget when a COMPOSED "Build Your Own" tracker
 * is awaiting (or was sent back by) manager approval — `spec.approval.status`
 * is "pending" or "rejected" (P4).
 *
 * Read-only: the tracker can't be filled or graded until the manager
 * approves. On "rejected" (changes requested) the dev can revise, which
 * re-opens the compose modal and resubmits as pending.
 */

import { WidgetShell } from "../widget-shell";

export function PendingApprovalCard({
  spec,
  goal,
  variant = "light",
  className,
  onRetry,
  onRevise,
}) {
  const rejected = spec?.approval?.status === "rejected";
  const note = spec?.approval?.note;
  const reviewer = spec?.approval?.reviewedByName;

  const strong = variant === "light" ? "#ffffff" : "var(--fg)";
  const body = variant === "light" ? "rgba(255,255,255,0.82)" : "var(--muted-fg)";
  const faint = variant === "light" ? "rgba(255,255,255,0.62)" : "var(--muted-fg)";

  return (
    <WidgetShell
      spec={spec}
      variant={variant}
      label={rejected ? "Changes requested" : "Pending approval"}
      title={goal?.title || spec.title}
      onRetry={onRetry}
      className={className}
      footer={
        rejected && onRevise ? (
          <button
            type="button"
            onClick={onRevise}
            className="uppercase transition-colors hover:opacity-90"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9.5,
              letterSpacing: "0.5px",
              color: faint,
            }}
          >
            revise &amp; resubmit
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
          color: body,
        }}
      >
        <div>
          {rejected ? (
            <>
              <span style={{ color: strong, fontWeight: 600 }}>
                {reviewer || "Your manager"}
              </span>{" "}
              asked for changes before this tracker goes live.
            </>
          ) : (
            <>
              This <span style={{ color: strong, fontWeight: 600 }}>Build-Your-Own</span>{" "}
              tracker is waiting on your manager's approval — it goes live once
              they sign off.
            </>
          )}
        </div>
        {rejected && note ? (
          <div className="italic" style={{ color: faint, fontSize: 10.5 }}>
            “{note}”
          </div>
        ) : null}
      </div>
    </WidgetShell>
  );
}
