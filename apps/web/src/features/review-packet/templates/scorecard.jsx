"use client";

// Stub — replaced by the full scorecard template.
import { Badge, Card } from "@/components/ui";
import { TIER_LABELS, tierTone } from "@/features/goal-tiers";

export function Scorecard({ payload, mode = "page" }) {
  const objectives = payload?.objectives ?? [];
  return (
    <div className="flex flex-col gap-3" data-mode={mode}>
      {objectives.map((o) => (
        <Card key={o.id} className="flex flex-col gap-2 p-5">
          <h2 className="text-[15px] font-bold text-fg">{o.title}</h2>
          {(o.goals ?? []).map((g) => (
            <div key={g.id} className="flex items-center justify-between gap-3 text-[13px] text-fg">
              <span>{g.title}</span>
              {g.verdict?.tier ? <Badge tone={tierTone(g.verdict.tier)}>{TIER_LABELS[g.verdict.tier] ?? g.verdict.tier}</Badge> : null}
            </div>
          ))}
        </Card>
      ))}
    </div>
  );
}
