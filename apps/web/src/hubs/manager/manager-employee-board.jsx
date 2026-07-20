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
import { MonoLabel } from "@/components/ui";
import { useActiveHubStrict, useHubLink } from "@/features/hubs";
import { TIER_LABELS } from "@/features/goal-tiers";
import { readinessLabel } from "@/features/goal-widgets";
import { useReportHealth } from "./use-report-health";
import { ManagerGradeDrawer } from "./manager-grade-drawer";

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

const TONE = {
  accent: "var(--accent)",
  good: "var(--good)",
  bad: "var(--bad)",
  warn: "var(--warn)",
  muted: "var(--muted-fg)",
};

function Chip({ children, tone = "muted", solid = false }) {
  const c = TONE[tone] ?? TONE.muted;
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-1"
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
        color: solid ? "var(--accent-on)" : c,
        background: solid ? "var(--accent)" : `color-mix(in srgb, ${c} 13%, transparent)`,
      }}
    >
      {children}
    </span>
  );
}

const STATUS_META = {
  auto: { label: "Auto-tracked", tone: "accent" },
  tracking: { label: "Tracking", tone: "good" },
  no_data: { label: "No data", tone: "warn" },
  needs_setup: { label: "Needs setup", tone: "muted" },
  delegated: { label: "Delegated", tone: "accent" },
  untrackable: { label: "Untrackable", tone: "muted" },
  unclassified: { label: "Not classified", tone: "muted" },
};

const TIER_TONE = {
  not_achieved: "bad",
  achieved: "muted",
  over_achieved: "good",
  role_model: "accent",
};

function StatusChip({ goal }) {
  const meta = STATUS_META[goal.status] ?? STATUS_META.unclassified;
  const label =
    goal.status === "delegated" && goal.delegatedJudge === "manager"
      ? "Delegated to you"
      : meta.label;
  return <Chip tone={meta.tone}>{label}</Chip>;
}

function TierChip({ tier }) {
  if (!tier) return <Chip tone="muted">Ungraded</Chip>;
  const tone = TIER_TONE[tier.tier] ?? "muted";
  return (
    <Chip tone={tone} solid={tier.tier === "role_model"}>
      {TIER_LABELS[tier.tier] ?? tier.tier}
    </Chip>
  );
}

function SummaryStat({ label, value, tone }) {
  return (
    <div className="rounded-md border border-border bg-card px-4 py-3">
      <div
        style={{
          fontFamily: "var(--font-dot)",
          fontWeight: 900,
          fontSize: 26,
          letterSpacing: "0.5px",
          lineHeight: 1,
          color: tone ? TONE[tone] : "var(--fg)",
        }}
      >
        {value}
      </div>
      <div
        className="mt-1.5 uppercase text-muted-fg"
        style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.06em" }}
      >
        {label}
      </div>
    </div>
  );
}

export function ManagerEmployeeBoard({ userId }) {
  const hub = useActiveHubStrict();
  const link = useHubLink();
  const [grading, setGrading] = useState(null);
  const { loading, data, error, refresh } = useReportHealth(userId);

  const back = (
    <Link
      href={link("/employees")}
      className="mb-5 inline-flex items-center gap-1.5 text-muted-fg hover:text-accent"
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        fontWeight: 600,
      }}
    >
      ← Back to team
    </Link>
  );

  if (loading) {
    return (
      <main className="relative z-[2] mx-auto max-w-4xl px-10 pb-14 pt-9">
        {back}
        <div className="rounded-md border border-dashed border-border bg-card p-6 text-[13px] text-muted-fg">
          Loading the board…
        </div>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="relative z-[2] mx-auto max-w-4xl px-10 pb-14 pt-9">
        {back}
        <div className="rounded-md border border-dashed border-border bg-card p-6 text-[13px] text-muted-fg">
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
    <main className="relative z-[2] mx-auto max-w-4xl px-10 pb-16 pt-9">
      {back}

      <div className="flex items-center gap-4">
        <span
          className="grid flex-none place-items-center rounded-full text-accent-on"
          style={{
            width: 52,
            height: 52,
            background: "linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 70%, #000))",
            fontFamily: "var(--font-mono)",
            fontWeight: 700,
            fontSize: 18,
          }}
        >
          {initials(user.displayName)}
        </span>
        <div>
          <h1
            className="font-semibold"
            style={{ fontFamily: "var(--font-display)", fontSize: 26, letterSpacing: "-0.5px" }}
          >
            {user.displayName}
          </h1>
          <div
            className="mt-1 text-muted-fg"
            style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, letterSpacing: "0.03em" }}
          >
            {[user.role, user.department, user.level].filter(Boolean).join(" · ")} · reports to you
          </div>
        </div>
      </div>

      {hasGoals ? (
        <div className="mt-6 grid grid-cols-4 gap-3">
          <SummaryStat label="Goals" value={summary.total} />
          <SummaryStat label="Graded" value={summary.graded} tone="good" />
          <SummaryStat label="Need setup" value={summary.needsSetup} tone={summary.needsSetup ? "warn" : null} />
          <SummaryStat label="Delegated to you" value={summary.delegatedToYou} tone={summary.delegatedToYou ? "accent" : null} />
        </div>
      ) : null}

      <div className="mt-9">
        {!hasGoals ? (
          <div className="rounded-md border border-dashed border-border bg-card p-6 text-[13px] leading-[1.6] text-muted-fg">
            {user.displayName.split(" ")[0]} hasn't set up any goals yet. Once
            they add goals in their hub, their board shows up here.
          </div>
        ) : (
          <div className="grid gap-8">
            {groups.map((group) => (
              <section key={group.l1.id}>
                <MonoLabel>
                  {group.l1.title}
                  {group.l1.category ? ` · ${group.l1.category}` : ""}
                </MonoLabel>
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
                        className="flex items-center gap-4 rounded-md border border-border bg-card px-4 py-3"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-[14px] font-semibold">
                            {goal.title}
                          </div>
                          <div
                            className="mt-1 truncate text-muted-fg"
                            style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
                          >
                            {sub}
                            {activity ? ` · updated ${activity}` : ""}
                          </div>
                          {goal.tier?.source === "manager" ? (
                            <div
                              className="mt-1 text-accent"
                              style={{
                                fontFamily: "var(--font-mono)",
                                fontSize: 10,
                                letterSpacing: "0.04em",
                              }}
                            >
                              ✓ graded by {goal.tier.gradedByName || "you"}
                            </div>
                          ) : null}
                        </div>
                        <div className="flex flex-none items-center gap-2">
                          <StatusChip goal={goal} />
                          <TierChip tier={goal.tier} />
                          <button
                            type="button"
                            onClick={() => setGrading(goal)}
                            className="rounded-md border border-dashed px-2.5 py-1 text-accent transition-colors hover:bg-accent-dim/50"
                            style={{
                              borderColor:
                                "color-mix(in srgb, var(--accent) 45%, var(--border-strong))",
                              fontFamily: "var(--font-mono)",
                              fontSize: 10.5,
                              fontWeight: 700,
                              letterSpacing: "0.04em",
                              textTransform: "uppercase",
                            }}
                          >
                            {goal.tier?.source === "manager" ? "Regrade" : "Grade"}
                          </button>
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
        <span className="text-fg">docs/manager-hub-plan.md</span>.
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
