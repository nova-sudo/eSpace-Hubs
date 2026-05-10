"use client";

/**
 * CodeRubricWidget — AI-graded pull requests scored against a user-defined
 * rubric captured in `spec.context.answers`.
 *
 * Visual shape (inverse theme):
 *   ┌──────────────────────────────────────────────┐
 *   │ RUBRIC · YTD · 14 of 18 passing              │
 *   │ [goal title]                                  │
 *   │ ───────────────                               │
 *   │ 78%  pass rate          [Grade now]          │
 *   │ ▓▓▓▓▓▓▓▓▓▓░░░                                │
 *   │ ─────                                         │
 *   │ #13  ESD-110 audit logging             ✓ pass│
 *   │ #11  ESD-108 rate limiting             ✗ fail│
 *   │      └─ reviewer concern unaddressed…        │
 *   │ …                                             │
 *   └──────────────────────────────────────────────┘
 *
 * All grading happens client-side via the `useGradedPrs` hook; this
 * component is purely presentational.
 */

import { useState } from "react";
import { WidgetShell } from "../widget-shell";
import { useGradedPrs } from "@/features/grading";

export function CodeRubricWidget({ spec, goal, variant = "light", className, onRetry }) {
  const {
    prs,
    verdictsByPr,
    rubric,
    summary,
    progress,
    isListLoading,
    listError,
    gradeAll,
    refreshList,
    hasGithub,
  } = useGradedPrs(spec);

  const [expandedPrId, setExpandedPrId] = useState(null);
  // PR list is COLLAPSED by default — the widget's headline (pass-rate
  // + Grade-now button + summary count) is the at-a-glance read; the
  // per-PR breakdown is the drill-down. This drops the widget's
  // baseline render height from ~600px to ~140px when there are 18+
  // PRs YTD, which lets the masonry packer place it next to short
  // siblings without ballooning a column.
  const [listOpen, setListOpen] = useState(false);

  const year = new Date().getFullYear();
  const label = `Rubric · ${year} YTD`;

  // Empty / setup states come first — short-circuit before the grid.
  if (!hasGithub) {
    return (
      <WidgetShell
        spec={spec}
        variant={variant}
        label={label}
        title={goal?.title || spec.title}
        onRetry={onRetry}
        className={className}
      >
        <EmptyNote variant={variant}>
          Connect GitHub to grade pull requests against your rubric.
        </EmptyNote>
      </WidgetShell>
    );
  }
  if (rubric.length === 0) {
    return (
      <WidgetShell
        spec={spec}
        variant={variant}
        label={label}
        title={goal?.title || spec.title}
        onRetry={onRetry}
        className={className}
      >
        <EmptyNote variant={variant}>
          Define your rubric first — use <strong>edit truths</strong> below,
          add one criterion per line, then come back here to grade.
        </EmptyNote>
      </WidgetShell>
    );
  }
  if (isListLoading && prs.length === 0) {
    return (
      <WidgetShell
        spec={spec}
        variant={variant}
        label={label}
        title={goal?.title || spec.title}
        onRetry={onRetry}
        className={className}
      >
        <EmptyNote variant={variant}>Reading your PRs…</EmptyNote>
      </WidgetShell>
    );
  }
  if (listError) {
    const msg = listError?.message || String(listError);
    const isRateLimit =
      /rate limit|403/i.test(msg) || /secondary rate/i.test(msg);
    return (
      <WidgetShell
        spec={spec}
        variant={variant}
        label={label}
        title={goal?.title || spec.title}
        onRetry={onRetry}
        className={className}
      >
        <div className="flex h-full flex-col justify-between gap-2">
          <EmptyNote variant={variant}>
            {isRateLimit ? (
              <>
                GitHub rate limit hit — 30 search requests/minute per user.
                Wait ~60 seconds and press <strong>Retry</strong>.
                <br />
                <span
                  style={{
                    fontSize: 10,
                    color:
                      variant === "light"
                        ? "rgba(255,255,255,0.55)"
                        : "var(--dim-fg)",
                  }}
                >
                  {msg.slice(0, 180)}
                </span>
              </>
            ) : (
              <>Could not load PRs: {msg}</>
            )}
          </EmptyNote>
          <button
            type="button"
            onClick={refreshList}
            className="self-start rounded-[var(--radius-sub)] px-3 py-1 uppercase font-bold transition-opacity"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              letterSpacing: "0.5px",
              background: variant === "light" ? "#ffffff" : "var(--accent)",
              color: variant === "light" ? "var(--accent)" : "var(--accent-on)",
            }}
          >
            Retry
          </button>
        </div>
      </WidgetShell>
    );
  }
  if (prs.length === 0) {
    return (
      <WidgetShell
        spec={spec}
        variant={variant}
        label={label}
        title={goal?.title || spec.title}
        onRetry={onRetry}
        className={className}
      >
        <EmptyNote variant={variant}>
          No PRs authored by you since Jan 1 — nothing to grade yet.
        </EmptyNote>
      </WidgetShell>
    );
  }

  const hasUngraded = summary.ungraded > 0;

  return (
    <WidgetShell
      spec={spec}
      variant={variant}
      label={`${label} · ${summary.pass}/${summary.total} passing${summary.errored ? ` · ${summary.errored} err` : ""}`}
      title={goal?.title || spec.title}
      onRetry={onRetry}
      className={className}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <PctRow pct={summary.pct} variant={variant} />
        <div
          className="flex h-1.5 w-full overflow-hidden rounded-full"
          style={{
            background:
              variant === "light" ? "rgba(255,255,255,0.18)" : "var(--border)",
          }}
        >
          <div
            className="h-full"
            style={{
              width: `${summary.pct ?? 0}%`,
              background:
                variant === "light" ? "#ffffff" : "var(--accent)",
            }}
          />
        </div>
        <GradeActionRow
          variant={variant}
          progress={progress}
          hasUngraded={hasUngraded}
          onGrade={gradeAll}
          totalPrs={prs.length}
        />
        <ListDisclosure
          variant={variant}
          open={listOpen}
          count={prs.length}
          summary={summary}
          onToggle={() => setListOpen((v) => !v)}
        />
        {listOpen ? (
          <ul
            className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pr-1"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              maxHeight: 320,
            }}
          >
            {prs.map((pr) => (
              <PrRow
                key={pr.id}
                pr={pr}
                verdict={verdictsByPr.get(pr.id)}
                expanded={expandedPrId === pr.id}
                onToggle={() =>
                  setExpandedPrId((id) => (id === pr.id ? null : pr.id))
                }
                variant={variant}
              />
            ))}
          </ul>
        ) : null}
      </div>
    </WidgetShell>
  );
}

