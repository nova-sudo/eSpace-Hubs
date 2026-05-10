/**
 * Demo-mode goal data — L1/L2 tree, AI-classified specs, and pre-seeded
 * widget entries that demonstrate compliance over time.
 *
 * Why this file exists
 * ────────────────────
 * The dashboard's Goals tab is the headline of the perf-review story —
 * "look at how we tracked your performance for a year". Without seeded
 * widget entries the demo dashboard shows empty manual widgets (Counter,
 * Scale, Milestone, etc.) and the user can't see the "97% on target"
 * compliance message until they manually click +1 ten times.
 *
 * This module pre-seeds all four layers in one place:
 *
 *   1. **Goals tree** — L1s with weightages + categories, L2s with
 *      cycles, descriptions, rubrics, and IDs that stay stable across
 *      builds (so the spec / input maps below key off them).
 *
 *   2. **Specs** — what the AI analyst would have classified each goal
 *      as. Every widget kind is exercised at least once. The reasoning
 *      strings match the analyst's tone so users who toggle demo on
 *      can't tell whether they were AI-generated or hand-written.
 *
 *   3. **Inputs** — pre-seeded time-series entries on the manual
 *      widgets, sized so they trigger the "interesting" compliance
 *      values. Counter (mentor 3h/week) hits ~97% to match the user
 *      example. Scale shows a flat 4.0 average. Milestone shows 2/4
 *      done. DateLog has 5 sessions across 4 months. Etc.
 *
 *   4. **Context answers** — the rubric criteria the user would
 *      otherwise have to type for the CODE_RUBRIC widget.
 *
 * Each store hook (`useGoals`, `useGoalSpecs`, `useGoalInputs`,
 * `useGoalContext`) short-circuits to this data ONLY when:
 *   - demo mode is on, AND
 *   - the user has no real data of their own in that store.
 *
 * That isolation is what lets the user toggle demo on/off without
 * shadowing or wiping their real performance work.
 */

import { SPEC_KINDS } from "@/features/goal-specs";

const NOW_MS = Date.now();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;

/**
 * Jan 1 of the current year (00:00 UTC). All entry seeding anchors here:
 * a perf-review story runs "from cycle start to now", so the dashboard's
 * year-to-date chips need data reaching back that far. Anchoring on the
 * literal Jan-1 boundary keeps the demo coherent with calendar quarters
 * (Q1, Q2, etc.) and makes "since-last-review" compare cleanly when the
 * user sets that date in Settings.
 */
const YEAR_START_MS = (() => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), 0, 1)).getTime();
})();

const WEEKS_SINCE_YEAR_START = Math.max(
  1,
  Math.floor((NOW_MS - YEAR_START_MS) / WEEK),
);

/**
 * 1-based calendar months elapsed since Jan 1 (inclusive of current month).
 * April 29 → 4 (Jan/Feb/Mar/Apr).
 */
const MONTHS_SINCE_YEAR_START = (() => {
  const d = new Date();
  return d.getUTCMonth() + 1;
})();

/**
 * UTC midnight at the start of month N of the current year (1-based).
 * monthStart(1) = Jan 1, monthStart(2) = Feb 1, …
 */
function monthStartMs(monthIndex1Based) {
  const d = new Date();
  return new Date(
    Date.UTC(d.getUTCFullYear(), monthIndex1Based - 1, 1),
  ).getTime();
}

/**
 * Timestamp for week N of the current year (1-based, week 1 starts Jan 1).
 * Used to seed weekly entries that align cleanly with the cadence buckets.
 * Returns the midpoint of the week so the entry doesn't skirt the boundary.
 */
function weekMidpointMs(weekIndex1Based) {
  return YEAR_START_MS + (weekIndex1Based - 1) * WEEK + WEEK / 2;
}

/**
 * Stable IDs for every demo goal. The spec / input / context maps below
 * key off these. Keep the ID set monotonic across builds so existing
 * demo localStorage data stays addressable.
 */
