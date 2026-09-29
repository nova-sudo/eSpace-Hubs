"use client";

/**
 * Read-only review of one report's goal — the "GoalWidget you can't
 * edit" a manager reads while grading. The dev hub's real widget is
 * coupled to the session user's client stores, so we can't render it for
 * someone else; this projects the same underlying data (definition, tier
 * criteria, logged evidence, verdict history) into a read-only panel.
 *
 * It now renders ONE TAB at a time, because it sits beside the decision
 * rather than above it: the grading drawer is two panes, and evidence a
 * lead is cross-referencing has to stay on screen while they pick a
 * rung. Same data, same projections — only the container changed.
 *
 *   readings  what was logged, one row per cadence window (opens here)
 *   evidence  what the engineer attached, plus the goal's own rubric
 *   history   who graded it, when, on what reasoning — every grade ever
 *             set (append-only), and whether the report saw / disputes it
 *
 * Data: GET /manager/reports/:userId/goals/:goalId/detail (via
 * useGoalDetail) and …/verdicts (via useVerdictHistory, passed in as
 * `verdicts`). Rendered inside ManagerGradeDrawer.
 */

import { Badge, Label } from "@/components/ui";
import { TIER_LABELS } from "@/features/goal-tiers";
import { fmtNumber, fmtTarget } from "@/lib/fmt";
import {
  ago,
  describeAck,
  describeVerdictHistory,
  onDate,
  shortDate,
} from "./manager-format";
import { TIER_TONE } from "./manager-ui";

const CONFIDENCE_LABEL = { high: "High", medium: "Medium", low: "Low" };

function PanelNote({ children }) {
  return (
    <div className="rounded-[var(--radius-lg)] bg-card px-3.5 py-3 text-[12px] leading-snug text-muted-fg">
      {children}
    </div>
  );
}

function SectionLabel({ children, count }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <Label>{children}</Label>
      {typeof count === "number" ? <Badge>{count}</Badge> : null}
    </div>
  );
}

// ─── evidence (what they attached) ───────────────────────────────────

function EvidencePoint({ point }) {
  const rel = ago(point.ts);
  return (
    <li className="rounded-[var(--radius-lg)] bg-card px-3 py-2.5">
      <div className="mb-1 flex items-center gap-2">
        <span
          className="truncate text-[11px] font-semibold text-muted-fg"
          title={point.from}
        >
          {point.from || "Note"}
        </span>
        {rel ? (
          <span className="ml-auto flex-none text-[11px] text-muted-fg">{rel}</span>
        ) : null}
      </div>
      {point.kind === "link" ? (
        <a
          href={point.text}
          target="_blank"
          rel="noreferrer noopener"
          className="break-all text-[12px] font-bold leading-snug text-fg"
        >
          {point.text}
        </a>
      ) : (
        <p className="text-[12.5px] leading-relaxed text-fg">{point.text}</p>
      )}
    </li>
  );
}

function EvidenceSection({ evidence }) {
  if (!evidence || evidence.length === 0) {
    return (
      <PanelNote>
        No notes or links attached to their entries yet. Grade from the
        numbers and the rubric.
      </PanelNote>
    );
  }
  return (
    <ul className="grid gap-1.5">
      {evidence.map((p, i) => (
        <EvidencePoint key={`${p.ts}-${i}`} point={p} />
      ))}
    </ul>
  );
}

// ─── tier criteria (the goal's own rubric) ───────────────────────────

/** The goal tree's written rubric — the "why" when there are no scored levels. */
export function RubricNote({ rubric }) {
  if (!rubric) return null;
  return (
    <p className="whitespace-pre-line rounded-[var(--radius-lg)] bg-card px-3.5 py-3 text-[12.5px] leading-relaxed text-fg">
      {rubric}
    </p>
  );
}

