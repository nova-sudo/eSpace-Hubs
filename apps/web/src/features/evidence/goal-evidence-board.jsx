"use client";

/**
 * Goal evidence board — the primary Evidence surface.
 *
 * The Evidence page is goal-oriented: it shows your goals grouped by L1, each
 * with what it tracks, its current reading + status, its AI tier standing, and
 * the concrete evidence you've logged against it (check-in notes, per-item /
 * per-field proof, links) over the period. This is the "proof for my review"
 * view; "Compile into review →" turns it into the exportable document.
 *
 * Presentation only — groups come from buildGoalEvidenceGroups().
 */

import Link from "next/link";
import { Pill } from "@/components/ui";
import { SPEC_KIND_META } from "@/features/goal-specs";
import { GoalTierBadge } from "@/features/goal-tiers";
import { useHubLink } from "@/features/hubs";

const TONE_PILL = { ok: "ok", accent: "accent", warn: "warn", muted: "muted" };

function relAgo(ts) {
  if (!ts) return null;
  const d = Math.round((Date.now() - ts) / 86_400_000);
  if (d <= 0) return "today";
  return `${d}d ago`;
}

export function GoalEvidenceBoard({ groups, loading, goalsHref }) {
  const link = useHubLink();
  if (loading && (!groups || groups.length === 0)) {
    return (
      <div
        className="rounded-[10px] border border-border bg-card px-4 py-10 text-center text-[13px] text-muted-fg"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        Reading your goals…
      </div>
    );
  }
  if (!groups || groups.length === 0) {
    return (
      <div
        className="rounded-[10px] border border-dashed border-border-strong bg-card px-4 py-10 text-center text-[13px] text-muted-fg"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        No classified goals yet.{" "}
        <Link href={goalsHref || link("/goals")} className="text-accent hover:underline">
          Set up your goals →
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-7">
      {groups.map((g) => (
        <section key={g.l1?.id} className="flex flex-col gap-3">
          <div className="flex items-baseline gap-3 border-b border-border pb-2">
            <span
              className="uppercase text-fg"
              style={{ fontFamily: "var(--font-dot)", fontWeight: 900, fontSize: 15, letterSpacing: "0.5px" }}
            >
              {g.l1?.title || "Ungrouped"}
            </span>
            {g.l1Reading ? (
              <span
                className="uppercase tracking-[0.5px] text-muted-fg"
                style={{ fontFamily: "var(--font-mono)", fontSize: 9 }}
              >
                {g.l1Reading.value}
              </span>
            ) : null}
            <span
              className="ml-auto text-muted-fg"
              style={{ fontFamily: "var(--font-mono)", fontSize: 9 }}
            >
              {g.goals.length} goal{g.goals.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="flex flex-col gap-2.5">
            {g.goals.map((row) => (
              <GoalEvidenceCard key={row.goal.id} row={row} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function GoalEvidenceCard({ row }) {
  const { goal, spec, reading, evidence, checkinDays, lastTs } = row;
  const kindLabel = SPEC_KIND_META[spec?.widget]?.label ?? "Goal";
  const tone = TONE_PILL[reading?.statusTone] || "muted";
  const logged = relAgo(lastTs);

  return (
    <div className="rounded-[10px] border border-border bg-card px-4 py-3.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className="shrink-0 rounded-[3px] border border-border px-1 py-px uppercase tracking-[0.6px] text-muted-fg"
              style={{ fontFamily: "var(--font-mono)", fontSize: 9 }}
            >
              {kindLabel}
            </span>
            <span className="truncate text-[13.5px] font-medium text-fg" title={goal.title}>
              {goal.title}
            </span>
          </div>
          {reading?.value ? (
            <div className="mt-1.5 text-[12px] text-muted-fg">{reading.value}</div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <GoalTierBadge goalId={goal.id} spec={spec} />
          {reading?.statusLabel ? (
            <Pill tone={tone}>{reading.statusLabel}</Pill>
          ) : null}
        </div>
      </div>

      {/* Logged evidence — the proof the user attached to this goal. */}
      {evidence.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-1.5 border-t border-border pt-2.5">
          {evidence.map((ev, i) => (
            <li key={i} className="flex items-start gap-2 text-[11.5px] leading-[1.4]">
              <span className="mt-[5px] h-1 w-1 shrink-0 rounded-full" style={{ background: "var(--accent)" }} />
              {/* Display the full text, but link to the EXTRACTED url (not the
                  "label: url" text, which would resolve as a broken relative link). */}
              <span className="min-w-0 text-fg/85">
                {ev.text}
                {ev.url ? (
                  <>
                    {" "}
                    <a
                      href={ev.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent hover:underline"
                    >
                      ↗
                    </a>
                  </>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <div
        className="mt-2.5 flex items-center gap-2 uppercase tracking-[0.4px] text-dim-fg"
        style={{ fontFamily: "var(--font-mono)", fontSize: 9 }}
      >
        {checkinDays > 0
          ? `logged on ${checkinDays} day${checkinDays === 1 ? "" : "s"} this period`
          : "no check-ins this period"}
        {logged ? <span>· last logged {logged}</span> : null}
      </div>
    </div>
  );
}