function PctRow({ pct, variant }) {
  return (
    <div className="flex items-baseline gap-2">
      <div
        className="font-semibold leading-none"
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 44,
          letterSpacing: "-1.6px",
        }}
      >
        {pct == null ? "—" : `${pct}%`}
      </div>
      <div
        className="uppercase tracking-[0.5px]"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: variant === "light" ? "rgba(255,255,255,0.72)" : "var(--muted-fg)",
        }}
      >
        pass rate
      </div>
    </div>
  );
}

function GradeActionRow({ variant, progress, hasUngraded, onGrade, totalPrs }) {
  const buttonDisabled = progress.running || !hasUngraded;
  let buttonLabel;
  if (progress.running) {
    buttonLabel = `Grading ${progress.done}/${progress.total}…`;
  } else if (hasUngraded) {
    buttonLabel = "Grade now";
  } else {
    buttonLabel = "All graded";
  }
  return (
    <div className="flex items-center justify-between gap-2">
      <div
        className="uppercase tracking-[0.5px]"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9.5,
          color: variant === "light" ? "rgba(255,255,255,0.6)" : "var(--dim-fg)",
        }}
      >
        {totalPrs} PR{totalPrs === 1 ? "" : "s"} YTD
      </div>
      <button
        type="button"
        onClick={onGrade}
        disabled={buttonDisabled}
        className="rounded-[var(--radius-sub)] px-3 py-1 uppercase font-bold transition-opacity disabled:opacity-40"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          letterSpacing: "0.5px",
          background: variant === "light" ? "#ffffff" : "var(--accent)",
          color: variant === "light" ? "var(--accent)" : "var(--accent-on)",
        }}
      >
        {buttonLabel}
      </button>
    </div>
  );
}

/**
 * Toggle row that expands / collapses the per-PR breakdown list.
 * Always renders so users see "X graded · Y ungraded" even when the
 * list is collapsed — the count gives them the gist; expand to see
 * which PRs.
 */
