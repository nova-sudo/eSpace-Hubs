"use client";

/**
 * Goal Intelligence Hub — the app's home surface (Dev hub), "Focus" layout.
 *
 * One thing at a time. Instead of a wall of health cards, the page leads with
 * a single hero for the most-slipping goal (queue[0]), a short "also needs
 * attention" list (queue[1..]), and the full health board tucked behind a
 * disclosure. When nothing needs the user, a calm "all caught up" hero.
 *
 * Data comes from two shared-domain hooks only (useGoalWidgetItems +
 * useGoalHealth) — no product-surface imports, no integration tiles.
 * `queue` is severity-sorted, so queue[0] IS the top priority.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button, Loader, Reveal } from "@/components/ui";
import { useGoalWidgetItems } from "@/features/goal-widgets";
import { useHubLink } from "@/features/hubs";
import { resolveCompletedWorkWeek } from "@/lib/date";
import { FocusHero } from "./focus-hero";
import { AlsoNeedsAttention } from "./also-needs-attention";
import { GoalHealthGrid } from "./goal-health-grid";
import { useGoalHealth } from "./use-goal-health";

export function IntelligencePage() {
  const {
    groupedItems,
    hasGoals,
    hasSpecs,
    unclassifiedGoals,
    ready: itemsReady,
  } = useGoalWidgetItems();
  const { ready: inputsReady, groups, queue, summary } = useGoalHealth(groupedItems);

  const link = useHubLink();
  const fillHref = link("/goals");
  // The week inline "Log it now" writes against — same completed work week the
  // grid + check-in default to. Resolved once per mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const week = useMemo(() => resolveCompletedWorkWeek(), []);
  const [showBoard, setShowBoard] = useState(false);

  const loading = !itemsReady || !inputsReady;
  const hero = queue?.[0] || null;
  const rest = queue?.slice(1) || [];
  const needCount = queue?.length ?? 0;

  return (
    <main className="relative z-[2] mx-auto max-w-[760px] px-10 pb-16 pt-9">
      {/* Centered Focus header (IntelB): mono crumb + Doto title, accent dot. */}
      <div className="mb-[26px] text-center">
        <div
          className="uppercase tracking-[2px] text-muted-fg"
          style={{ fontFamily: "var(--font-mono)", fontSize: 10.5 }}
        >
          {hasSpecs && !loading
            ? `Start here · ${needCount} of ${summary.total} need you`
            : "Goal intelligence"}
        </div>
        <h1
          className="mt-3 uppercase text-fg"
          style={{
            fontFamily: "var(--font-dot)",
            fontWeight: 900,
            fontSize: 34,
            lineHeight: 0.95,
            letterSpacing: "1px",
          }}
        >
          One thing at a time<span style={{ color: "var(--accent)" }}>.</span>
        </h1>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader label="Reading your goals" />
        </div>
      ) : !hasGoals ? (
        <EmptyState
          title="No goals yet"
          body="Add your performance goals to start tracking them here."
          ctaHref={link("/goals")}
          ctaLabel="Add goals"
        />
      ) : !hasSpecs ? (
        <EmptyState
          title="Goals aren't classified yet"
          body={`You have goals, but none are classified into trackable widgets. Open the analyst (top-right) to classify them${
            unclassifiedGoals.length ? ` — ${unclassifiedGoals.length} waiting` : ""
          }.`}
          ctaHref={link("/goals")}
          ctaLabel="Review goals"
        />
      ) : (
        <Reveal stagger className="flex flex-col gap-[30px]">
          {hero ? (
            // key by goal id → when the top priority changes (e.g. after you
            // fill the current hero), React remounts the hero and its inline
            // editor doesn't carry an open/expanded state onto the next goal.
            <FocusHero key={hero.goal.id} card={hero} week={week} />
          ) : (
            <AllCaughtUp total={summary.total} />
          )}

          {rest.length > 0 ? (
            <AlsoNeedsAttention
              rest={rest}
              totalAttention={needCount}
              seeAllHref={fillHref}
            />
          ) : null}

          {unclassifiedGoals.length > 0 ? (
            <UnclassifiedNote count={unclassifiedGoals.length} />
          ) : null}

          {/* Full health board — tucked away so the page stays calm. */}
          <div>
            <button
              type="button"
              onClick={() => setShowBoard((v) => !v)}
              className="flex w-full items-center justify-between border-t border-border pt-3 uppercase tracking-[1px] text-muted-fg transition-colors hover:text-fg"
              style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
            >
              <span>Full board · {summary.total} goals</span>
              <span>{showBoard ? "Hide ▴" : "Show ▾"}</span>
            </button>
            {showBoard ? (
              <div className="mt-5">
                <GoalHealthGrid groups={groups} fillHref={fillHref} />
              </div>
            ) : null}
          </div>
        </Reveal>
      )}
    </main>
  );
}

/** Shown when the attention queue is empty — everything's on pace. */
function AllCaughtUp({ total }) {
  return (
    <div
      className="relative overflow-hidden rounded-[16px] p-[30px] text-center"
      style={{
        border: "1px solid var(--border)",
        background: "linear-gradient(180deg, color-mix(in srgb, var(--good) 8%, transparent), transparent)",
      }}
    >
      <div
        className="text-[28px] font-semibold uppercase text-fg"
        style={{ fontFamily: "var(--font-dot)", letterSpacing: "1px" }}
      >
        All caught up<span style={{ color: "var(--good)" }}>.</span>
      </div>
      <div className="mx-auto mt-2 max-w-[380px] text-[13.5px] leading-[1.5] text-muted-fg">
        All {total} tracked goals are on pace or auto-tracked. Nothing needs you
        right now.
      </div>
    </div>
  );
}

function EmptyState({ title, body, ctaHref, ctaLabel }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-card/40 px-6 py-16 text-center">
      <div
        className="text-[22px] font-semibold uppercase text-fg"
        style={{ fontFamily: "var(--font-dot)", letterSpacing: "0.5px" }}
      >
        {title}
      </div>
      <div className="max-w-[420px] text-[13.5px] leading-[1.5] text-muted-fg">
        {body}
      </div>
      <Link href={ctaHref} className="mt-1">
        <Button>{ctaLabel}</Button>
      </Link>
    </div>
  );
}

function UnclassifiedNote({ count }) {
  return (
    <div
      className="rounded-md border border-border bg-card px-4 py-2.5 text-[11.5px] text-muted-fg"
      style={{ fontFamily: "var(--font-mono)" }}
    >
      {count} goal{count === 1 ? "" : "s"} not yet classified — open the analyst
      (top-right) to make {count === 1 ? "it" : "them"} trackable.
    </div>
  );
}
