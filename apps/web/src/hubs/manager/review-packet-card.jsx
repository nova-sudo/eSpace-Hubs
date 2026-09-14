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
import { Download } from "lucide-react";
import { Button, Label } from "@/components/ui";
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
      <Label>Review packet</Label>
      {!latest ? (
        <div className="mt-3 rounded-[var(--radius-xl)] bg-card p-4 text-[12.5px] text-muted-fg" style={{ boxShadow: "var(--shadow-card)" }}>
          Nothing submitted yet — when they compile their evidence and hit
          &ldquo;Submit for review&rdquo;, the frozen document lands here.
        </div>
      ) : (
        <div className="mt-3 rounded-[var(--radius-xl)] bg-card p-5" style={{ boxShadow: "var(--shadow-card)" }}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-[15px] font-bold text-fg">
              Submitted {fmtWhen(latest.submittedAt)}
            </span>
            <span className="text-[12.5px] text-dim-fg">
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
            <ul className="mt-4 flex flex-col gap-1.5 border-t border-line pt-3">
              {latest.goals.map((g) => (
                <li key={g.goalId} className="flex items-baseline gap-2 text-[12.5px]">
                  <span className="min-w-0 flex-1 truncate text-fg" title={g.title}>
                    {g.title || "(untitled)"}
                    {g.l1Title ? (
                      <span className="ml-1.5 text-[11px] text-dim-fg">· {g.l1Title}</span>
                    ) : null}
                  </span>
                  {g.reading ? (
                    <span className="shrink-0 text-[11px] text-muted-fg">{g.reading}</span>
                  ) : null}
                  <span
                    className={`shrink-0 text-[11px] font-bold ${g.tier ? "text-fg" : "text-dim-fg"}`}
                  >
                    {g.tier ? TIER_LABELS[g.tier] ?? g.tier : "ungraded"}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          {latest.markdown ? (
            <details className="mt-4 border-t border-line pt-3">
              <summary className="cursor-pointer text-[12.5px] font-bold text-fg">
                View the frozen document
              </summary>
              {/* #238: managers couldn't export a report's packet — HR wants
                  the file, not a scroll box. Plain blob download; the
                  markdown is already the frozen document. */}
              <Button
                type="button"
                variant="soft"
                size="sm"
                className="mt-2"
                onClick={() => {
                  const blob = new Blob([latest.markdown], { type: "text/markdown;charset=utf-8" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `review-packet-${(latest.submittedAt || "").slice(0, 10) || "latest"}.md`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                <Download size={13} /> Download .md
              </Button>
              <pre className="mt-3 max-h-[420px] overflow-auto rounded-[var(--radius-lg)] bg-card-alt p-3 text-fg/85 text-[11px] leading-[1.55] whitespace-pre-wrap">
                {latest.markdown}
              </pre>
            </details>
          ) : null}

          {history.length > 0 ? (
            <div className="mt-3 text-[11px] text-dim-fg">
              {history.length} earlier version{history.length === 1 ? "" : "s"} ·
              last {fmtWhen(history[0].submittedAt)}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