const GID = Object.freeze({
  // L1
  L1_DELIVERY: "demo-l1-delivery",
  L1_PROCESS: "demo-l1-process",
  L1_GROWTH: "demo-l1-growth",
  L1_LEADERSHIP: "demo-l1-leadership",
  // L2 — delivery
  SHIP_PRS: "demo-l2-ship-prs",
  TURNAROUND: "demo-l2-turnaround",
  CODE_QUALITY: "demo-l2-code-quality",
  LINKAGE: "demo-l2-linkage",
  // L2 — process
  TIGHT_ROUNDS: "demo-l2-tight-rounds",
  TICKETS_DONE: "demo-l2-tickets-done",
  RUNBOOKS: "demo-l2-runbooks",
  // L2 — growth
  MENTOR: "demo-l2-mentor",
  CONFIDENCE: "demo-l2-confidence",
  TECH_BOOK: "demo-l2-tech-book",
  REFLECTION: "demo-l2-reflection",
  // L2 — leadership
  DESIGN_REVIEWS: "demo-l2-design-reviews",
  ONCALL_RESPONSE: "demo-l2-oncall-response",
  SUCCESSION: "demo-l2-succession",
});

/* ────────────────────────────── 1. TREE ────────────────────────────── */

export function buildDemoGoals() {
  return {
    l1s: [
      {
        id: GID.L1_DELIVERY,
        title: "Deliver high-quality code at a senior pace",
        category: "delivery",
        weightage: 35,
        description:
          "Ship features the team can rely on. Volume matters less than predictability — keep the cadence steady, the reviews tight, and the linkage discipline visible.",
        rubric:
          "Not achieved: misses cycle / Achieved: meets quarterly cadence / Over: ships ahead and lifts others / Role model: sets the team standard.",
        l2s: [
          l2(GID.SHIP_PRS, "Ship at least 8 merged PRs this quarter", {
            category: "delivery",
            priority: "high",
            weightage: 30,
            description:
              "PR volume is the simplest delivery proxy. Cap at quarterly so seasonal slumps don't drag the year average.",
          }),
          l2(GID.TURNAROUND, "Keep median review turnaround under 36 hours", {
            category: "delivery",
            priority: "high",
            weightage: 25,
            description:
              "Lower review turnaround unblocks teammates. Measured open → merge across all my MRs.",
          }),
          l2(GID.CODE_QUALITY, "Code meets agreed quality standards", {
            category: "quality",
            priority: "high",
            weightage: 30,
            description:
              "Each merged PR should hold to the team's quality bar — clear description, addressed reviewer concerns, no orphan TODOs.",
            rubric:
              "Reviewer concerns explicitly resolved · Description explains the why · No 'address later' threads left open.",
          }),
          l2(GID.LINKAGE, "Maintain Jira linkage above 90%", {
            category: "process",
            priority: "medium",
            weightage: 15,
            description:
              "Every merged change traces back to a tracked ticket. Keeps the project history defensible at review time.",
          }),
        ],
      },
      {
        id: GID.L1_PROCESS,
        title: "Drive impact through clear engineering process",
        category: "process",
        weightage: 20,
        description:
          "Make the path from idea to merged change shorter for everyone — by example, not by edict.",
        l2s: [
          l2(GID.TIGHT_ROUNDS, "Average ≤2 reviewer comments per merged MR", {
            category: "process",
            priority: "medium",
            weightage: 35,
            description:
              "A proxy for clean small PRs that don't need much back-and-forth.",
          }),
          l2(GID.TICKETS_DONE, "Resolve assigned tickets within sprint", {
            category: "process",
            priority: "medium",
            weightage: 35,
            description:
              "Carryover discipline — finish what's planned before pulling new work.",
          }),
          l2(GID.RUNBOOKS, "Document one runbook per quarter", {
            category: "process",
            priority: "low",
            weightage: 30,
            description:
              "Pick one operational gap per quarter and write the runbook. Cumulative — every documented surface stays for future on-calls.",
          }),
        ],
      },
      {
        id: GID.L1_GROWTH,
        title: "Grow as a senior engineer",
        category: "growth",
        weightage: 25,
        description:
          "Investments in your craft + your people. Easy to defer, hard to recover at review time.",
        l2s: [
          l2(GID.MENTOR, "Log at least 3 mentoring hours per week", {
            category: "growth",
            priority: "high",
            weightage: 35,
            description:
              "Pairing, 1:1s, code-walkthroughs, or any teammate-facing time investment. Counts only once it's actually happened.",
          }),
          l2(GID.CONFIDENCE, "Self-rate engineering confidence weekly", {
            category: "growth",
            priority: "medium",
            weightage: 20,
            description:
              "1-5 scale. Weekly check-in. Trend matters more than a single rating.",
          }),
          l2(GID.TECH_BOOK, "Read one technical book per month", {
            category: "growth",
            priority: "low",
            weightage: 20,
            description:
              "Log the book + finish date. Pure cadence proxy — don't game the cadence by skim-reading.",
          }),
          l2(GID.REFLECTION, "Capture biggest technical lessons", {
            category: "growth",
            priority: "medium",
            weightage: 25,
            description:
              "Free-text journal. One entry per significant decision, learning, or surprise.",
          }),
        ],
      },
      {
        id: GID.L1_LEADERSHIP,
        title: "Demonstrate technical leadership",
        category: "people",
        weightage: 20,
        description:
          "Visible influence beyond your own code. Signals readiness for senior+ track.",
        l2s: [
          l2(GID.DESIGN_REVIEWS, "Lead at least 4 design reviews this year", {
            category: "leadership",
            priority: "high",
            weightage: 40,
            description:
              "Run-the-meeting, write-the-doc level — not just attend. Counted monthly so a Q4 catch-up still helps.",
          }),
          l2(
            GID.ONCALL_RESPONSE,
            "Reduce on-call incident response time",
            {
              category: "process",
              priority: "high",
              weightage: 35,
              description:
                "Self-reported baseline (avg minutes-to-acknowledge at start of cycle) vs current. Lower is better.",
            },
          ),
          l2(GID.SUCCESSION, "Succession-readiness assessed by manager", {
            category: "leadership",
            priority: "medium",
            weightage: 25,
            description:
              "Quarterly performance-panel evaluation by management. Tracked here as delegated — the user doesn't self-rate this one.",
          }),
        ],
      },
    ],
  };
}

