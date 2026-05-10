/**
 * Curated test L1 / L2 tree.
 *
 * Goal: when run through the AI Analyst, every widget kind + every
 * special state (delegated, context-required) gets exercised at least
 * once. Useful for:
 *   - Manual QA when iterating on the classifier prompt
 *   - Demos: load → classify → all 12 widget types appear in section 5
 *   - Catching regressions ("did we break MILESTONE seeding?")
 *
 * Coverage matrix (one L2 per widget):
 *   AUTO         · MERGED_COUNT, REVIEW_ROUNDS, TURNAROUND, LINKAGE,
 *                  TICKET_CYCLE, CODE_RUBRIC
 *   MANUAL       · COUNTER, SCALE, MILESTONE, DATE_LOG, FREE_TEXT,
 *                  BEFORE_AFTER
 *   SPECIAL      · DELEGATED (one L2 written to trip the manager-judged
 *                  detector), CONTEXT-REQUIRED (CODE_RUBRIC triggers it
 *                  via "agreed quality standards")
 *
 * Phrasing is deliberately keyword-rich so the classifier's prompt can
 * pick the intended widget with high confidence. If the classifier
 * starts misclassifying any of these, the prompt — not the data — is
 * the bug surface.
 *
 * Total: 4 L1s, 13 L2s, weights summing to 100%.
 */

const CYCLE_START = "2026-04-01";
const CYCLE_END = "2026-06-30";

let counter = 0;
function id(prefix) {
  counter += 1;
  return `${prefix}-test-${counter}-${Math.random().toString(36).slice(2, 7)}`;
}

function l2(partial) {
  return {
    id: id("l2"),
    code: "",
    title: "",
    description: "",
    rubric: "",
    weightage: 0,
    priority: "",
    startDate: CYCLE_START,
    dueDate: CYCLE_END,
    category: "",
    ...partial,
  };
}

/**
 * Build a fresh test tree. Wraps the L1 / L2 records with new ids on each
 * call so loading twice in the same session doesn't collide with the
 * first load's localStorage entries.
 */
