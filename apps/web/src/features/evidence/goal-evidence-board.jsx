"use client";

/**
 * Goal evidence board — the primary Evidence surface.
 *
 * The Evidence page is goal-oriented: it shows your goals grouped by L1, each
 * with its achievement verdict and the concrete evidence you've logged
 * against it (check-in notes, per-item / per-field proof, links) over the
 * period. This is the "proof for my review" view; the compile view turns it
 * into the exportable document.
 *
 * Presentation only — groups come from buildGoalEvidenceGroups().
 */

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Badge, Card, InsightRow, StarGlyph } from "@/components/ui";
import { GoalTierBadge } from "@/features/goal-tiers";
import { useHubLink } from "@/features/hubs";

export function GoalEvidenceBoard({ groups, loading, goalsHref }) {
  const link = useHubLink();
  if (loading && (!groups || groups.length === 0)) {
    return (
      <Card className="px-4 py-10 text-center text-[13px] text-muted-fg">
        Reading your goals…
      </Card>
    );
  }
  if (!groups || groups.length === 0) {
    return (
      <Card className="px-4 py-10 text-center">
        <div className="text-[15px] font-bold text-fg">No classified goals yet</div>
        <p className="mt-1.5 text-[13px] text-muted-fg">
          Classify your goals to start collecting evidence against them.
        </p>
        <Link
          href={goalsHref || link("/goals")}
          className="mt-3 inline-block text-[13px] font-bold text-fg hover:underline"
        >
          Set up your goals
        </Link>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.map((g) => (
        <L1Card key={g.l1?.id} group={g} goalsHref={goalsHref} />
      ))}
    </div>
  );
}

function L1Card({ group, goalsHref }) {
  const total = group.goals.length;
  const evidencedCount = group.goals.filter((row) => row.evidence.length > 0).length;
  const countTone = total > 0 && evidencedCount / total >= 0.5 ? "mint" : "lemon";
  // One card-level insight: the first goal that has a grader's reasoning
  // worth surfacing (skips awaiting/pending-setup placeholder states).
  const insightRow = group.goals.find(
    (row) => row.verdict && !row.verdict.awaiting && !row.verdict.pendingSetup && row.verdict.reasoning,
  );

  return (
    <Card className="flex flex-col gap-0">
      <div className="flex items-center justify-between pb-3">
        <div className="flex items-baseline gap-2.5">
          <span className="text-[17px] font-bold tracking-[-0.01em] text-fg">
            {group.l1?.title || "Ungrouped"}
          </span>
          <span className="text-[12.5px] text-muted-fg">
            {group.l1?.weightage ? `${group.l1.weightage}% · ` : ""}
            {total} goal{total === 1 ? "" : "s"}
          </span>
        </div>
        <Badge tone={countTone}>
          {evidencedCount} of {total} evidenced
        </Badge>
      </div>

      {group.goals.map((row) => (
        <GoalRow key={row.goal.id} row={row} />
      ))}

      {insightRow ? (
        <InsightRow
          tone="lav"
          className="mt-2"
          action={{ label: "Review", href: goalsHref }}
        >
          {insightRow.verdict.reasoning}
        </InsightRow>
      ) : null}
    </Card>
  );
}

function GoalRow({ row }) {
  const { goal, spec, evidence, checkinDays } = row;
  // These are TEXT snippets — entry notes, checklist evidence strings,
  // per-field evidence on a composed widget — collected by `goal-evidence.js`.
  // They are not files and never were; the column called them "3 files" /
  // "No files", so a goal with three written references read as having three
  // uploads, and a goal with real uploads and no notes read as having none.
  const hasEvidence = evidence.length > 0;

  return (
    <div className="flex items-center gap-4 border-t border-line py-3.5">
      <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-card-alt">
        <StarGlyph on={hasEvidence} />
      </span>
      <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-fg" title={goal.title}>
        {goal.title}
      </span>
      <GoalTierBadge goalId={goal.id} spec={spec} />
      <span className="w-[90px] shrink-0 text-[12.5px] text-muted-fg">
        {checkinDays || 0} reading{checkinDays === 1 ? "" : "s"}
      </span>
      {hasEvidence ? (
        <span className="w-[72px] shrink-0 text-[12.5px] text-muted-fg">
          {evidence.length} noted
        </span>
      ) : (
        <span className="w-[72px] shrink-0 text-[12.5px] font-bold text-peach-ink">
          None noted
        </span>
      )}
      <ChevronRight size={16} className="shrink-0 text-muted-fg" aria-hidden="true" />
    </div>
  );
}