function l2(id, title, extra = {}) {
  return {
    id,
    title,
    category: extra.category || null,
    priority: extra.priority || null,
    weightage: extra.weightage ?? null,
    description: extra.description || "",
    rubric: extra.rubric || "",
    startDate: extra.startDate || null,
    dueDate: extra.dueDate || null,
  };
}

/* ────────────────────────────── 2. SPECS ────────────────────────────── */

export function buildDemoSpecs() {
  const classifiedAt = NOW_MS - 2 * DAY;
  return {
    specs: {
      // ─── Auto widgets ───────────────────────────────────────────────
      [GID.SHIP_PRS]: spec(GID.SHIP_PRS, "Ship at least 8 merged PRs this quarter", {
        kind: "auto",
        widget: SPEC_KINDS.MERGED_COUNT,
        reasoning:
          "Goal explicitly references PR count and a quarterly cadence — straight MERGED_COUNT widget pulling from GitHub.",
        source: {
          provider: "github",
          metric: "merged_count",
          window: "quarter",
          target: { op: ">=", value: 8 },
        },
      }),
      [GID.TURNAROUND]: spec(
        GID.TURNAROUND,
        "Keep median review turnaround under 36 hours",
        {
          kind: "auto",
          widget: SPEC_KINDS.TURNAROUND,
          reasoning:
            "Median open→merge duration is a TURNAROUND auto-metric. Target is 36 hours; we'll show the median as days but compare in hours.",
          source: {
            provider: "github",
            metric: "median_turnaround",
            window: "90d",
            target: { op: "<=", value: 36 },
          },
        },
      ),
      [GID.CODE_QUALITY]: spec(GID.CODE_QUALITY, "Code meets agreed quality standards", {
        kind: "auto",
        widget: SPEC_KINDS.CODE_RUBRIC,
        reasoning:
          "‘Quality standards' must be user-defined. CODE_RUBRIC widget — auto-grades each merged PR against the user's rubric, captured below as context.",
        source: null,
        manual: null,
        context: {
          required: true,
          questions: [
            {
              id: "quality-standards",
              prompt:
                "Which standards should the AI grade each merged PR against?",
              kind: "list",
              placeholder:
                "e.g. clear description · concerns addressed · no orphan TODOs",
            },
          ],
        },
      }),
      [GID.LINKAGE]: spec(GID.LINKAGE, "Maintain Jira linkage above 90%", {
        kind: "auto",
        widget: SPEC_KINDS.LINKAGE,
        reasoning:
          "Direct match — % of merged MRs whose title/branch references a Jira key.",
        source: {
          provider: "combined",
          metric: "linkage_pct",
          window: "90d",
          target: { op: ">=", value: 90 },
        },
      }),
      [GID.TIGHT_ROUNDS]: spec(
        GID.TIGHT_ROUNDS,
        "Average ≤2 reviewer comments per merged MR",
        {
          kind: "auto",
          widget: SPEC_KINDS.REVIEW_ROUNDS,
          reasoning:
            "Average reviewer comments per MR — REVIEW_ROUNDS auto-metric. Lower is tighter.",
          source: {
            provider: "github",
            metric: "avg_rounds",
            window: "90d",
            target: { op: "<=", value: 2 },
          },
        },
      ),
      [GID.TICKETS_DONE]: spec(
        GID.TICKETS_DONE,
        "Resolve assigned tickets within sprint",
        {
          kind: "auto",
          widget: SPEC_KINDS.TICKET_CYCLE,
          reasoning:
            "Ticket cycle time from Jira. Assigned-to-me view, sprint-bounded.",
          source: {
            provider: "jira",
            metric: "ticket_cycle_time",
            window: "30d",
          },
        },
      ),

      // ─── Manual widgets ─────────────────────────────────────────────
      [GID.RUNBOOKS]: spec(GID.RUNBOOKS, "Document one runbook per quarter", {
        kind: "manual",
        widget: SPEC_KINDS.MILESTONE,
        reasoning:
          "Quarterly milestones, cumulative across the year. MILESTONE widget — list of runbooks the user wants to document, checked off as written.",
        manual: {
          prompt: "Which runbooks did you write this cycle?",
          cadence: "quarterly",
          items: [
            "On-call rotation handoff",
            "Settlement webhook replay",
            "Auth-broker rotation procedure",
            "Database failover drill",
          ],
        },
      }),
      [GID.MENTOR]: spec(GID.MENTOR, "Log at least 3 mentoring hours per week", {
        kind: "manual",
        widget: SPEC_KINDS.COUNTER,
        reasoning:
          "No API tracks mentoring time. COUNTER widget, weekly cadence, target ≥3 hours.",
        manual: {
          prompt: "How many hours did you spend on mentoring activities this week?",
          cadence: "weekly",
          unit: "hours",
          target: { op: ">=", value: 3 },
        },
      }),
      [GID.CONFIDENCE]: spec(GID.CONFIDENCE, "Self-rate engineering confidence weekly", {
        kind: "manual",
        widget: SPEC_KINDS.SCALE,
        reasoning:
          "Subjective self-assessment. SCALE widget, 1-5, weekly cadence.",
        manual: {
          prompt: "How confident did you feel in your engineering work this week?",
          cadence: "weekly",
        },
      }),
      [GID.TECH_BOOK]: spec(GID.TECH_BOOK, "Read one technical book per month", {
        kind: "manual",
        widget: SPEC_KINDS.DATE_LOG,
        reasoning:
          "Cadence-bound completion log. DATE_LOG widget, monthly cadence.",
        manual: {
          prompt: "Which book did you finish — and when?",
          cadence: "monthly",
        },
      }),
      [GID.REFLECTION]: spec(GID.REFLECTION, "Capture biggest technical lessons", {
        kind: "manual",
        widget: SPEC_KINDS.FREE_TEXT,
        reasoning:
          "Free-text journal entries. No cadence enforcement; the user reflects when something noteworthy happens.",
        manual: {
          prompt: "What did you learn this period?",
          cadence: "continuous",
        },
      }),
      [GID.DESIGN_REVIEWS]: spec(
        GID.DESIGN_REVIEWS,
        "Lead at least 4 design reviews this year",
        {
          kind: "manual",
          widget: SPEC_KINDS.COUNTER,
          reasoning:
            "Annual count target. COUNTER widget, monthly cadence (so a Q4 burst still counts), target 4 over the year.",
          manual: {
            prompt: "How many design reviews did you lead this month?",
            cadence: "monthly",
            unit: "reviews",
            target: { op: ">=", value: 1 }, // 1/month sustains 12/yr → 4 minimum easily met
          },
        },
      ),
      [GID.ONCALL_RESPONSE]: spec(
        GID.ONCALL_RESPONSE,
        "Reduce on-call incident response time",
        {
          kind: "manual",
          widget: SPEC_KINDS.BEFORE_AFTER,
          reasoning:
            "Pre/post measurement. BEFORE_AFTER widget — capture baseline at cycle start, current at any time.",
          manual: {
            prompt:
              "What's your baseline-vs-now on average minutes to acknowledge an alert?",
            cadence: "per-incident",
          },
        },
      ),
      [GID.SUCCESSION]: spec(
        GID.SUCCESSION,
        "Succession-readiness assessed by manager",
        {
          kind: "manual",
          widget: SPEC_KINDS.MILESTONE,
          reasoning:
            "Performance-panel evaluation by management. Marked delegated so the dashboard doesn't ask the user to self-track.",
          manual: {
            prompt: "Light placeholder — judged externally by the panel.",
            cadence: "quarterly",
            items: ["Q1 panel", "Q2 panel", "Q3 panel", "Q4 panel"],
          },
          delegated: {
            delegated: true,
            judge: "manager",
            note: "Reviewed during quarterly performance panel",
          },
        },
      ),
    },
    lastAnalyzedAt: classifiedAt,
  };
}

