"use client";

/**
 * The editable "Achievement levels" block on the approval pages: the
 * whole-cycle ladder beside the per-window one, four rows each. State comes
 * from `approval-ladders.js`; every edit hands back the next state through
 * `onChange`, so the page owns the drafts (keyed per tracker).
 */

import { RotateCcw } from "lucide-react";
import { Badge, Button, Label } from "@/components/ui";
import { editRow, isBlankLadder, resetLadder, TIER_ROWS } from "./approval-ladders";

export function ApprovalLaddersEditor({ item, state, onChange, cadenceLabel }) {
  const ladders = [
    ["tiers", "Whole cycle"],
    ["cadenceTiers", `Each ${cadenceLabel}`],
  ];
  return (
    <div>
      <Label className="block">Achievement levels</Label>
      {item.tiers ? null : (
        <p className="mt-1 text-[12.5px] text-muted-fg">
          No levels yet — write them here before approving.
        </p>
      )}
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        {ladders.map(([ladder, title]) => {
          const draft = state[ladder];
          const suggested = !draft.touched && state.source === "ai" && item[ladder];
          return (
            <div key={ladder} className="min-w-0 rounded-[var(--radius-lg)] bg-card-alt p-3.5">
              <div className="mb-2.5 flex min-h-7 flex-wrap items-center gap-2">
                <Label>{title}</Label>
                {suggested ? <Badge tone="sky">Suggested by AI</Badge> : null}
                {draft.touched ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="ml-auto"
                    onClick={() => onChange(resetLadder(state, ladder, item))}
                  >
                    <RotateCcw size={13} />
                    {item.tiersSource === "user" ? "Reset" : "Reset to AI"}
                  </Button>
                ) : null}
              </div>
              <div className="grid gap-2">
                {TIER_ROWS.map(([field, label, tone]) => (
                  <label key={field} className="block">
                    <Badge tone={tone}>{label}</Badge>
                    <textarea
                      value={draft.rows[field]}
                      onChange={(e) => onChange(editRow(state, ladder, field, e.target.value))}
                      rows={2}
                      maxLength={600}
                      placeholder={`What ${label.toLowerCase()} looks like`}
                      className="mt-1.5 w-full resize-y rounded-[var(--radius-md)] border border-field-line bg-card px-3 py-2 text-[12.5px] leading-snug text-fg outline-none focus:ring-2 focus:ring-ink"
                    />
                  </label>
                ))}
              </div>
              {draft.touched && isBlankLadder(draft) ? (
                <p className="mt-2 text-[12.5px] text-muted-fg">
                  Blank — the suggested levels will be kept.
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