export function getTestGoals() {
  counter = 0;
  return {
    l1s: [
      // ── L1 #1 — Delivery & code quality ─────────────────────────────
      {
        id: id("l1"),
        code: "TEST-DELIVERY",
        title: "Deliver high-quality code at predictable velocity",
        description:
          "Ship work that the team can trust on first review and that meets defined quality standards.",
        rubric:
          "- Achieved: hits the quantitative targets across PR count, turnaround, linkage, and quality\n- Over: clears every target by 20%+\n- Role model: drives team-wide adherence (eg. helps others meet rubric)",
        weightage: 35,
        category: "delivery",
        l2s: [
          // → MERGED_COUNT
          l2({
            code: "TEST-DELIVERY-L2-01",
            title: "Ship at least 8 merged PRs to main per quarter",
            description:
              "Counts merged PRs authored by me across the connected GitHub repos. Excludes drafts and dependabot bumps. Cycle window is the quarter.",
            rubric:
              "- Achieved: ≥ 8 merged PRs\n- Over: ≥ 12 merged PRs\n- Role model: ≥ 16 merged PRs and zero rolled back",
            weightage: 30,
            priority: "high",
            category: "delivery",
          }),
          // → TURNAROUND
          l2({
            code: "TEST-DELIVERY-L2-02",
            title: "Median PR turnaround under 8 hours from open to merge",
            description:
              "Measured as the median time between PR open and PR merge across my authored PRs in the window. Excludes drafts.",
            rubric:
              "- Achieved: median ≤ 8h\n- Over: median ≤ 4h\n- Role model: median ≤ 2h with zero PR open > 24h",
            weightage: 25,
            priority: "medium",
            category: "delivery",
          }),
          // → LINKAGE
          l2({
            code: "TEST-DELIVERY-L2-03",
            title: "Maintain 95%+ Jira linkage on merged PRs",
            description:
              "Every PR title or branch name must reference a Jira ticket key (eg. ESD-123). Tracks the linkage % across the merged-PR set in the window.",
            rubric:
              "- Achieved: ≥ 95%\n- Over: ≥ 98%\n- Role model: 100% with zero orphan merges",
            weightage: 20,
            priority: "medium",
            category: "delivery",
          }),
          // → CODE_RUBRIC (triggers context-required)
          l2({
            code: "TEST-DELIVERY-L2-04",
            title:
              "Maintain ≤10% post-delivery defects following the team's agreed quality standards",
            description:
              "Each merged PR is graded by the AI against our team's agreed quality standards. Pass rate over the window should stay above 90%.",
            rubric:
              "- Achieved: ≥ 90% pass rate AND post-delivery defects ≤ 10%\n- Over: ≥ 95% with documented RCA on every failure\n- Role model: 100% pass + drives the rubric updates for the team",
            weightage: 25,
            priority: "high",
            category: "quality",
          }),
        ],
      },

      // ── L1 #2 — Engineering excellence ──────────────────────────────
      {
        id: id("l1"),
        code: "TEST-EXCELLENCE",
        title: "Raise engineering excellence across review and delivery",
        description:
          "Tighten review feedback loops and the velocity of work moving through the pipeline.",
        rubric:
          "- Achieved: hits reviewer-coverage and cycle-time targets\n- Over: drives team-wide improvement on the same metrics",
        weightage: 25,
        category: "quality",
        l2s: [
          // → REVIEW_ROUNDS
          l2({
            code: "TEST-EXCELLENCE-L2-01",
            title: "Keep PR review rounds below 2.0 on average",
            description:
              "Tracks average reviewer comments per merged PR. Lower is tighter — fewer back-and-forths usually means clearer first drafts.",
            rubric:
              "- Achieved: average ≤ 2.0\n- Over: average ≤ 1.5\n- Role model: average ≤ 1.0 across 90d window",
            weightage: 35,
            priority: "medium",
            category: "quality",
          }),
          // → TICKET_CYCLE
          l2({
            code: "TEST-EXCELLENCE-L2-02",
            title:
              "Move Jira tickets through the pipeline — average cycle time under 3 days",
            description:
              "Measured as average days a Jira ticket spends from In Progress to Done. Excludes Backlog dwell time.",
            rubric:
              "- Achieved: avg ≤ 3d\n- Over: avg ≤ 2d\n- Role model: avg ≤ 1d with no ticket > 5d",
            weightage: 30,
            priority: "medium",
            category: "delivery",
          }),
          // → MILESTONE
          l2({
            code: "TEST-EXCELLENCE-L2-03",
            title: "Complete the HexaCore v1 ship checklist (6 deliverables)",
            description:
              "Six concrete deliverables must land before the v1 cut: scroll shell, AI Analyst, widget registry, code-rubric grading, evidence export, and the inverse-themed section 5.",
            rubric:
              "- Achieved: all 6 done by cycle end\n- Over: all 6 + bonus polish (animations, telemetry)\n- Role model: 6 + drove cross-team adoption",
            weightage: 35,
            priority: "high",
            category: "delivery",
          }),
        ],
      },

      // ── L1 #3 — People & mentorship ─────────────────────────────────
      {
        id: id("l1"),
        code: "TEST-PEOPLE",
        title: "Grow the team — mentor, share, and model the bar",
        description:
          "Sustained investment in others' growth, not just my own delivery output.",
        rubric:
          "- Achieved: weekly cadence on mentoring + knowledge-share\n- Over: peers explicitly cite this as growth-driving\n- Role model: visible team-wide impact",
        weightage: 20,
        category: "people",
        l2s: [
          // → COUNTER
          l2({
            code: "TEST-PEOPLE-L2-01",
            title: "Log at least 3 mentoring hours per week",
            description:
              "Counts hours spent in 1:1 mentoring sessions, pair-coding with juniors, or async code review with explicit teaching focus.",
            rubric:
              "- Achieved: ≥ 3 hours/week sustained\n- Over: ≥ 5 hours/week\n- Role model: ≥ 5 hours/week + visible improvement in mentees' work",
            weightage: 35,
            priority: "medium",
            category: "people",
          }),
          // → DATE_LOG
          l2({
            code: "TEST-PEOPLE-L2-02",
            title: "Lead a weekly engineering knowledge-share session",
            description:
              "Run one focused 30-minute session per week — could be a tech deep-dive, a post-mortem walkthrough, or a tooling demo. Log the date and topic of each session.",
            rubric:
              "- Achieved: 1 session per work-week, no gaps > 14d\n- Over: 1+ session/week with documented attendance\n- Role model: builds an internal speaker rotation",
            weightage: 30,
            priority: "medium",
            category: "people",
          }),
          // → FREE_TEXT
          l2({
            code: "TEST-PEOPLE-L2-03",
            title:
              "Maintain a learning journal — one entry per week reflecting on what shipped",
            description:
              "Free-form weekly reflection on what shipped, what stuck, what I'd do differently. Sets up the evidence for end-of-cycle review.",
            rubric:
              "- Achieved: 1 entry per week, no missing weeks\n- Over: weekly entries that other engineers reference\n- Role model: thread the journal into team-wide retros",
            weightage: 35,
            priority: "low",
            category: "people",
          }),
        ],
      },

      // ── L1 #4 — Growth & leadership ─────────────────────────────────
      {
        id: id("l1"),
        code: "TEST-GROWTH",
        title: "Demonstrate growth across skill, alignment, and readiness",
        description:
          "Tangible movement on personal skill development and on the leadership signals my manager evaluates.",
        rubric:
          "- Achieved: visible movement on each skill + positive manager feedback\n- Over: takes on stretch assignments\n- Role model: manager flags as ready for next role",
        weightage: 20,
        category: "people",
        l2s: [
          // → SCALE
          l2({
            code: "TEST-GROWTH-L2-01",
            title: "Self-rate alignment with team OKRs weekly on a 1–5 scale",
            description:
              "Weekly self-assessment of how aligned my work is with the team's quarterly OKRs. 1 = drift, 5 = laser-aligned. Tracks the trend over the cycle.",
            rubric:
              "- Achieved: average ≥ 3.5 over the cycle\n- Over: ≥ 4.0 with weekly cadence\n- Role model: ≥ 4.5 + flag drift for the team early",
            weightage: 30,
            priority: "low",
            category: "people",
          }),
          // → BEFORE_AFTER
          l2({
            code: "TEST-GROWTH-L2-02",
            title: "Move my Python proficiency from mid (3) to senior (4)",
            description:
              "Baseline self-rating today is 3 (mid). Target is 4 (senior — leads design discussions, mentors others on the language). Rated on the team's standard 1–5 proficiency scale.",
            rubric:
              "- Achieved: self-rated 4 by cycle end + one Python-led project shipped\n- Over: rated 4+ with peer concurrence\n- Role model: rated 5",
            weightage: 30,
            priority: "medium",
            category: "people",
          }),
          // → DELEGATED (judged by manager)
          l2({
            code: "TEST-GROWTH-L2-03",
            title:
              "Demonstrate succession readiness — evaluated by manager during the quarterly review",
            description:
              "Tracked outside the dashboard: my manager assesses succession readiness for the senior role during our quarterly review. Not a self-tracked metric.",
            rubric:
              "- Achieved: manager flags 'ready in 6 months'\n- Over: 'ready now, holding for slot'\n- Role model: peer-evaluated as already operating at next level",
            weightage: 40,
            priority: "high",
            category: "people",
          }),
        ],
      },
    ],
  };
}