function spec(goalId, title, fields) {
  return {
    goalId,
    title,
    kind: fields.kind,
    widget: fields.widget,
    reasoning: fields.reasoning,
    source: fields.source ?? null,
    manual: fields.manual ?? null,
    context: fields.context ?? null,
    delegated: fields.delegated ?? null,
    classifiedAt: NOW_MS - 2 * DAY,
  };
}

/* ────────────────────────────── 3. INPUTS ────────────────────────────── */

/**
 * Pre-seeded entries on each manual widget — anchored to **Jan 1 of the
 * current year** so the demo tells a year-to-date story.
 *
 *   - Mentor counter:        ~17 weekly entries (Jan-now), 96% compliance
 *   - Confidence scale:      ~17 weekly ratings, 4.1 avg
 *   - Tech book log:         one book per elapsed month (4 if Apr, 6 if Jun…)
 *   - Reflection free-text:  6 reflective entries spread across the cycle
 *   - Runbooks milestone:    2 of 4 done — current snapshot
 *   - Design reviews counter: 1-2 entries per elapsed month (monthly cadence)
 *   - On-call before/after:  baseline captured early Jan, current = now
 *   - Succession milestone:  Q1 panel done; later quarters pending
 *
 * Every entry's `ts` is bounded between Jan-1 and now — switching the
 * dashboard's date-range chip to "YTD" / "Year" / "Quarter" shows the
 * data; flipping to "30d" / "Week" sees the recent slice.
 */