function TierCriteria({ tiers, aiTier }) {
  if (!tiers) return null;
  return (
    <div className="grid gap-1.5">
      {tiers.map((t) => {
        const isAi = t.key === aiTier;
        return (
          <div
            key={t.key}
            className={`rounded-[var(--radius-lg)] px-3 py-2.5 ${isAi ? "bg-lav" : "bg-card"}`}
          >
            <div className="flex items-center gap-2">
              <span
                className={`text-[12.5px] font-bold ${isAi ? "text-lav-ink" : "text-fg"}`}
              >
                {TIER_LABELS[t.key] ?? t.key}
              </span>
              {isAi ? (
                <Badge tone="ink" className="ml-auto">
                  AI
                </Badge>
              ) : null}
            </div>
            {t.criterion ? (
              <p
                className={`mt-1 text-[12px] leading-snug ${isAi ? "text-lav-ink" : "text-muted-fg"}`}
              >
                {t.criterion}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// ─── goal definition (supporting context) ────────────────────────────

function DefRow({ label, children }) {
  return (
    <div className="flex gap-3 py-1">
      <span className="w-24 flex-none pt-px text-[11px] font-semibold text-muted-fg">
        {label}
      </span>
      <span className="min-w-0 flex-1 text-[12.5px] leading-snug">{children}</span>
    </div>
  );
}

function GoalDefinition({ spec }) {
  if (!spec) {
    return (
      <PanelNote>This goal hasn&apos;t been classified into a widget yet.</PanelNote>
    );
  }
  const target = fmtTarget({ ...spec.target, unit: spec.unit });
  const targetStr = target
    ? `${target}${spec.target.period ? ` per ${spec.target.period}` : ""}`
    : null;
  return (
    <div>
      {spec.prompt ? (
        <p className="mb-2 text-[12.5px] leading-relaxed text-fg">{spec.prompt}</p>
      ) : null}
      {spec.kindLabel ? <DefRow label="Kind">{spec.kindLabel}</DefRow> : null}
      {spec.cadence ? <DefRow label="Cadence">{spec.cadence}</DefRow> : null}
      {targetStr ? <DefRow label="Target">{targetStr}</DefRow> : null}
      {spec.source ? (
        <DefRow label="Source">
          {[spec.source.provider, spec.source.metric, spec.source.window]
            .filter(Boolean)
            .join(" · ")}
        </DefRow>
      ) : null}
      {spec.delegated ? (
        <DefRow label="Delegated">
          Judged by {spec.delegated.judge || "a reviewer"}
          {spec.delegated.note ? ` — ${spec.delegated.note}` : ""}
        </DefRow>
      ) : null}
      {spec.untrackable ? <DefRow label="Parked">{spec.untrackable.reason}</DefRow> : null}
      {spec.fields && spec.fields.length > 0 ? (
        <DefRow label="Fields">
          <span className="flex flex-wrap gap-1.5">
            {spec.fields.map((f) => (
              <span
                key={f.id}
                className="rounded-[var(--radius-md)] bg-card px-1.5 py-0.5 text-[11px] text-muted-fg"
              >
                {f.label}
                {f.optional ? " · opt" : ""}
              </span>
            ))}
          </span>
        </DefRow>
      ) : null}
      {spec.reasoning ? (
        <p className="mt-2 text-[11.5px] leading-snug text-muted-fg">{spec.reasoning}</p>
      ) : null}
    </div>
  );
}

// ─── readings (the raw logged entries) ───────────────────────────────

function EntryCard({ entry }) {
  const rel = ago(entry.ts);
  return (
    <div className="rounded-[var(--radius-lg)] bg-card px-3 py-2.5">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[11px] text-muted-fg">
          {entry.periodKey ? entry.periodKey : entry.source}
        </span>
        {rel ? <span className="ml-auto text-[11px] text-muted-fg">{rel}</span> : null}
      </div>
      {entry.cells.length > 0 ? (
        <div className="grid gap-0.5">
          {entry.cells.map((c, i) => (
            <div key={i} className="flex items-baseline gap-2">
              <span
                className="min-w-0 flex-1 truncate text-[11px] text-muted-fg"
                title={c.label}
              >
                {c.label}
              </span>
              {c.value != null ? (
                c.isLink ? (
                  <a
                    href={c.value}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="max-w-[60%] truncate text-[12px] font-bold text-fg"
                  >
                    {c.value}
                  </a>
                ) : (
                  <span className="text-[12px] font-bold">
                    {c.value}
                    {c.unit ? <span className="text-muted-fg"> {c.unit}</span> : null}
                  </span>
                )
              ) : (
                <span className="text-[11px] text-dim-fg">—</span>
              )}
            </div>
          ))}
        </div>
      ) : null}
      {entry.note ? (
        <p className="mt-1.5 text-[11.5px] leading-snug text-muted-fg">{entry.note}</p>
      ) : null}
    </div>
  );
}

/** One row per cadence window — "W40 · 3 h · 3 entries" — not per click. */
function WindowRows({ windows }) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] bg-card">
      {windows.map((w, i) => (
        <div
          key={w.key}
          className={`flex items-baseline gap-3 px-3.5 py-2 ${i ? "border-t border-line" : ""}`}
        >
          <span className="w-12 flex-none text-[12px] font-semibold text-muted-fg">{w.label}</span>
          <span className="min-w-0 flex-1 text-[13px] font-bold tabular-nums text-fg">
            {w.total != null ? `${fmtNumber(w.total)}${w.unit ? ` ${w.unit}` : ""}` : "Logged"}
          </span>
          <span className="text-[11px] text-muted-fg">
            {w.entries} {w.entries === 1 ? "entry" : "entries"}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── history (who graded it, when, on what reasoning) ────────────────

function VerdictCard({ title, tier, when, by, body, tone }) {
  return (
    <div className={`rounded-[var(--radius-lg)] p-3.5 ${tone === "lav" ? "bg-lav" : "bg-card"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={tone === "lav" ? "ink" : TIER_TONE[tier] ?? "neutral"}>{title}</Badge>
        <span
          className={`text-[14px] font-bold ${tone === "lav" ? "text-lav-ink" : "text-fg"}`}
        >
          {TIER_LABELS[tier] ?? tier}
        </span>
        {by ? (
          <span className="ml-auto text-[11px] text-muted-fg">{by}</span>
        ) : null}
      </div>
      {body ? (
        <p
          className={`mt-2 text-[12.5px] leading-relaxed ${tone === "lav" ? "text-lav-ink" : "text-fg"}`}
        >
          {body}
        </p>
      ) : null}
      {when ? (
        <div className="mt-1.5 text-[11px] text-muted-fg">
          {onDate(when)} · {ago(when)}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Every manager grade on this goal, one sentence per grading period
 * ("Over achieved by Ana on 3 Sep, changed to Achieved on 20 Sep"), then
 * the individual grades with their notes and the report's response.
 */
function GradeTimeline({ verdicts, firstName }) {
  if (!verdicts || verdicts.loading) return <PanelNote>Loading grade history…</PanelNote>;
  if (verdicts.error) {
    return <PanelNote>Couldn&apos;t load the grade history right now.</PanelNote>;
  }
  const history = verdicts.history ?? [];
  if (history.length === 0) return null;
  const lines = describeVerdictHistory(history, TIER_LABELS);
  const newestFirst = [...history].reverse();
  return (
    <section>
      <SectionLabel count={history.length}>Grade history</SectionLabel>
      <div className="grid gap-1.5">
        {lines.map((l) => (
          <div
            key={l.periodKey}
            className="rounded-[var(--radius-lg)] bg-card px-3.5 py-3 text-[12.5px] leading-snug text-fg"
          >
            <Badge className="mr-2">{l.periodKey}</Badge>
            {l.text}
          </div>
        ))}
        {newestFirst.map((h, i) => {
          const ack = describeAck(h.ack, firstName);
          return (
            <div
              key={h.id ?? `${h.gradedAt}-${i}`}
              className="rounded-[var(--radius-lg)] bg-card px-3.5 py-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={TIER_TONE[h.tier] ?? "neutral"}>
                  {TIER_LABELS[h.tier] ?? h.tier}
                </Badge>
                {h.supersededAt ? <Badge>Replaced {shortDate(h.supersededAt)}</Badge> : null}
                {ack ? (
                  <Badge tone={h.ack.disagree ? "peach" : "mint"}>{ack}</Badge>
                ) : null}
                <span className="ml-auto text-[11px] text-muted-fg">
                  {h.gradedByName} · {onDate(h.gradedAt)}
                </span>
              </div>
              {h.note ? (
                <p className="mt-2 text-[12.5px] leading-relaxed text-fg">{h.note}</p>
              ) : null}
              {h.ack?.disagree && h.ack.note ? (
                <p className="mt-2 rounded-[var(--radius-lg)] bg-peach px-3 py-2 text-[12px] leading-snug text-peach-ink">
                  <b>{firstName}:</b> {h.ack.note}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─── the panel ───────────────────────────────────────────────────────

export function ManagerGoalReview({
  tab = "evidence",
  loading,
  error,
  data,
  verdicts,
  firstName = "They",
}) {
  if (loading) {
    return <PanelNote>Loading the goal…</PanelNote>;
  }
  if (error || !data) {
    return (
      <PanelNote>
        Couldn&apos;t load the goal detail. You can still set a tier on the
        left.
      </PanelNote>
    );
  }

  const { spec, ai, manager, evidence, entries, entryCount, windows, rubric } = data;
  const aiTier = ai?.tier ?? null;

  if (tab === "readings") {
    return (
      <div className="grid gap-5">
        <section>
          <SectionLabel count={entryCount}>
            {windows ? "Logged per period" : "Logged entries"}
          </SectionLabel>
          {windows && windows.length > 0 ? (
            <WindowRows windows={windows} />
          ) : entries && entries.length > 0 ? (
            <div className="grid gap-1.5">
              {entries.map((e, i) => (
                <EntryCard key={`${e.ts}-${i}`} entry={e} />
              ))}
            </div>
          ) : (
            <PanelNote>
              Nothing logged against this goal yet. An AUTO goal reads itself
              from the provider instead — its number lives in the review
              packet.
            </PanelNote>
          )}
        </section>
        <section>
          <SectionLabel>What this goal tracks</SectionLabel>
          <GoalDefinition spec={spec} />
        </section>
      </div>
    );
  }

  if (tab === "history") {
    return (
      <div className="grid gap-5">
        <GradeTimeline verdicts={verdicts} firstName={firstName} />
        <section>
          <SectionLabel>Current verdicts</SectionLabel>
          <div className="grid gap-1.5">
            {manager ? (
              <VerdictCard
                title="Your grade"
                tier={manager.tier}
                when={manager.gradedAt}
                by={manager.gradedByName}
                body={manager.note}
              />
            ) : null}
            {ai ? (
              <VerdictCard
                title="AI grade"
                tier={ai.tier}
                when={ai.gradedAt}
                by={
                  ai.confidence
                    ? `${CONFIDENCE_LABEL[ai.confidence] ?? ai.confidence} confidence`
                    : null
                }
                body={ai.reasoning}
                tone="lav"
              />
            ) : null}
            {!manager && !ai ? (
              <PanelNote>
                Nobody has graded this goal yet — not the AI, not you. Yours
                will be the first verdict on it.
              </PanelNote>
            ) : null}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      <section>
        <SectionLabel count={evidence?.length || 0}>Evidence</SectionLabel>
        <EvidenceSection evidence={evidence} />
      </section>

      {spec?.tiers ? (
        <section>
          <SectionLabel>Achievement criteria</SectionLabel>
          <TierCriteria tiers={spec.tiers} aiTier={aiTier} />
        </section>
      ) : rubric ? (
        <section>
          <SectionLabel>Rubric from their goal sheet</SectionLabel>
          <RubricNote rubric={rubric} />
        </section>
      ) : null}
    </div>
  );
}
