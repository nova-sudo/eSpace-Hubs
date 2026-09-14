"use client";

/**
 * Read-only review of one report's goal — the "GoalWidget you can't edit"
 * the manager reads while grading. The dev hub's real widget is coupled to
 * the session user's client stores, so we can't render it for someone
 * else; this projects the same underlying data (definition, tier criteria,
 * logged evidence, AI verdict) into a read-only panel.
 *
 * Emphasis, per the grading flow: the AI's grade and the engineer's
 * evidence lead; the goal definition + tier criteria support the call.
 *
 * Data: GET /manager/reports/:userId/goals/:goalId/detail (via
 * useGoalDetail). Rendered inside ManagerGradeDrawer.
 */

import { Badge, Label } from "@/components/ui";
import { TIER_LABELS } from "@/features/goal-tiers";

const CONFIDENCE_LABEL = { high: "High", medium: "Medium", low: "Low" };

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

function SectionLabel({ children, count }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <Label>{children}</Label>
      {typeof count === "number" ? <Badge>{count}</Badge> : null}
    </div>
  );
}

// ─── AI grade (leads the panel) ──────────────────────────────────────

function AiGradeCard({ ai }) {
  if (!ai) {
    return (
      <div className="rounded-[var(--radius-lg)] bg-card-alt px-3.5 py-3 text-[12px] leading-snug text-muted-fg">
        The AI hasn't graded this goal yet — not enough logged data to
        suggest a tier. Grade it from the evidence and criteria below.
      </div>
    );
  }
  return (
    <div className="rounded-[var(--radius-lg)] bg-lav p-3.5">
      <div className="flex items-center gap-2">
        <Badge tone="ink">AI grade</Badge>
        <span className="font-bold text-[15px] text-lav-ink">
          {TIER_LABELS[ai.tier] ?? ai.tier}
        </span>
        {ai.confidence ? (
          <span className="ml-auto text-[11px] text-lav-ink/70">
            {CONFIDENCE_LABEL[ai.confidence] ?? ai.confidence} confidence
          </span>
        ) : null}
      </div>
      {ai.reasoning ? (
        <p className="mt-2 text-[12.5px] leading-relaxed text-lav-ink">
          {ai.reasoning}
        </p>
      ) : null}
      {ai.gradedAt ? (
        <div className="mt-1.5 text-[11px] text-lav-ink/60">
          graded {ago(ai.gradedAt)}
        </div>
      ) : null}
    </div>
  );
}

// ─── evidence (the other emphasis) ───────────────────────────────────

function EvidencePoint({ point }) {
  const rel = ago(point.ts);
  return (
    <li className="rounded-[var(--radius-lg)] bg-card-alt px-3 py-2.5">
      <div className="mb-1 flex items-center gap-2">
        <span className="truncate text-[11px] font-semibold text-muted-fg" title={point.from}>
          {point.from || "Note"}
        </span>
        {rel ? <span className="ml-auto flex-none text-[11px] text-dim-fg">{rel}</span> : null}
      </div>
      {point.kind === "link" ? (
        <a href={point.text} target="_blank" rel="noreferrer noopener" className="break-all text-[12px] font-bold leading-snug text-fg">
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
      <div className="rounded-[var(--radius-lg)] bg-card-alt px-3.5 py-3 text-[12px] leading-snug text-muted-fg">
        No evidence logged yet — the engineer hasn't attached notes or links
        to their entries. Grade from the AI read and the criteria.
      </div>
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

// ─── tier criteria (grade against the goal's own rubric) ─────────────

function TierCriteria({ tiers, aiTier }) {
  if (!tiers) return null;
  return (
    <div className="grid gap-1.5">
      {tiers.map((t) => {
        const isAi = t.key === aiTier;
        return (
          <div
            key={t.key}
            className={`rounded-[var(--radius-lg)] px-3 py-2.5 ${isAi ? "bg-lav" : "bg-card-alt"}`}
          >
            <div className="flex items-center gap-2">
              <span className={`text-[12.5px] font-bold ${isAi ? "text-lav-ink" : "text-fg"}`}>
                {TIER_LABELS[t.key] ?? t.key}
              </span>
              {isAi ? <Badge tone="ink" className="ml-auto">AI</Badge> : null}
            </div>
            {t.criterion ? (
              <p className={`mt-1 text-[12px] leading-snug ${isAi ? "text-lav-ink/80" : "text-muted-fg"}`}>
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
      <span className="w-24 flex-none pt-px text-[11px] font-semibold text-muted-fg">{label}</span>
      <span className="min-w-0 flex-1 text-[12.5px] leading-snug">{children}</span>
    </div>
  );
}

function GoalDefinition({ spec }) {
  if (!spec) {
    return (
      <div className="text-[12px] leading-snug text-muted-fg">
        This goal hasn't been classified into a widget yet.
      </div>
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
              <span key={f.id} className="rounded-[var(--radius-md)] bg-card-alt px-1.5 py-0.5 text-[11px] text-muted-fg">
                {f.label}
                {f.optional ? " ·opt" : ""}
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

// ─── recent activity (the raw logged entries) ────────────────────────

function EntryCard({ entry }) {
  const rel = ago(entry.ts);
  return (
    <div className="rounded-[var(--radius-lg)] bg-card-alt px-3 py-2.5">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[11px] text-dim-fg">{entry.periodKey ? entry.periodKey : entry.source}</span>
        {rel ? <span className="ml-auto text-[11px] text-dim-fg">{rel}</span> : null}
      </div>
      {entry.cells.length > 0 ? (
        <div className="grid gap-0.5">
          {entry.cells.map((c, i) => (
            <div key={i} className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate text-[11px] text-muted-fg" title={c.label}>
                {c.label}
              </span>
              {c.value != null ? (
                c.isLink ? (
                  <a href={c.value} target="_blank" rel="noreferrer noopener" className="max-w-[60%] truncate text-[12px] font-bold text-fg">
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
      {entry.note ? <p className="mt-1.5 text-[11.5px] leading-snug text-muted-fg">{entry.note}</p> : null}
    </div>
  );
}

// ─── the panel ───────────────────────────────────────────────────────

export function ManagerGoalReview({ loading, error, data }) {
  if (loading) {
    return (
      <div className="rounded-[var(--radius-lg)] bg-card-alt px-3.5 py-4 text-[12px] text-muted-fg">
        Loading the goal…
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="rounded-[var(--radius-lg)] bg-card-alt px-3.5 py-4 text-[12px] text-muted-fg">
        Couldn't load the goal detail. You can still set a tier below.
      </div>
    );
  }

  const { spec, ai, evidence, entries, entryCount } = data;
  const aiTier = ai?.tier ?? null;

  return (
    <div className="grid gap-5">
      <section>
        <SectionLabel>AI read</SectionLabel>
        <AiGradeCard ai={ai} />
      </section>

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

      <section>
        <SectionLabel>What this goal tracks</SectionLabel>
        <GoalDefinition spec={spec} />
      </section>

      {entries && entries.length > 0 ? (
        <section>
          <SectionLabel count={entryCount}>Recent activity</SectionLabel>
          <div className="grid gap-1.5">
            {entries.map((e, i) => (
              <EntryCard key={`${e.ts}-${i}`} entry={e} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
