"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Badge, BentoTile, TileState } from "@/components/ui";
import { useGoals } from "@/features/goals";
import { useGoalSpecs } from "@/features/goal-specs";
import { GoalTierBadge, GoalTierLadder } from "@/features/goal-tiers";
import { useHubLink } from "@/features/hubs";

/**
 * Renders the user's L1 / L2 goal tree (entered manually via the Onboarding
 * tab in Settings). Each L1 is a column; its L2 children stack underneath.
 *
 * If the user hasn't added any goals yet, we point them at the Onboarding
 * tab where the tree editor lives.
 */
export function GoalsTile() {
  const { goals, total, weights, fetched } = useGoals();
  const { getSpec } = useGoalSpecs();
  const link = useHubLink();

  // Still hydrating → show a loader, never the "Map your goals" empty
  // state (that flashed on every first paint before the fetch settled).
  if (!fetched) {
    return (
      <BentoTile
        col="span 12"
        row="span 4"
        label="Performance goals"
        title="Your performance goals"
        titleSize={18}
      >
        <TileState kind="loading" message="Loading goals…" />
      </BentoTile>
    );
  }

  if (total.l1s === 0) {
    return (
      <BentoTile
        col="span 12"
        row="span 4"
        label="Performance goals"
        title="Map your L1 / L2 goals"
        titleSize={18}
      >
        <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
          <div className="max-w-md text-[13px] text-muted-fg">
            Paste your L1 / L2 tree into the Onboarding tab once — we&apos;ll
            render them here at a glance.
          </div>
          <Link
            href={link("/settings")}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] bg-ink px-3.5 py-1.5 text-[12px] font-bold text-ink-on hover:opacity-90"
          >
            Add goals
            <ArrowUpRight size={13} />
          </Link>
        </div>
      </BentoTile>
    );
  }

  return (
    <BentoTile
      col="span 12"
      row="span 4"
      label={`Performance goals · ${total.l1s} L1 · ${total.l2s} L2 · Σ ${weights.total}%`}
      title="Your performance goals"
      titleSize={18}
      right={
        <Link
          href={link("/settings")}
          className="inline-flex items-center gap-1 text-[12px] font-bold text-fg"
        >
          Edit
          <ArrowUpRight size={12} />
        </Link>
      }
    >
      <div className="grid h-full auto-cols-fr grid-flow-col gap-3 overflow-x-auto overflow-y-hidden pr-1">
        {goals.l1s.map((l1, i) => (
          <L1Column key={l1.id} l1={l1} index={i} getSpec={getSpec} />
        ))}
      </div>
    </BentoTile>
  );
}

function L1Column({ l1, index, getSpec }) {
  // L2 weightage sum — shown on the L1 column so the user sees at a glance
  // whether their L2 weights roll up correctly (should typically sum to
  // 100% within an L1, mirroring Zoho's KRA weightage semantics).
  const l2Weight = l1.l2s.reduce(
    (s, l2) => s + (Number(l2.weightage) || 0),
    0,
  );

  return (
    <div className="flex min-h-0 min-w-[18rem] flex-col rounded-[var(--radius-lg)] bg-card-alt p-3">
      <header className="mb-2 flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Badge tone="neutral">L1 · {String(index + 1).padStart(2, "0")}</Badge>
          {l1.weightage > 0 ? <Badge tone="lav">{l1.weightage}%</Badge> : null}
          {l1.category ? <Badge tone="neutral">{l1.category}</Badge> : null}
        </div>
        <span className="text-[11px] text-dim-fg">{l1.l2s.length} L2</span>
      </header>
      <div
        className="mb-1 line-clamp-2 text-[12.5px] font-medium leading-[1.35]"
        title={l1.title}
      >
        {l1.title || "(no title)"}
      </div>
      {l1.description ? (
        <div
          className="mb-2 line-clamp-2 text-[11px] leading-[1.35] text-dim-fg"
          title={l1.description}
        >
          {l1.description}
        </div>
      ) : null}
      {l1.l2s.length > 0 ? (
        <>
          <div className="mb-2 text-[11px] text-dim-fg">Σ {l2Weight}% mapped</div>
          <ul className="flex-1 space-y-1 overflow-y-auto pr-0.5">
            {l1.l2s.slice(0, 6).map((l2) => (
              <L2Row key={l2.id} l2={l2} getSpec={getSpec} />
            ))}
            {l1.l2s.length > 6 ? (
              <li className="py-1 text-[11px] text-dim-fg">
                + {l1.l2s.length - 6} more…
              </li>
            ) : null}
          </ul>
        </>
      ) : (
        <div className="flex flex-1 items-center text-[11.5px] text-dim-fg">
          No L2s mapped yet.
        </div>
      )}
    </div>
  );
}

/** Priority → Badge tone. High reads danger (peach), medium reads pending
 *  (lemon); low stays neutral — L2 priority isn't a success state, so
 *  "mint" is never used here. */
const PRIORITY_TONE = {
  high: "peach",
  medium: "lemon",
  low: "neutral",
};

function L2Row({ l2, getSpec }) {
  const spec = getSpec?.(l2.id);
  const hasTiers = !!spec?.tiers;
  const [expanded, setExpanded] = useState(false);

  return (
    <li className="rounded-[var(--radius-lg)] bg-card px-2.5 py-1.5">
      <button
        type="button"
        onClick={() => hasTiers && setExpanded((v) => !v)}
        className={`grid w-full grid-cols-[1fr_auto] items-start gap-2 text-left ${hasTiers ? "cursor-pointer" : "cursor-default"}`}
        title={l2.description || l2.title || ""}
      >
        <div className="min-w-0">
          <div className="line-clamp-1 text-[11.5px]">
            {l2.title || "(untitled)"}
          </div>
          <L2MetaLine l2={l2} />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {/* AI achievement tier — only renders once the goal's been
              re-analyzed with the four tiers (else nothing). Click the row
              to expand the full ladder below (whole-goal verdict, pooled
              across every submitted period). */}
          <GoalTierBadge goalId={l2.id} spec={spec} />
          {Number(l2.weightage) > 0 ? <Badge tone="lav">{l2.weightage}%</Badge> : null}
          {l2.priority ? (
            <Badge tone={PRIORITY_TONE[l2.priority] || "neutral"}>{l2.priority}</Badge>
          ) : null}
        </div>
      </button>
      {expanded && hasTiers ? <GoalTierLadder spec={spec} variant="dark" /> : null}
    </li>
  );
}

function L2MetaLine({ l2 }) {
  const parts = [];
  if (l2.category) parts.push(l2.category);
  if (l2.dueDate) parts.push(`due ${fmtDate(l2.dueDate)}`);
  if (parts.length === 0) return null;
  return <div className="mt-0.5 text-[11px] text-dim-fg">{parts.join(" · ")}</div>;
}

function fmtDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}