export function buildDemoInputs() {
  const out = {};

  // ── Mentor: one entry per week from Jan 1 → now ──────────────────────
  // Spread evenly through the year. Most weeks at 3, a couple at 2 (so
  // partial credit kicks in), one missed week (the missed slot becomes
  // 0 in the compliance bucket because `firstTs → now` covers it
  // regardless of whether an entry exists). On April 29 (week 17) this
  // computes to (15*1 + 2*0.667 + 0) / 17 = 16.333/17 = 96%.
  out[GID.MENTOR] = mentorWeeks();

  // ── Confidence scale: one rating per week from Jan 1 → now ───────────
  out[GID.CONFIDENCE] = confidenceWeeks();

  // ── Tech book log: one book per elapsed month ────────────────────────
  out[GID.TECH_BOOK] = techBookMonths();

  // ── Reflections: 6 entries spread across the cycle ──────────────────
  out[GID.REFLECTION] = reflections();

  // ── Runbooks milestone: 2 of 4 items done as of mid-Apr ──────────────
  out[GID.RUNBOOKS] = [
    e(monthStartMs(Math.max(2, MONTHS_SINCE_YEAR_START)) + 4 * DAY, {
      items: [
        { id: "runbook-oncall-handoff", label: "On-call rotation handoff", done: true },
        { id: "runbook-settlement-replay", label: "Settlement webhook replay", done: true },
        { id: "runbook-auth-rotation", label: "Auth-broker rotation procedure", done: false },
        { id: "runbook-db-failover", label: "Database failover drill", done: false },
      ],
    }),
  ];

  // ── Design reviews counter: 1-2 per elapsed month, monthly cadence ──
  out[GID.DESIGN_REVIEWS] = designReviewsMonths();

  // ── On-call before/after: baseline Jan, current snapshot now ─────────
  // Baseline captured first week of Jan; current is "now".
  out[GID.ONCALL_RESPONSE] = [
    e(YEAR_START_MS + 5 * DAY, {
      baseline: 24,
      current: 8,
      unit: "minutes to acknowledge",
    }),
  ];

  // ── Succession milestone: Q1 done, Q2 in progress, Q3+Q4 pending ─────
  // Delegated by manager — quarterly cadence aligned with calendar.
  out[GID.SUCCESSION] = [
    e(monthStartMs(Math.min(MONTHS_SINCE_YEAR_START, 4)) + 2 * DAY, {
      items: [
        { id: "panel-q1", label: "Q1 panel", done: MONTHS_SINCE_YEAR_START >= 4 },
        { id: "panel-q2", label: "Q2 panel", done: MONTHS_SINCE_YEAR_START >= 7 },
        { id: "panel-q3", label: "Q3 panel", done: MONTHS_SINCE_YEAR_START >= 10 },
        { id: "panel-q4", label: "Q4 panel", done: MONTHS_SINCE_YEAR_START >= 13 },
      ],
    }),
  ];

  return out;
}

