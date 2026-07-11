"use client";

import { Card, DitherField } from "@/components/ui";
import { useIntegrations } from "@/features/integrations";
import { formatExpected } from "./format-expected";

const STATUS_PILL_COLORS = {
  ok: { bg: "color-mix(in srgb, var(--good) 14%, transparent)", fg: "var(--good)" },
  accent: { bg: "var(--accent-dim)", fg: "var(--accent)" },
  warn: { bg: "color-mix(in srgb, var(--bad) 14%, transparent)", fg: "var(--bad)" },
  muted: { bg: "var(--card-alt)", fg: "var(--muted-fg)" },
};

export function DocumentPreview({
  format,
  range,
  level,
  narrative,
  setNarrative,
  include,
  starred,
  metrics,
  goalReadings,
  rangeLabel,
}) {
  const { me } = useIntegrations();
  const prs = starred.filter((s) => s.kind === "merged-pr");
  const tickets = starred.filter((s) => s.kind === "ticket");
  const reviews = starred.filter((s) => s.kind === "review");

  const filename = `performance-review-${range}.${format === "markdown" ? "md" : "pdf"}`;

  // Count the sections actually rendered into the preview — drives the
  // Doto "N sections" tally in the preview header.
  const sectionCount =
    (include.narrative ? 1 : 0) +
    (include.metrics && metrics ? 1 : 0) +
    (include.prs && prs.length > 0 ? 1 : 0) +
    (include.tickets && tickets.length > 0 ? 1 : 0) +
    (include.reviews && reviews.length > 0 ? 1 : 0) +
    (include.goals && goalReadings && goalReadings.length > 0 ? 1 : 0);

  return (
    <Card className="overflow-hidden p-0">
      <div
        className="flex items-center justify-between border-b border-border px-[18px] py-[11px]"
        style={{ background: "var(--panel)" }}
      >
        <span
          className="uppercase text-muted-fg"
          style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "2px" }}
        >
          Document preview · {filename}
        </span>
        <span
          className="tracking-[1px] text-accent"
          style={{ fontFamily: "var(--font-dot)", fontWeight: 700, fontSize: 12 }}
        >
          {sectionCount} section{sectionCount === 1 ? "" : "s"}
        </span>
      </div>

      <div className="relative min-h-[640px] bg-card px-12 py-10">
        <div className="pointer-events-none absolute right-5 top-5 opacity-25 text-accent">
          <DitherField
            width={100}
            height={60}
            cell={4}
            color="currentColor"
            falloff={(u) => Math.max(0, 1 - u * 1.2)}
            jitter={0.35}
            seed={17}
          />
        </div>

        <div
          className="uppercase text-fg"
          style={{
            fontFamily: "var(--font-dot)",
            fontWeight: 900,
            fontSize: 24,
            letterSpacing: "0.5px",
            lineHeight: 1.05,
          }}
        >
          {me?.name ?? "Your name"} — {me?.team ?? "—"}
        </div>
        <div
          className="mt-[5px] uppercase text-muted-fg"
          style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "1px" }}
        >
          Level {level} · {rangeLabel}
        </div>
        <div
          aria-hidden="true"
          className="my-4"
          style={{ height: 1, background: "var(--border)" }}
        />

        {include.narrative ? (
          <DocSection title="01 / Summary" rangeLabel={rangeLabel}>
            <textarea
              value={narrative}
              onChange={(e) => setNarrative(e.target.value)}
              rows={5}
              placeholder="A few sentences on what this window meant — what shipped, what shifted, what's next. Numbers come from the receipts below; this is the throughline."
              className="w-full rounded-[var(--radius-sub)] border border-dashed border-border-strong bg-card-alt p-2.5 text-fg outline-none placeholder:text-dim-fg focus:border-accent"
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: 14.5,
                lineHeight: 1.6,
                resize: "vertical",
              }}
            />
            <div
              className="mt-1 uppercase tracking-[0.4px] text-dim-fg"
              style={{ fontFamily: "var(--font-mono)", fontSize: 9.5 }}
            >
              Click to edit · your words, not ours
            </div>
          </DocSection>
        ) : null}

        {include.metrics && metrics ? (
          <DocSection title="02 / Headline metrics" rangeLabel={rangeLabel}>
            <div className="mt-1.5 grid grid-cols-4 gap-3.5">
              {metrics.map(([label, value, sub, good]) => (
                <MetricBox key={label} label={label} value={value} sub={sub} good={good} />
              ))}
            </div>
          </DocSection>
        ) : null}

        {include.prs && prs.length > 0 ? (
          <DocSection
            title={`03 / Merged pull requests · ${prs.length}`}
            rangeLabel="starred as evidence"
          >
            {prs.map((p) => (
              <EvidenceRow key={p.id} item={p} />
            ))}
          </DocSection>
        ) : null}

        {include.tickets && tickets.length > 0 ? (
          <DocSection
            title={`04 / Closed tickets · ${tickets.length}`}
            rangeLabel="starred as evidence"
          >
            {tickets.map((t) => (
              <EvidenceRow key={t.id} item={t} />
            ))}
          </DocSection>
        ) : null}

        {include.reviews && reviews.length > 0 ? (
          <DocSection
            title={`05 / Notable reviews given · ${reviews.length}`}
            rangeLabel="starred as evidence"
          >
            {reviews.map((r) => (
              <EvidenceRow key={r.id} item={r} />
            ))}
          </DocSection>
        ) : null}

        {include.goals && goalReadings && goalReadings.length > 0 ? (
          <DocSection
            title={`06 / Performance goals · ${countL1(goalReadings)} L1 · ${countL2(goalReadings)} L2`}
            rangeLabel="ai-classified · live"
          >
            <GoalReadingsBlock readings={goalReadings} />
          </DocSection>
        ) : null}

        <div
          className="mt-10 flex justify-between border-t border-border pt-4 text-dim-fg"
          style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
        >
          <span>
            Generated by eSpace/DevHub ·{" "}
            {new Date().toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </span>
          <span>Source: Jira + GitLab + GitHub</span>
        </div>
      </div>
    </Card>
  );
}

