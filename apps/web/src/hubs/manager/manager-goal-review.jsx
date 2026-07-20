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

import { TIER_LABELS } from "@/features/goal-tiers";

const TIER_TONE = {
  not_achieved: "var(--bad)",
  achieved: "var(--muted-fg)",
  over_achieved: "var(--good)",
  role_model: "var(--accent)",
};

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
      <span
        className="uppercase text-muted-fg"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          letterSpacing: "0.09em",
          fontWeight: 700,
        }}
      >
        {children}
      </span>
      {typeof count === "number" ? (
        <span
          className="rounded-full px-1.5 text-muted-fg"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 9.5,
            fontWeight: 700,
            background: "var(--panel-2)",
          }}
        >
          {count}
        </span>
      ) : null}
      <span className="h-px flex-1" style={{ background: "var(--border)" }} />
    </div>
  );
}

// ─── AI grade (leads the panel) ──────────────────────────────────────

function AiGradeCard({ ai }) {
  if (!ai) {
    return (
      <div
        className="rounded-md border border-dashed px-3.5 py-3 text-[12px] leading-snug text-muted-fg"
        style={{ borderColor: "var(--border-strong)" }}
      >
        The AI hasn't graded this goal yet — not enough logged data to
        suggest a tier. Grade it from the evidence and criteria below.
      </div>
    );
  }
  const tone = TIER_TONE[ai.tier] ?? "var(--muted-fg)";
  return (
    <div
      className="rounded-md border px-3.5 py-3"
      style={{
        borderColor: "color-mix(in srgb, var(--accent) 30%, var(--border-strong))",
        background: "var(--accent-dim)",
      }}
    >
      <div className="flex items-center gap-2">
        <span
          className="flex-none rounded border px-1.5 py-0.5"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.08em",
            borderColor: "color-mix(in srgb, var(--accent) 40%, var(--border-strong))",
            color: "var(--accent)",
          }}
        >
          AI GRADE
        </span>
        <span
          className="font-semibold"
          style={{ fontFamily: "var(--font-display)", fontSize: 15, color: tone }}
        >
          {TIER_LABELS[ai.tier] ?? ai.tier}
        </span>
        {ai.confidence ? (
          <span
            className="ml-auto text-muted-fg"
            style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
          >
            {CONFIDENCE_LABEL[ai.confidence] ?? ai.confidence} confidence
          </span>
        ) : null}
      </div>
      {ai.reasoning ? (
        <p className="mt-2 text-[12.5px] leading-relaxed text-fg">
          {ai.reasoning}
        </p>
      ) : null}
      {ai.gradedAt ? (
        <div
          className="mt-1.5 text-dim-fg"
          style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
        >
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
    <li
      className="rounded-md border px-3 py-2"
      style={{ borderColor: "var(--border)", background: "var(--card-alt)" }}
    >
      <div className="mb-1 flex items-center gap-2">
        {point.from ? (
          <span
            className="truncate uppercase text-muted-fg"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9.5,
              letterSpacing: "0.05em",
              fontWeight: 700,
            }}
            title={point.from}
          >
            {point.from}
          </span>
        ) : (
          <span
            className="uppercase text-muted-fg"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9.5,
              letterSpacing: "0.05em",
              fontWeight: 700,
            }}
          >
            Note
          </span>
        )}
        {rel ? (
          <span
            className="ml-auto flex-none text-dim-fg"
            style={{ fontFamily: "var(--font-mono)", fontSize: 9.5 }}
          >
            {rel}
          </span>
        ) : null}
      </div>
      {point.kind === "link" ? (
        <a
          href={point.text}
          target="_blank"
          rel="noreferrer noopener"
          className="break-all text-[12px] leading-snug underline decoration-dotted"
          style={{ color: "var(--accent)" }}
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
      <div
        className="rounded-md border border-dashed px-3.5 py-3 text-[12px] leading-snug text-muted-fg"
        style={{ borderColor: "var(--border)" }}
      >
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
        const tone = TIER_TONE[t.key] ?? "var(--muted-fg)";
        return (
          <div
            key={t.key}
            className="rounded-md border px-3 py-2"
            style={{
              borderColor: isAi
                ? "color-mix(in srgb, var(--accent) 40%, var(--border-strong))"
                : "var(--border)",
              background: isAi ? "var(--accent-dim)" : "var(--card)",
            }}
          >
            <div className="flex items-center gap-2">
              <span
                className="h-2 w-2 flex-none rounded-full"
                style={{ background: tone }}
              />
              <span className="text-[12.5px] font-semibold">
                {TIER_LABELS[t.key] ?? t.key}
              </span>
              {isAi ? (
                <span
                  className="ml-auto rounded-full px-2 py-0.5"
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 8.5,
                    fontWeight: 700,
                    letterSpacing: "0.06em",
                    background: "var(--accent)",
                    color: "var(--accent-on)",
                  }}
                >
                  AI
                </span>
              ) : null}
            </div>
            {t.criterion ? (
              <p className="mt-1 pl-4 text-[12px] leading-snug text-muted-fg">
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
      <span
        className="w-24 flex-none uppercase text-muted-fg"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          letterSpacing: "0.04em",
          paddingTop: 1,
        }}
      >
        {label}
      </span>
      <span className="min-w-0 flex-1 text-[12.5px] leading-snug">
        {children}
      </span>
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
        <p className="mb-2 text-[12.5px] leading-relaxed text-fg">
          {spec.prompt}
        </p>
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
      {spec.untrackable ? (
        <DefRow label="Parked">{spec.untrackable.reason}</DefRow>
      ) : null}
      {spec.fields && spec.fields.length > 0 ? (
        <DefRow label="Fields">
          <span className="flex flex-wrap gap-1.5">
            {spec.fields.map((f) => (
              <span
                key={f.id}
                className="rounded border px-1.5 py-0.5"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  borderColor: "var(--border)",
                  color: "var(--muted-fg)",
                }}
              >
                {f.label}
                {f.optional ? " ·opt" : ""}
              </span>
            ))}
          </span>
        </DefRow>
      ) : null}
      {spec.reasoning ? (
        <p className="mt-2 text-[11.5px] leading-snug text-dim-fg">
          {spec.reasoning}
        </p>
      ) : null}
    </div>
  );
}