/* ── per-widget seeding helpers ── */

/**
 * Mentor counter: one entry per week of the year. Picks 2 "partial"
 * weeks (logged 2 hours instead of 3) and 1 missed week scattered
 * deterministically through the cycle so the compliance reads ~96% but
 * doesn't look gamed (perfect 100% would feel suspicious).
 */
function mentorWeeks() {
  const PARTIAL_WEEKS = new Set([5, 11]); // Feb-week-5 + Apr-week-11 if year is long enough
  const MISSED_WEEKS = new Set([8]); // a missed week somewhere in March
  const out = [];
  for (let w = 1; w <= WEEKS_SINCE_YEAR_START; w++) {
    if (MISSED_WEEKS.has(w) && WEEKS_SINCE_YEAR_START > 10) continue; // skip — missed
    const value = PARTIAL_WEEKS.has(w) && WEEKS_SINCE_YEAR_START > 10 ? 2 : 3;
    out.push(e(weekMidpointMs(w), value));
  }
  return out;
}

/**
 * Confidence scale: one rating per week. Slight upward arc (3 → 4 → 5)
 * across the year so the trend reads "growing confidence", with a few
 * regressions to keep it honest.
 */
function confidenceWeeks() {
  // Pattern that loops, mostly 3-4 with occasional 5s and one 2.
  const PATTERN = [3, 4, 3, 4, 4, 3, 4, 4, 5, 4, 3, 4, 5, 4, 4, 5, 2, 4, 4, 5];
  const out = [];
  for (let w = 1; w <= WEEKS_SINCE_YEAR_START; w++) {
    const value = PATTERN[(w - 1) % PATTERN.length];
    out.push(e(weekMidpointMs(w), value));
  }
  return out;
}

/**
 * Tech books: one book finished per elapsed month of the cycle.
 * Reads as "5 logged" by April, "9 logged" by September, etc.
 */
