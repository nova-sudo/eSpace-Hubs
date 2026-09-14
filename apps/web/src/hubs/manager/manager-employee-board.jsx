"use client";

/**
 * Manager Hub — one report's goal board. Renders at
 * /[hub]/employees/:userId.
 *
 * Shows the report's goals grouped by L1 objective, each with a coarse
 * status (auto / tracking / no-data / needs-setup / delegated) and the
 * current AI achievement tier — the same verdict the dev sees on their
 * own hub. Manager-authored grading of these tiers, delegated-goal
 * verdicts, and BYO approvals land in P2–P4 (docs/manager-hub-plan.md).
 *
 * Data: GET /manager/reports/:userId/goal-health.
 */

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check } from "lucide-react";
import { Badge, Button, Label, Stat } from "@/components/ui";
import { useActiveHubStrict, useHubLink } from "@/features/hubs";
import { TIER_LABELS } from "@/features/goal-tiers";
import { readinessLabel } from "@/features/goal-widgets";
import { useReportHealth } from "./use-report-health";
import { ManagerGradeDrawer } from "./manager-grade-drawer";
import { ReviewPacketCard } from "./review-packet-card";

function initials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

function ago(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const days = Math.floor((Date.now() - t) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

const STATUS_META = {
  auto: { label: "Auto-tracked", tone: "lav" },
  tracking: { label: "Tracking", tone: "mint" },
  no_data: { label: "No data", tone: "lemon" },
  needs_setup: { label: "Needs setup", tone: "neutral" },
  delegated: { label: "Delegated", tone: "lav" },
  untrackable: { label: "Untrackable", tone: "neutral" },
  unclassified: { label: "Not classified", tone: "neutral" },
};

const TIER_TONE = {
  not_achieved: "peach",
  achieved: "neutral",
  over_achieved: "mint",
  role_model: "lav",
};

function StatusChip({ goal }) {
  const meta = STATUS_META[goal.status] ?? STATUS_META.unclassified;
  const label =
    goal.status === "delegated" && goal.delegatedJudge === "manager"
      ? "Delegated to you"
      : meta.label;
  return <Badge tone={meta.tone}>{label}</Badge>;
}

function TierChip({ tier }) {
  if (!tier) return <Badge>Ungraded</Badge>;
  const tone = TIER_TONE[tier.tier] ?? "neutral";
  return <Badge tone={tone}>{TIER_LABELS[tier.tier] ?? tier.tier}</Badge>;
}

export function ManagerEmployeeBoard({ userId }) {
  const hub = useActiveHubStrict();
  const link = useHubLink();
  const [grading, setGrading] = useState(null);
  const { loading, data, error, refresh } = useReportHealth(userId);

  const back = (
    <Link
      href={link("/employees")}
      className="mb-5 inline-flex items-center gap-1.5 text-[12.5px] font-bold text-fg"
    >
      <ArrowLeft size={14} /> Back to team
    </Link>
  );

  if (loading) {
    return (
      <main className="max-w-[1280px] mx-auto px-4 sm:px-10 pb-16 pt-7">
        {back}
        <div className="rounded-[var(--radius-xl)] bg-card p-6 text-[13px] text-muted-fg" style={{ boxShadow: "var(--shadow-card)" }}>
          Loading the board…
        </div>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="max-w-[1280px] mx-auto px-4 sm:px-10 pb-16 pt-7">
        {back}
        <div className="rounded-[var(--radius-xl)] bg-card p-6 text-[13px] text-muted-fg" style={{ boxShadow: "var(--shadow-card)" }}>
          {error === "not_found"
            ? "That teammate isn't on your team."
            : "Couldn't load this board right now. Refresh, or check back in a moment."}
        </div>
      </main>
    );
  }

  const { user, summary, groups } = data;
  const hasGoals = summary.total > 0;

  return (
    <main className="max-w-[1280px] mx-auto px-4 sm:px-10 pb-16 pt-7">
      {back}

      <div className="flex items-center gap-4">
        <span className="grid flex-none place-items-center rounded-full bg-lav text-lav-ink text-[18px] font-bold h-[52px] w-[52px]">
          {initials(user.displayName)}
        </span>
        <div>
          <h1 className="text-[26px] font-extrabold tracking-[-0.02em] leading-[1.1]">
            {user.displayName}
          </h1>
          <div className="mt-1 text-[12.5px] text-muted-fg">
            {[user.role, user.department, user.level].filter(Boolean).join(" · ")} · reports to you
          </div>
        </div>
      </div>

      {hasGoals ? (
        <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="rounded-[var(--radius-xl)] bg-card p-5" style={{ boxShadow: "var(--shadow-card)" }}>
            <Stat label="Goals" value={summary.total} />
          </div>
          <div className="rounded-[var(--radius-xl)] bg-card p-5" style={{ boxShadow: "var(--shadow-card)" }}>
            <Stat label="Graded" value={summary.graded} />
          </div>
          <div className="rounded-[var(--radius-xl)] bg-card p-5" style={{ boxShadow: "var(--shadow-card)" }}>
            <Stat label="Need setup" value={summary.needsSetup} />
          </div>
          <div className="rounded-[var(--radius-xl)] bg-card p-5" style={{ boxShadow: "var(--shadow-card)" }}>
            <Stat label="Delegated to you" value={summary.delegatedToYou} />
          </div>
        </div>
      ) : null}

      {/* The frozen evidence document this report submitted (F1) — the
          artifact you grade against, not a live recompute. */}
      <ReviewPacketCard userId={userId} />

      <div className="mt-9">
        {!hasGoals ? (
          <div className="rounded-[var(--radius-xl)] bg-card p-6 text-[13px] leading-[1.6] text-muted-fg" style={{ boxShadow: "var(--shadow-card)" }}>
            {user.displayName.split(" ")[0]} hasn't set up any goals yet. Once
            they add goals in their hub, their board shows up here.
          </div>
        ) : (
          <div className="grid gap-8">
            {groups.map((group) => (
              <section key={group.l1.id}>
                <Label>
                  {group.l1.title}
                  {group.l1.category ? ` · ${group.l1.category}` : ""}
                </Label>
                <div className="mt-3 grid gap-2">
                  {group.goals.map((goal) => {
                    const notReady =
                      goal.readiness && goal.readiness !== "ready";
                    const sub = notReady
                      ? readinessLabel(goal.readiness)
                      : goal.kindLabel;
                    const activity = ago(goal.lastActivityAt);
                    return (
                      <div
                        key={goal.id}
                        className="flex items-center gap-4 rounded-[var(--radius-xl)] bg-card px-4 py-3.5"
                        style={{ boxShadow: "var(--shadow-card)" }}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-[14.5px] font-bold">{goal.title}</div>
                          <div className="mt-1 truncate text-[12px] text-muted-fg">
                            {sub}
                            {activity ? ` · updated ${activity}` : ""}
                          </div>
                          {/* #238: the frozen headline from the report's latest
                              review packet — a real number for AUTO goals instead
                              of the bare "auto" label. Dated so it's never read as
                              live. */}
                          {goal.reading ? (
                            <div
                              className="mt-1 text-[12px] text-fg"
                              title={`From the review packet submitted ${ago(goal.readingAsOf) || "recently"}`}
                            >
                              {goal.reading}
                              <span className="text-dim-fg">
                                {" "}· as of packet {ago(goal.readingAsOf) || ""}
                              </span>
                            </div>
                          ) : null}
                          {goal.tier?.source === "manager" ? (
                            <div className="mt-1 flex items-center gap-1 text-[11px] font-bold text-mint-ink">
                              <Check size={12} /> graded by {goal.tier.gradedByName || "you"}
                            </div>
                          ) : null}
                        </div>
                        <div className="flex flex-none items-center gap-2">
                          <StatusChip goal={goal} />
                          <TierChip tier={goal.tier} />
                          <Button
                            type="button"
                            variant="soft"
                            size="sm"
                            onClick={() => setGrading(goal)}
                          >
                            {goal.tier?.source === "manager" ? "Regrade" : "Grade"}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      <p className="mt-9 text-[12.5px] leading-[1.6] text-muted-fg">
        Your grade overrides the AI tier and notifies the engineer. Judging
        delegated goals and approving Build-Your-Own trackers arrive next — see{" "}
        <span className="text-fg font-bold">docs/manager-hub-plan.md</span>.
      </p>

      <ManagerGradeDrawer
        open={!!grading}
        goal={grading}
        userId={userId}
        userName={user?.displayName}
        onClose={() => setGrading(null)}
        onSaved={() => {
          setGrading(null);
          refresh();
        }}
      />
    </main>
  );
}