// ─── recent activity (the raw logged entries) ────────────────────────

function EntryCard({ entry }) {
  const rel = ago(entry.ts);
  return (
    <div
      className="rounded-md border px-3 py-2"
      style={{ borderColor: "var(--border)", background: "var(--card)" }}
    >
      <div className="mb-1 flex items-center gap-2">
        <span
          className="uppercase text-dim-fg"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 9.5,
            letterSpacing: "0.05em",
          }}
        >
          {entry.periodKey ? entry.periodKey : entry.source}
        </span>
        {rel ? (
          <span
            className="ml-auto text-dim-fg"
            style={{ fontFamily: "var(--font-mono)", fontSize: 9.5 }}
          >
            {rel}
          </span>
        ) : null}
      </div>
      {entry.cells.length > 0 ? (
        <div className="grid gap-0.5">
          {entry.cells.map((c, i) => (
            <div key={i} className="flex items-baseline gap-2">
              <span
                className="min-w-0 flex-1 truncate text-muted-fg"
                style={{ fontFamily: "var(--font-mono)", fontSize: 10.5 }}
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
                    className="max-w-[60%] truncate text-[12px] underline decoration-dotted"
                    style={{ color: "var(--accent)" }}
                  >
                    {c.value}
                  </a>
                ) : (
                  <span className="text-[12px] font-semibold">
                    {c.value}
                    {c.unit ? (
                      <span className="text-dim-fg"> {c.unit}</span>
                    ) : null}
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
        <p className="mt-1.5 text-[11.5px] leading-snug text-muted-fg">
          {entry.note}
        </p>
      ) : null}
    </div>
  );
}

// ─── the panel ───────────────────────────────────────────────────────

export function ManagerGoalReview({ loading, error, data }) {
  if (loading) {
    return (
      <div
        className="rounded-md border border-dashed px-3.5 py-4 text-[12px] text-muted-fg"
        style={{ borderColor: "var(--border)" }}
      >
        Loading the goal…
      </div>
    );
  }
  if (error || !data) {
    return (
      <div
        className="rounded-md border border-dashed px-3.5 py-4 text-[12px] text-muted-fg"
        style={{ borderColor: "var(--border)" }}
      >
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