function ListDisclosure({ variant, open, count, summary, onToggle }) {
  const muted =
    variant === "light" ? "rgba(255,255,255,0.65)" : "var(--muted-fg)";
  const fg = variant === "light" ? "#ffffff" : "var(--fg)";
  const passCount = summary?.pass ?? 0;
  const failCount = (summary?.total ?? 0) - passCount;
  const ungraded = summary?.ungraded ?? 0;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="group flex items-center justify-between gap-2 border-t pt-2 text-left"
      style={{
        borderColor:
          variant === "light"
            ? "rgba(255,255,255,0.18)"
            : "var(--border)",
      }}
    >
      <span
        className="flex items-baseline gap-1.5"
        style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: muted }}
      >
        <span
          aria-hidden="true"
          className="inline-block transition-transform"
          style={{
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
            transitionDuration: "200ms",
            transitionTimingFunction: "cubic-bezier(0.22, 0.61, 0.36, 1)",
            color: fg,
          }}
        >
          ›
        </span>
        <span
          className="uppercase tracking-[0.4px] font-bold"
          style={{ color: fg }}
        >
          {open ? "Hide PRs" : "Show PRs"}
        </span>
        <span className="uppercase tracking-[0.4px]">·</span>
        <span className="uppercase tracking-[0.4px]">
          {passCount} pass · {failCount} fail
          {ungraded > 0 ? ` · ${ungraded} ungraded` : ""}
        </span>
      </span>
      <span
        className="uppercase tracking-[0.5px]"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9.5,
          color: muted,
        }}
      >
        {count} total
      </span>
    </button>
  );
}

function PrRow({ pr, verdict, expanded, onToggle, variant }) {
  const muted = variant === "light" ? "rgba(255,255,255,0.62)" : "var(--muted-fg)";
  const dim = variant === "light" ? "rgba(255,255,255,0.42)" : "var(--dim-fg)";
  const fg = variant === "light" ? "#ffffff" : "var(--fg)";

  return (
    <li className="flex flex-col">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 py-1 text-left"
        style={{ color: fg }}
      >
        <span
          className="shrink-0 font-bold"
          style={{
            color: variant === "light" ? "rgba(255,255,255,0.85)" : "var(--accent)",
            width: 46,
          }}
        >
          #{pr.number}
        </span>
        <span className="flex-1 truncate" title={pr.title}>
          {pr.title}
        </span>
        <VerdictBadge verdict={verdict} variant={variant} />
        <span
          className="shrink-0 uppercase"
          style={{ color: dim, fontSize: 9.5 }}
        >
          {pr.state}
        </span>
      </button>
      {expanded && verdict ? (
        <div
          className="ml-[54px] mb-1 rounded-[var(--radius-sub)] px-2 py-1.5"
          style={{
            background:
              variant === "light" ? "rgba(255,255,255,0.08)" : "var(--card-alt)",
            color: muted,
            fontSize: 10.5,
            lineHeight: 1.45,
          }}
        >
          <div style={{ color: fg, marginBottom: verdict.violations?.length ? 4 : 0 }}>
            {verdict.reasoning || "(no reasoning)"}
          </div>
          {verdict.violations?.length ? (
            <ul className="list-inside list-disc">
              {verdict.violations.map((v, i) => (
                <li key={i}>{v}</li>
              ))}
            </ul>
          ) : null}
          {pr.htmlUrl ? (
            <a
              href={pr.htmlUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-block uppercase tracking-[0.5px]"
              style={{
                fontSize: 9.5,
                color: variant === "light" ? "rgba(255,255,255,0.85)" : "var(--accent)",
              }}
            >
              open on github ↗
            </a>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function VerdictBadge({ verdict, variant }) {
  if (!verdict) {
    return (
      <span
        className="shrink-0 uppercase"
        style={{
          color: variant === "light" ? "rgba(255,255,255,0.5)" : "var(--dim-fg)",
          fontSize: 9.5,
        }}
      >
        ungraded
      </span>
    );
  }
  if (verdict.errored) {
    return (
      <span
        className="shrink-0 uppercase"
        title={verdict.reasoning}
        style={{
          color: variant === "light" ? "rgba(255,255,255,0.62)" : "var(--muted-fg)",
          fontSize: 9.5,
        }}
      >
        err
      </span>
    );
  }
  return (
    <span
      className="shrink-0 font-bold uppercase"
      style={{
        color: verdict.pass
          ? "var(--accent-2)"
          : variant === "light"
            ? "#ffffff"
            : "var(--bad)",
        fontSize: 10,
      }}
    >
      {verdict.pass ? "✓ pass" : "✗ fail"}
    </span>
  );
}

function EmptyNote({ children, variant }) {
  return (
    <div
      className="flex h-full items-center"
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        lineHeight: 1.5,
        color: variant === "light" ? "rgba(255,255,255,0.72)" : "var(--muted-fg)",
      }}
    >
      {children}
    </div>
  );
}
