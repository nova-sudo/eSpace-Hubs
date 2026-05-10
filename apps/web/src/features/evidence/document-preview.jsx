"use client";

import { Card, DitherField, MonoLabel } from "@/components/ui";
import { useIntegrations } from "@/features/integrations";

const STATUS_PILL_COLORS = {
  ok: { bg: "rgba(4,120,87,0.10)", fg: "var(--good)" },
  accent: { bg: "var(--accent-dim)", fg: "var(--accent)" },
  warn: { bg: "rgba(185,28,28,0.10)", fg: "var(--bad)" },
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

  const filename = `# performance-review-${range}.${format === "markdown" ? "md" : "pdf"}`;

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center justify-between border-b border-border bg-card-alt px-5 py-2.5">
        <div className="flex items-center gap-2.5">
          <span
            className="block h-1.5 w-1.5 rounded-full"
            style={{ background: "var(--accent-2)" }}
          />
          <MonoLabel>
            Live preview · {format === "markdown" ? "Markdown" : "PDF"}
          </MonoLabel>
        </div>
        <div
          className="text-muted-fg"
          style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
        >
          {starred.length} items
        </div>
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
          className="mb-2 text-muted-fg"
          style={{ fontFamily: "var(--font-mono)", fontSize: 10.5 }}
        >
          {filename}
        </div>
        <div
          className="mb-1 font-semibold"
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: 34,
            letterSpacing: "-0.8px",
            lineHeight: 1.1,
          }}
        >
          {me?.name ?? "Your name"} — {level}
        </div>
        <div
          className="mb-7 text-muted-fg"
          style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
        >
          {me?.team ?? "—"} · {rangeLabel}
        </div>

        {include.narrative ? (
          <DocSection title="01 / Summary" rangeLabel={rangeLabel}>
            <textarea
              value={narrative}
              onChange={(e) => setNarrative(e.target.value)}
              rows={5}
              placeholder="A few sentences on what this window meant — what shipped, what shifted, what's next. Numbers come from the receipts below; this is the throughline."
              className="w-full rounded-[var(--radius-sub)] border border-dashed border-border bg-card-alt p-2.5 outline-none placeholder:text-dim-fg"
              style={{
                fontFamily: "var(--font-serif)",
                fontSize: 15,
                lineHeight: 1.55,
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
    <div className="mt-6 border-t border-border pt-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h3
          className="m-0 font-semibold"
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 16,
            letterSpacing: "-0.2px",
          }}
        >
          {title}
        </h3>
        <span
          className="uppercase tracking-[0.4px] text-dim-fg"
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
        className="font-semibold leading-none"
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 26,
          letterSpacing: "-0.6px",
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

/**
 * Concise human-readable "Expected" label for the spec — what the goal
 * was set up to achieve. Drawn from the manual cadence + target, or the
 * source target for auto widgets. Fall back to the widget kind name
 * when a goal has no formal target (delegated, free-text, etc.).
 */
function formatExpected(spec) {
  if (!spec) return "—";
  if (spec.delegated?.delegated) {
    return `Judged by ${spec.delegated.judge || "manager"}`;
  }
  const target = spec.manual?.target || spec.source?.target;
  const cadence = spec.manual?.cadence;
  const unit = spec.manual?.unit;
  if (target && target.value != null) {
    const cadenceSuffix = cadence ? ` / ${cadence}` : "";
    const unitSuffix = unit ? ` ${unit}` : "";
    return `${target.op} ${target.value}${unitSuffix}${cadenceSuffix}`;
  }
  // No numeric target — describe the cadence intent if we have one.
  if (cadence === "milestone") return "Hit listed milestones";
  if (cadence === "continuous") return "Continuous reflection";
  if (cadence === "per-incident") return "Per-incident capture";
  if (cadence) return `Logged ${cadence}`;
  // Auto widget without a target (TICKET_CYCLE, CODE_RUBRIC w/o target)
  if (spec.source?.metric) {
    return `Tracked via ${spec.source.metric.replace(/_/g, " ")}`;
  }
  return "Tracked";
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
