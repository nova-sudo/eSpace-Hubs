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

export function GoalEvidenceBoard({ groups, untracked = [], loading, goalsHref, goalHref }) {
  const link = useHubLink();
  // Row target: the goal opened on the Goals page (`?goal=<id>`), unless
  // the caller supplies its own resolver.
  const hrefFor =
    typeof goalHref === "function"
      ? goalHref
      : (goalId) => link(`/goals?goal=${encodeURIComponent(goalId)}`);
  if (loading && (!groups || groups.length === 0)) {
    return (
      <Card className="px-4 py-10 text-center text-[13px] text-muted-fg">
        Reading your goals…
      </Card>
    );
  }
  if ((!groups || groups.length === 0) && untracked.length === 0) {
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
      {(groups || []).map((g) => (
        <L1Card key={g.l1?.id} group={g} goalsHref={goalsHref} hrefFor={hrefFor} />
      ))}
      {untracked.length > 0 ? (
        <UntrackedCard goals={untracked} goalsHref={goalsHref || link("/goals")} hrefFor={hrefFor} />
      ) : null}
    </div>
  );
}

/**
 * Goals with no tracker. They were simply absent from the board (and the
 * packet), so a 13-goal year read as a clean 3-goal one. Listed, never
 * scored — they aren't in any percentage.
 */
function UntrackedCard({ goals, goalsHref, hrefFor }) {
  return (
    <Card className="flex flex-col gap-0">
      <div className="flex items-center justify-between gap-3 pb-3">
        <h2 className="m-0 text-[17px] font-bold tracking-[-0.01em] text-fg">
          Not yet tracked ({goals.length})
        </h2>
        <Link href={goalsHref} className="link-target text-[13px] font-bold text-fg hover:underline">
          Set up trackers
        </Link>
      </div>
      <p className="m-0 pb-2 text-[13px] leading-[1.5] text-muted-fg">
        These goals have no tracker yet, so they aren&apos;t in any number above or in the
        packet&apos;s verdicts. They&apos;re listed in the packet so your manager sees them.
      </p>
      {goals.map((goal) => (
        <Link
          key={goal.id}
          href={hrefFor(goal.id)}
          className="flex items-center gap-4 border-t border-line py-3 hover:bg-card-alt"
        >
          <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-fg" title={goal.title}>
            {goal.title || "(untitled goal)"}
          </span>
          <Badge tone="neutral">No tracker yet</Badge>
          <ChevronRight size={16} className="shrink-0 text-muted-fg" aria-hidden="true" />
        </Link>
      ))}
    </Card>
  );
}

function L1Card({ group, goalsHref, hrefFor }) {
  const total = group.goals.length;
  const evidencedCount = group.goals.filter((row) => row.evidence.length > 0).length;
  // One card-level insight: the first goal that has a grader's reasoning
  // worth surfacing (skips awaiting/pending-setup placeholder states).
  const insightRow = group.goals.find(
    (row) => row.verdict && !row.verdict.awaiting && !row.verdict.pendingSetup && row.verdict.reasoning,
  );

  return (
    <Card className="flex flex-col gap-0">
      <div className="flex items-center justify-between pb-3">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5">
          <h2 className="m-0 text-[17px] font-bold tracking-[-0.01em] text-fg">
            {group.l1?.title || "Ungrouped"}
          </h2>
          <span className="text-[12.5px] text-muted-fg">
            {group.l1?.weightage ? `Weight ${group.l1.weightage}% · ` : ""}
            {total} goal{total === 1 ? "" : "s"} · {evidencedCount} with evidence
          </span>
        </div>
        {/* The objective's status: its weakest MEASURED goal — the same
            rule and words as Home and Goals. */}
        {group.status ? (
          <Badge tone={group.status.tone} title={group.status.description}>
            {group.status.label}
          </Badge>
        ) : null}
      </div>

      {group.goals.map((row) => (
        <GoalRow key={row.goal.id} row={row} href={hrefFor(row.goal.id)} />
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

function GoalRow({ row, href }) {
  const { goal, spec, evidence, checkinDays, status } = row;
  // These are TEXT snippets — entry notes, checklist evidence strings,
  // per-field evidence on a composed widget — collected by `goal-evidence.js`.
  // They are not files and never were; the column called them "3 files" /
  // "No files", so a goal with three written references read as having three
  // uploads, and a goal with real uploads and no notes read as having none.
  const hasEvidence = evidence.length > 0;

  // The whole row is the link — the chevron promised one for a while
  // without delivering it.
  return (
    <Link
      href={href}
      className="flex items-center gap-4 border-t border-line py-3.5 hover:bg-card-alt"
      aria-label={`Open goal: ${goal.title}`}
    >
      <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-card-alt">
        <StarGlyph on={hasEvidence} />
      </span>
      <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-fg" title={goal.title}>
        {goal.title}
      </span>
      <GoalTierBadge goalId={goal.id} spec={spec} />
      <span
        className="hidden w-[150px] shrink-0 text-[12.5px] text-muted-fg sm:block"
        title={status?.reason || status?.description}
      >
        {status ? `${status.label} · ` : ""}
        {checkinDays || 0} reading{checkinDays === 1 ? "" : "s"}
      </span>
      {hasEvidence ? (
        <span className="w-[72px] shrink-0 text-[12.5px] text-muted-fg">
          {evidence.length} noted
        </span>
      ) : (
        <Badge tone="lemon" className="shrink-0">
          No evidence yet
        </Badge>
      )}
      <ChevronRight size={16} className="shrink-0 text-muted-fg" aria-hidden="true" />
    </Link>
  );
}
