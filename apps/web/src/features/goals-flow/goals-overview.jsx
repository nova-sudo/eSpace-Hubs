"use client";

/**
 * The always-on top of the Goals page: one summary row, then one tile per
 * objective.
 *
 * The summary row states the one headline — "Logged so far": of what was
 * due, how much is logged — and names the goals that aren't in it.
 *
 * Each tile's ring thickness carries that objective's weightage, so a 40%
 * objective reads as heavier without a second number competing with the
 * percentage inside the ring. The badge is the objective's WEAKEST child;
 * the ring is the AVERAGE of its children. Clicking a tile's header filters
 * the view below to that objective (again clears it); clicking a goal name
 * on the tile opens that goal.
 */

import { Badge, Card, ProgressRing, ProgressSummary } from "@/components/ui";
import { unmeasuredLine } from "@/features/goal-inputs";
import { cn } from "@/lib/cn";
import { tierDotColor } from "./goal-status";
import { ASSIGNED_ROOT_ID } from "@espace-devhub/shared/goal-specs";
import { AssignedBadge } from "@/features/assigned-goals";

const HEADLINE_HELP =
  "Of the check-ins that were due so far, how many you logged (or marked as nothing to report), weighted by each objective's share. Weeks before a tracker existed and weeks still to come never count. On pace means everything due is logged. Your grade is separate, on each goal's achievement levels.";

/**
 * The headline — "Logged so far", the SAME number Home leads with (both read
 * goal-inputs `loggedPercent`), plus the line naming what isn't in it.
 */
export function GoalsSummary({ weighted, logged, unmeasured = 0, counts }) {
  // The Home layout (components/ui ProgressSummary): headline + badges, then
  // the bar with its note at full width — both pages read the same.
  return (
    <ProgressSummary
      percent={weighted}
      logged={logged}
      counts={counts}
      note={unmeasuredLine(unmeasured) ?? "Every goal with a tracker is in this number."}
      help={HEADLINE_HELP}
      emptyBadge="No goals yet"
    />
  );
}

export function ObjectiveTiles({
  rows,
  selectedId,
  onSelect,
  onSelectGoal,
  selectedGoalId,
  collapsedIds,
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {rows.map((row) => {
        const selected = selectedId === row.l1.id;
        const collapsed = collapsedIds.has(row.l1.id);
        // Assigned (shared) goals weigh nothing in the owner's cycle — show no weight.
        const shared = row.l1.id === ASSIGNED_ROOT_ID;
        const weight = shared ? null : row.l1.weightage;
        const title = row.l1.title || "(untitled)";
        const pct = row.rollup.pct;
        const pctWord = pct == null ? "nothing due yet" : `${pct} percent logged`;
        return (
          // The tile is a card holding TWO kinds of control: the header
          // filters to the objective (pressed while active), and each goal
          // name opens THAT goal. One big button used to swallow both, so
          // clicking the third goal opened the first.
          <Card
            key={row.l1.id}
            padding={20}
            className={cn(
              "flex h-full flex-col gap-3.5 transition-shadow",
              selected ? "ring-2 ring-ink" : "",
            )}
          >
            <button
              type="button"
              onClick={() => onSelect(row.l1.id)}
              aria-pressed={selected}
              className="flex flex-col gap-3.5 rounded-[var(--radius-lg)] text-left"
            >
              <div className="flex w-full items-start justify-between gap-2.5">
                <ProgressRing
                  value={pct ?? 0}
                  weight={weight}
                  size={52}
                  label={
                    weight != null
                      ? `${title}: ${pctWord}, weight ${weight} percent`
                      : `${title}: ${pctWord}`
                  }
                >
                  {pct ?? "—"}
                </ProgressRing>
                <span className="flex flex-col items-end gap-1">
                  <Badge tone={row.rollup.tone}>{row.rollup.label}</Badge>
                  {shared ? <AssignedBadge names={row.l2s.map((x) => x.goal?.assigned?.byName)} /> : null}
                </span>
              </div>

              <span
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
              </span>
            </button>

            <div className="mt-auto flex flex-col gap-0.5 border-t border-line pt-2.5">
              {collapsed ? (
                <span className="text-[11.5px] font-semibold text-muted-fg">
                  {row.l2s.length} goal{row.l2s.length === 1 ? "" : "s"} hidden
                </span>
              ) : row.l2s.length === 0 ? (
                <span className="text-[11.5px] text-muted-fg">No goals under this objective</span>
              ) : (
                row.l2s.map((it) => {
                  const current = selectedGoalId === it.goal.id;
                  const name = it.goal.title || it.spec?.title || "(untitled)";
                  return (
                    <button
                      key={it.goal.id}
                      type="button"
                      onClick={() => onSelectGoal?.(row.l1.id, it.goal.id)}
                      aria-current={current ? "true" : undefined}
                      title={`Open ${name}`}
                      className={cn(
                        "-mx-1.5 flex min-h-6 items-center gap-2 rounded-[var(--radius-md)] px-1.5 text-left hover:bg-card-alt",
                        current ? "bg-card-alt" : "",
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: tierDotColor(it.status.tier) }}
                      />
                      <span
                        className={cn(
                          "min-w-0 flex-1 truncate text-[11.5px]",
                          current ? "font-bold text-fg" : "text-muted-fg",
                        )}
                      >
                        {name}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
