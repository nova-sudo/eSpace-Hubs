"use client";

/**
 * The always-on top of the Goals page: one summary row, then one tile per
 * objective.
 *
 * The summary row is the only place the whole cycle is stated as a single
 * number, and it never appears without the pacing tick beneath it — 40% is
 * triumphant in February and a disaster in November, and the tick is what
 * makes the difference visible (`<PacedBar>` draws it from
 * `yearElapsedPercent()`).
 *
 * Each tile's ring thickness carries that objective's weightage, so a 40%
 * objective reads as heavier without a second number competing with the
 * percentage inside the ring. The badge is the objective's WEAKEST child;
 * the ring is the AVERAGE of its children. Clicking a tile filters the view
 * below to that objective; clicking it again clears the filter.
 */

import { Badge, Card, Label, PacedBar, ProgressRing, yearElapsedPercent } from "@/components/ui";
import { cn } from "@/lib/cn";
import { tierDotColor } from "./goal-status";
import { ASSIGNED_ROOT_ID } from "@espace-devhub/shared/goal-specs";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function GoalsSummary({ weighted, counts }) {
  const expected = Math.round(yearElapsedPercent());
  const month = MONTHS[new Date().getUTCMonth()];
  return (
    <Card padding={20} className="flex flex-wrap items-center gap-x-8 gap-y-4">
      <div className="min-w-[160px]">
        <Label caps>Weighted progress</Label>
        <div className="mt-1.5 flex items-baseline gap-2.5">
          <span className="text-[44px] font-extrabold leading-none tracking-[-0.04em] tabular-nums text-fg">
            {weighted}%
          </span>
          <span className="text-[12px] font-semibold text-muted-fg">
            expected {expected}%
          </span>
        </div>
      </div>

      <div className="min-w-[220px] flex-1">
        <PacedBar value={weighted} height={8} />
        <div className="mt-1.5 flex items-baseline justify-between text-[11px] text-dim-fg">
          <span>Jan</span>
          <span className="font-bold text-fg">{month}</span>
          <span>Dec</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {counts.length === 0 ? (
          <Badge tone="neutral">No goals yet</Badge>
        ) : (
          counts.map((c) => (
            <Badge key={c.status} tone={c.tone}>
              {c.count} {c.label.toLowerCase()}
            </Badge>
          ))
        )}
      </div>
    </Card>
  );
}

export function ObjectiveTiles({ rows, selectedId, onSelect, collapsedIds }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {rows.map((row) => {
        const selected = selectedId === row.l1.id;
        const collapsed = collapsedIds.has(row.l1.id);
        // Shared goals weigh nothing in the owner's cycle — show no weight.
        const shared = row.l1.id === ASSIGNED_ROOT_ID;
        const weight = shared ? null : row.l1.weightage;
        const title = row.l1.title || "(untitled)";
        return (
          <button
            key={row.l1.id}
            type="button"
            onClick={() => onSelect(row.l1.id)}
            aria-pressed={selected}
            className="h-full rounded-[var(--radius-xl)] text-left"
          >
            <Card
              padding={20}
              className={cn(
                "flex h-full flex-col gap-3.5 transition-shadow",
                selected ? "ring-2 ring-ink" : "",
              )}
            >
              <div className="flex items-start justify-between gap-2.5">
                <ProgressRing
                  value={row.rollup.pct}
                  weight={weight}
                  size={52}
                  label={
                    weight != null
                      ? `${title}: ${row.rollup.pct} percent, ${weight} percent of the cycle`
                      : `${title}: ${row.rollup.pct} percent`
                  }
                >
                  {row.rollup.pct}
                </ProgressRing>
                <span className="flex flex-col items-end gap-1">
                  <Badge tone={row.rollup.tone}>{row.rollup.label}</Badge>
                  {shared ? <Badge tone="sky">Shared</Badge> : null}
                </span>
              </div>

              <div
                className="text-[13.5px] font-bold leading-[1.35] tracking-[-0.01em] text-fg"
                style={{
                  display: "-webkit-box",
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
                title={title}
              >
                {title}
              </div>

              <div className="mt-auto flex flex-col gap-1.5 border-t border-line pt-3">
                {collapsed ? (
                  <span className="text-[11.5px] font-semibold text-dim-fg">
                    {row.l2s.length} goal{row.l2s.length === 1 ? "" : "s"} hidden
                  </span>
                ) : row.l2s.length === 0 ? (
                  <span className="text-[11.5px] text-dim-fg">No goals under this objective</span>
                ) : (
                  row.l2s.map((it) => (
                    <span key={it.goal.id} className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: tierDotColor(it.status.tier) }}
                      />
                      <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted-fg">
                        {it.spec?.title || it.goal.title || "(untitled)"}
                      </span>
                    </span>
                  ))
                )}
              </div>
            </Card>
          </button>
        );
      })}
    </div>
  );
}