function techBookMonths() {
  const TITLES = [
    "Site Reliability Engineering",
    "Designing Data-Intensive Applications",
    "An Elegant Puzzle",
    "The Manager's Path",
    "Database Internals",
    "Designing Distributed Systems",
    "Accelerate",
    "The Pragmatic Programmer",
    "Domain-Driven Design",
    "Clean Architecture",
    "A Philosophy of Software Design",
    "Software Engineering at Google",
  ];
  const out = [];
  for (let m = 1; m <= MONTHS_SINCE_YEAR_START; m++) {
    const ts = monthStartMs(m) + 24 * DAY; // ~end of month
    const title = TITLES[(m - 1) % TITLES.length];
    const finishedAt = new Date(ts).toISOString().slice(0, 10);
    out.push(e(ts, { title, finishedAt }));
  }
  return out;
}

/**
 * Free-text reflections: 6 entries spread across the cycle, each tied
 * to a real-feeling demo PR or incident.
 */
function reflections() {
  const months = MONTHS_SINCE_YEAR_START;
  const fractions = [0.1, 0.25, 0.4, 0.55, 0.75, 0.9];
  const reflections = [
    "Big lesson from the settlement webhook outage: idempotency keys are cheap insurance, retries without them are roulette. Wrote up the post-mortem.",
    "Pairing on the OAuth scope-error refactor reminded me how much faster the design conversation goes when the rubric is in writing first. Next RFC starts with the rubric.",
    "The PSP backpressure RFC is teaching me how much I default to 'block' over 'drop'. Need to spend more time with the trade-offs before committing to a default.",
    "Mentoring Boris through the ledger-side webhook signing showed me how much my own intuition about clean-API design comes from naming things three times before settling.",
    "Lost a half-day debugging a flaky integration test that turned out to be a real race condition. Worth slowing down on flake-rejection — sometimes the test is right.",
    "Design review I led last week landed on a smaller scope than the doc proposed. Felt good — saying 'we shouldn't do this part' is a senior-engineer move I'm getting more comfortable with.",
  ];
  const out = [];
  for (let i = 0; i < reflections.length; i++) {
    const ts = YEAR_START_MS + months * MONTH * fractions[i];
    if (ts > NOW_MS) break;
    out.push(e(ts, reflections[i]));
  }
  return out;
}

/**
 * Design reviews counter: 1-2 entries per elapsed month. Cadence is
 * monthly with target ≥1/month, so compliance reads ~80-100% depending
 * on month coverage.
 */
function designReviewsMonths() {
  const out = [];
  // Pattern: most months 1, occasional months 2, one month skipped to
  // give compliance a non-perfect reading.
  const SKIP_MONTHS = new Set([2]); // skip Feb if year long enough
  const DOUBLE_MONTHS = new Set([Math.max(1, MONTHS_SINCE_YEAR_START - 1)]); // last full month had 2

  for (let m = 1; m <= MONTHS_SINCE_YEAR_START; m++) {
    if (SKIP_MONTHS.has(m) && MONTHS_SINCE_YEAR_START > 3) continue;
    const ts = monthStartMs(m) + 12 * DAY;
    if (ts > NOW_MS) continue;
    out.push(e(ts, 1));
    if (DOUBLE_MONTHS.has(m)) {
      out.push(e(ts + 10 * DAY, 1));
    }
  }
  return out;
}

function e(ts, value, note) {
  // Inputs are stored as { goalId, ts, value, note? }. The goalId is
  // injected when the inputs hook reads from this map (it knows the key).
  return { ts, value, note };
}

/* ────────────────────────────── 4. CONTEXT ────────────────────────────── */

/**
 * Pre-filled answers to spec.context.questions — currently only the
 * CODE_RUBRIC goal needs context (rubric criteria the AI grades each PR
 * against). Returns the full per-goalId map; `useGoalContext` looks up
 * by goal id.
 */
export function buildDemoContext() {
  return {
    [GID.CODE_QUALITY]: {
      "quality-standards": [
        "PR description explains the why, not just the what",
        "Every reviewer concern is acknowledged or addressed",
        "No 'address later' threads left dangling",
        "Tests cover the happy path AND at least one edge case",
      ],
      __updatedAt: NOW_MS - 2 * DAY,
    },
  };
}

/* Goal IDs publicly available so hook callers can detect "this is a demo
   goal" cheaply (string-prefix check). Used by useGoalInputs etc. */
export const DEMO_GOAL_ID_PREFIX = "demo-l";
