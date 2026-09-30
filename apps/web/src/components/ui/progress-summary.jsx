/**
 * The "Logged so far" summary card Home and Goals both lead with — ONE
 * layout so the two pages read the same number the same way.
 *
 * Two rows, never a squeezed column: the headline (and its status badges,
 * which wrap to their own line when there isn't room), then the bar with the
 * "what isn't in this number" note under it at full width. A three-across
 * row starved the note to one word a line.
 *
 * Presentation only — every number and string arrives pre-computed.
 */

import { Badge } from "./badge";
import { Card } from "./card";
import { Label } from "./label";
import { PacedBar } from "./paced-bar";

/**
 * @param {object} props
 * @param {number|null} props.percent   the headline, or null when nothing is due yet
 * @param {{done:number, due:number}} [props.logged]
 * @param {Array<{status:string, tone:string, label:string, count:number, description?:string}>} [props.counts]
 * @param {string} props.note           the line under the bar
 * @param {string} [props.help]         tooltip on the headline
 * @param {string} [props.emptyBadge]   badge shown when `counts` is empty (omit for none)
 */
export function ProgressSummary({ percent, logged, counts, note, help, emptyBadge, className }) {
  const measurable = percent != null && Number.isFinite(percent);
  const due = logged?.due ?? 0;
  const done = logged?.done ?? 0;
  const badges = counts || [];
  return (
    <Card padding={20} className={className}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="min-w-0" title={help}>
            <Label>Logged so far</Label>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span
                className="text-[44px] font-extrabold leading-none tracking-[-0.04em] tabular-nums text-fg"
                aria-label={measurable ? `${percent} percent of what was due is logged` : "Nothing due yet"}
              >
                {measurable ? `${percent}%` : "—"}
              </span>
              <span className="text-[12.5px] text-muted-fg">
                {measurable && due > 0 ? `of what was due · ${done} of ${due} check-ins` : "nothing due yet"}
              </span>
            </div>
          </div>

          {badges.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {badges.map((b) => (
                <span key={b.status} title={b.description}>
                  <Badge tone={b.tone}>
                    {b.count} {b.label.toLowerCase()}
                  </Badge>
                </span>
              ))}
            </div>
          ) : emptyBadge ? (
            <Badge tone="neutral">{emptyBadge}</Badge>
          ) : null}
        </div>

        <div className="min-w-0">
          <PacedBar value={measurable ? percent : 0} expected={100} height={8} />
          <div className="mt-1.5 max-w-[70ch] text-[12px] leading-[1.45] text-muted-fg">{note}</div>
        </div>
      </div>
    </Card>
  );
}