function DocSection({ title, rangeLabel, children }) {
  return (
    <div className="mb-3.5 mt-6">
      <div className="mb-[5px] flex items-baseline justify-between gap-3">
        <h3
          className="m-0 uppercase text-accent"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            letterSpacing: "1.5px",
            fontWeight: 400,
          }}
        >
          {title}
        </h3>
        <span
          className="uppercase tracking-[0.5px] text-dim-fg"
          style={{ fontFamily: "var(--font-mono)", fontSize: 9.5 }}
        >
          {rangeLabel}
        </span>
      </div>
      {children}
    </div>
  );
}

function MetricBox({ label, value, sub, good }) {
  return (
    <div>
      <div
        className="mb-1 uppercase tracking-[0.5px] text-muted-fg"
        style={{ fontFamily: "var(--font-mono)", fontSize: 9.5 }}
      >
        {label}
      </div>
      <div
        className="leading-none"
        style={{
          fontFamily: "var(--font-dot)",
          fontWeight: 900,
          fontSize: 26,
          letterSpacing: "0.5px",
        }}
      >
        {value}
      </div>
      <div
        className="mt-1"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: good ? "var(--good)" : "var(--muted-fg)",
        }}
      >
        {sub}
      </div>
    </div>
  );
}

/**
 * Renders the AI-classified goal tree with each L2's current widget
 * reading. Sorted by L1 → L2 in the original onboarding order.
 */
