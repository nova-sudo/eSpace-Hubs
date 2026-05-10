"use client";

import { WidgetShell } from "../widget-shell";
import { useDataSource } from "../data-sources/use-data-source";

/**
 * Ticket-cycle-time widget — BARE version.
 *
 * A full implementation needs per-ticket Jira changelog reads to compute
 * status-transition durations (To Do → In Progress → Done). The Jira client
 * doesn't expose that yet, so this widget currently surfaces a high-level
 * ticket-status breakdown and a "coming soon" note.
 *
 * Explicit stub (rather than silently skipping the kind) so classifier
 * specs can still point at this widget; users see progress rather than
 * a missing widget error.
 */
export function TicketCycleWidget({ spec, goal, variant = "light", className, onRetry }) {
  const { data, isLoading, error } = useDataSource(spec.source);
  const tickets = data?.tickets || [];
  const byStatus = bucketByStatus(tickets);

  return (
    <WidgetShell
      spec={spec}
      variant={variant}
      label="Ticket cycle · (preview)"
      title={goal?.title || spec.title}
      onRetry={onRetry}
      className={className}
    >
      <div className="flex h-full flex-col justify-between gap-2">
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: variant === "light" ? "rgba(255,255,255,0.72)" : "var(--muted-fg)",
            lineHeight: 1.5,
          }}
        >
          {error
            ? "Jira not connected — cycle time unavailable."
            : isLoading
              ? "Reading Jira…"
              : "Cycle time requires per-ticket changelog support (coming soon)."}
        </div>
        <div className="flex flex-col gap-1">
          {Object.entries(byStatus).map(([status, n]) => (
            <div
              key={status}
              className="flex items-center justify-between"
              style={{ fontFamily: "var(--font-mono)", fontSize: 10.5 }}
            >
              <span
                style={{
                  color:
                    variant === "light"
                      ? "rgba(255,255,255,0.78)"
                      : "var(--muted-fg)",
                }}
              >
                {status}
              </span>
              <span className="font-semibold">{n}</span>
            </div>
          ))}
        </div>
      </div>
    </WidgetShell>
  );
}

function bucketByStatus(tickets) {
  const out = {};
  for (const t of tickets) {
    const status = t?.fields?.status?.name || "Unknown";
    out[status] = (out[status] || 0) + 1;
  }
  return out;
}
