"use client";

/**
 * The report's submitted review packet — the frozen evidence document
 * both sides of the review argue from (F1). Shows the LATEST version's
 * narrative + per-goal tier rows and the frozen markdown behind a
 * disclosure; older versions render as a meta-only history line.
 *
 * Data: GET /manager/reports/:userId/review-packets.
 */

import { useEffect, useState } from "react";
import { MonoLabel } from "@/components/ui";
import { TIER_LABELS } from "@/features/goal-tiers";
import { apiGet } from "@/lib/api-client";

function fmtWhen(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function ReviewPacketCard({ userId }) {
  const [state, setState] = useState({ loading: true, packets: [], error: null });

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void apiGet(`/manager/reports/${encodeURIComponent(userId)}/review-packets`).then(
      (r) => {
        if (cancelled) return;
        setState({
          loading: false,
          packets: r.ok && Array.isArray(r.data?.packets) ? r.data.packets : [],
          error: r.ok ? null : r.error,
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (state.loading) return null;
  const [latest, ...history] = state.packets;

  return (
    <section className="mt-8">
      <MonoLabel>Review packet</MonoLabel>
      {!latest ? (
        <div className="mt-3 rounded-md border border-dashed border-border bg-card p-4 text-[12.5px] text-muted-fg">
          Nothing submitted yet — when they compile their evidence and hit
          &ldquo;Submit for review&rdquo;, the frozen document lands here.
        </div>
      ) : (
        <div className="mt-3 rounded-md border border-border bg-card p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span
              className="text-fg"
              style={{ fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 600 }}
            >
              Submitted {fmtWhen(latest.submittedAt)}
            </span>
            <span
              className="text-dim-fg"
              style={{ fontFamily: "var(--font-mono)", fontSize: 10.5 }}
            >
              {[latest.level, latest.rangeLabel, `${latest.goalCount} goals`,
                latest.starredCount ? `${latest.starredCount} starred proof` : null]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>

          {latest.narrative?.trim() ? (
            <p className="mt-3 text-[13px] leading-[1.6] text-fg/85">
              {latest.narrative.trim()}
            </p>
          ) : null}

          {Array.isArray(latest.goals) && latest.goals.length > 0 ? (
            <ul className="mt-4 flex flex-col gap-1.5 border-t border-dashed border-border pt-3">
              {latest.goals.map((g) => (
                <li key={g.goalId} className="flex items-baseline gap-2 text-[12.5px]">
                  <span className="min-w-0 flex-1 truncate text-fg" title={g.title}>
                    {g.title || "(untitled)"}
                    {g.l1Title ? (
                      <span className="ml-1.5 text-dim-fg" style={{ fontSize: 11 }}>
                        · {g.l1Title}
                      </span>
                    ) : null}
                  </span>
                  {g.reading ? (
                    <span
                      className="shrink-0 text-muted-fg"
                      style={{ fontFamily: "var(--font-mono)", fontSize: 10.5 }}
                    >
                      {g.reading}
                    </span>
                  ) : null}
                  <span
                    className="shrink-0 uppercase"
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 9.5,
                      fontWeight: 700,
                      color: g.tier ? "var(--accent)" : "var(--dim-fg)",
                    }}
                  >
                    {g.tier ? TIER_LABELS[g.tier] ?? g.tier : "ungraded"}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          {latest.markdown ? (
            <details className="mt-4 border-t border-dashed border-border pt-3">
              <summary
                className="cursor-pointer uppercase tracking-[0.6px] text-accent"
                style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, fontWeight: 700 }}
              >
                View the frozen document
              </summary>
              <pre
                className="mt-3 max-h-[420px] overflow-auto rounded-[var(--radius-sub)] border border-border bg-card-alt p-3 text-fg/85"
                style={{ fontFamily: "var(--font-mono)", fontSize: 11, lineHeight: 1.55, whiteSpace: "pre-wrap" }}
              >
                {latest.markdown}
              </pre>
            </details>
          ) : null}

          {history.length > 0 ? (
            <div
              className="mt-3 text-dim-fg"
              style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
            >
              {history.length} earlier version{history.length === 1 ? "" : "s"} ·
              last {fmtWhen(history[0].submittedAt)}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
