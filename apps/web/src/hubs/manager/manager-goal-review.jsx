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
 *   evidence  what the engineer attached, plus the goal's own rubric
 *   readings  the entries actually logged, newest first
 *   history   who graded it, when, and on what reasoning
 *
 * Data: GET /manager/reports/:userId/goals/:goalId/detail (via
 * useGoalDetail). Rendered inside ManagerGradeDrawer.
 */

import { Badge, Label } from "@/components/ui";
import { TIER_LABELS } from "@/features/goal-tiers";
import { ago, onDate } from "./manager-format";
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
          <span className="ml-auto flex-none text-[11px] text-dim-fg">{rel}</span>
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
        No evidence logged yet — the engineer hasn&apos;t attached notes or
        links to their entries. Grade from the AI read and the criteria.
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
  const targetStr = spec.target
    ? `${spec.target.op} ${spec.target.value}${spec.target.period ? ` / ${spec.target.period}` : ""}`
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
        <p className="mt-2 text-[11.5px] leading-snug text-dim-fg">{spec.reasoning}</p>
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
        <span className="text-[11px] text-dim-fg">
          {entry.periodKey ? entry.periodKey : entry.source}
        </span>
        {rel ? <span className="ml-auto text-[11px] text-dim-fg">{rel}</span> : null}
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
                    {c.unit ? <span className="text-dim-fg"> {c.unit}</span> : null}
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

// ─── the panel ───────────────────────────────────────────────────────

export function ManagerGoalReview({ tab = "evidence", loading, error, data }) {
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

  const { spec, ai, manager, evidence, entries, entryCount } = data;
  const aiTier = ai?.tier ?? null;

  if (tab === "readings") {
    return (
      <div className="grid gap-5">
        <section>
          <SectionLabel count={entryCount}>Logged entries</SectionLabel>
          {entries && entries.length > 0 ? (
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
        <section>
          <SectionLabel>Grading history</SectionLabel>
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
      ) : null}
    </div>
  );
}