function GoalReadingsBlock({ readings }) {
  // Group by L1: each row is either an L1 (level === "L1") or an L2 with
  // parentL1 set. Walk in original order; emit an L1 header card every
  // time we see a new L1 group.
  const grouped = [];
  let currentGroup = null;
  for (const r of readings) {
    if (r.level === "L1") {
      currentGroup = { l1: r, items: [] };
      grouped.push(currentGroup);
    } else if (r.level === "L2") {
      // If the L2 belongs to an L1 we haven't created a header for (because
      // the L1 wasn't classified), spin up a header from the parent goal
      // alone — keeps the tree readable.
      const expectedL1Id = r.parentL1?.id;
      if (!currentGroup || currentGroup.l1.goal.id !== expectedL1Id) {
        currentGroup = {
          l1: { goal: r.parentL1, spec: null, reading: null, level: "L1" },
          items: [],
        };
        grouped.push(currentGroup);
      }
      currentGroup.items.push(r);
    }
  }

  // Expected vs Achieved table — 4 columns: Goal | Expected | Achieved | Status
  // Each L1 gets a header row spanning the goal column, then its L2s
  // appear as full data rows underneath. Reads more like a perf-review
  // grid than a bullet list.
  const cols = "minmax(0, 1.5fr) minmax(0, 1fr) minmax(0, 1.4fr) auto";
  return (
    <div className="overflow-hidden rounded-[var(--radius-sub)] border border-border">
      <div
        className="grid border-b border-border bg-card-alt px-3.5 py-2 uppercase tracking-[0.5px] text-muted-fg"
        style={{
          gridTemplateColumns: cols,
          fontFamily: "var(--font-mono)",
          fontSize: 9.5,
        }}
      >
        <span>Goal</span>
        <span>Expected</span>
        <span>Achieved</span>
        <span className="text-right">Status</span>
      </div>
      {grouped.map((g, gi) => (
        <div key={(g.l1.goal && g.l1.goal.id) || gi}>
          <div
            className="grid items-baseline gap-2 border-b border-border bg-card-alt/50 px-3.5 py-2"
            style={{
              gridTemplateColumns: cols,
              fontFamily: "var(--font-display)",
              fontSize: 13,
              letterSpacing: "-0.2px",
              fontWeight: 600,
            }}
          >
            <span className="truncate" title={g.l1.goal?.title}>
              {g.l1.goal?.title || "(untitled L1)"}
            </span>
            <span
              className="text-dim-fg"
              style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
            >
              {g.l1.goal?.weightage > 0
                ? `${g.l1.goal.weightage}% weight`
                : ""}
            </span>
            <span
              className="font-semibold tabular-nums text-fg"
              style={{ fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600 }}
            >
              {g.l1.reading?.value || ""}
            </span>
            <span className="text-right">
              {g.l1.reading ? (
                <StatusPill
                  tone={g.l1.reading.statusTone}
                  label={g.l1.reading.statusLabel}
                />
              ) : null}
            </span>
          </div>
          {g.items.length === 0 ? (
            <div
              className="px-3.5 py-2.5 text-dim-fg"
              style={{ fontFamily: "var(--font-mono)", fontSize: 10.5 }}
            >
              No L2s classified yet for this L1.
            </div>
          ) : (
            g.items.map((r, i) => {
              const expected = formatExpected(r.spec);
              return (
                <div
                  key={r.goal.id}
                  className="grid items-baseline gap-2 px-3.5 py-2.5"
                  style={{
                    gridTemplateColumns: cols,
                    borderBottom:
                      i < g.items.length - 1 || gi < grouped.length - 1
                        ? "1px dashed var(--border)"
                        : "none",
                  }}
                >
                  <span
                    className="truncate text-[12.5px]"
                    title={r.goal.title}
                  >
                    {r.goal.title || "(untitled L2)"}
                  </span>
                  <span
                    className="truncate text-muted-fg"
                    style={{ fontFamily: "var(--font-mono)", fontSize: 10.5 }}
                    title={expected}
                  >
                    {expected}
                  </span>
                  <span
                    className="font-semibold tabular-nums text-fg"
                    style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
                  >
                    {r.reading.value}
                  </span>
                  <span className="text-right">
                    <StatusPill
                      tone={r.reading.statusTone}
                      label={r.reading.statusLabel}
                    />
                  </span>
                </div>
              );
            })
          )}
        </div>
      ))}
    </div>
  );
}

function StatusPill({ tone, label }) {
  const colors = STATUS_PILL_COLORS[tone] || STATUS_PILL_COLORS.muted;
  return (
    <span
      className="shrink-0 rounded-full px-2 py-[2px] uppercase"
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: "0.4px",
        background: colors.bg,
        color: colors.fg,
      }}
    >
      {label}
    </span>
  );
}

function countL1(readings) {
  return readings.filter((r) => r.level === "L1").length;
}
function countL2(readings) {
  return readings.filter((r) => r.level === "L2").length;
}

function EvidenceRow({ item }) {
  return (
    <div className="border-b border-border border-dashed py-2.5">
      <div className="mb-0.5 flex items-baseline gap-2.5">
        <span
          className="min-w-[70px] font-bold text-accent"
          style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
        >
          {item.ref}
        </span>
        <span className="flex-1 text-[13px] font-medium">{item.title}</span>
        <span
          className="text-muted-fg"
          style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
        >
          {item.date}
        </span>
      </div>
      {item.impact ? (
        <div
          className="ml-[80px] text-[12px] leading-[1.45] text-muted-fg"
          style={{ textWrap: "pretty" }}
        >
          → {item.impact}
        </div>
      ) : null}
    </div>
  );
}
