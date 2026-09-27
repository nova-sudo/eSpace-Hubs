/**
 * Demo account seed — replaces ONE user's goal tree with a showcase that
 * exercises every widget kind in ALL_SPEC_KINDS (incl. every label / ticket-type / query-template path) plus the four
 * state shells (untrackable, pending approval, delegated, context needed),
 * and fills the manual widgets with sample entries so nothing renders empty.
 *
 * Writes (scoped to the target user): goals (upsert), goal_specs,
 * goal_context, goal_inputs. Every spec goes through the shared
 * validateSpec — the same gate the web app applies on read — and the
 * script aborts before writing anything if one fails.
 *
 * Only deletes its own DEMO-* sample entries (so re-runs stay idempotent). Run it on a wiped account (see
 * wipe-user-data.mjs) or the old specs/inputs will sit alongside.
 *
 * Usage:
 *   node apps/api/scripts/seed-demo-account.mjs <email>
 *   env: MONGO_URI, MONGO_DB_NAME (default devhub)
 */

import { MongoClient } from "mongodb";
import { validateSpec, ALL_SPEC_KINDS } from "@espace-devhub/shared/goal-specs";

const EMAIL = process.argv[2];
const URI = process.env.MONGO_URI;
const DB = process.env.MONGO_DB_NAME || "devhub";
if (!EMAIL || !URI) {
  console.error("usage: MONGO_URI=... node seed-demo-account.mjs <email>");
  process.exit(1);
}

// The labelled seed repo (see seed-label-goals-demo.mjs). Search does not follow
// repo renames, so this must be the current name (eSpaceDev → eSpace-Hubs).
const REPO = "nova-sudo/espace-hubs";
const YEAR = new Date().getFullYear();
const DAY = 86400000;
const now = Date.now();
const ago = (d) => new Date(now - d * DAY);
const iso = (d) => ago(d).toISOString();
const ymd = (d) => iso(d).slice(0, 10);

const TIERS = (na, a, oa, rm) => ({ notAchieved: na, achieved: a, overAchieved: oa, roleModel: rm });

// ─── Goal tree + specs ──────────────────────────────────────────────
// Each L2 row: [code, title, weight, spec-without-goalId/title, inputs?, context?]

const L1S = [
  {
    code: "DEMO-DLV",
    title: "Delivery throughput — code review & PR flow",
    weightage: 20,
    l2s: [
      ["DEMO-DLV-01", "Merge 60 pull requests this cycle", 20, {
        kind: "auto", widget: "MERGED_COUNT",
        source: { provider: "combined", metric: "merged_count", window: "quarter", target: { op: ">=", value: 60 } },
        tiers: TIERS("< 40 merged", "60 merged", "75 merged", "90+ merged"),
        tierScale: { unit: "PRs", direction: "higher", achieved: 60, overAchieved: 75, roleModel: 90 },
      }],
      ["DEMO-DLV-02", "Keep average review rounds at or under 2", 15, {
        kind: "auto", widget: "REVIEW_ROUNDS",
        source: { provider: "combined", metric: "avg_rounds", window: "90d", target: { op: "<=", value: 2 } },
        tierScale: { unit: "rounds", direction: "lower", achieved: 2, overAchieved: 1.5, roleModel: 1 },
      }],
      ["DEMO-DLV-03", "Median PR turnaround under 24 hours", 15, {
        kind: "auto", widget: "TURNAROUND",
        source: { provider: "github", metric: "median_turnaround", window: "30d", target: { op: "<=", value: 24 } },
      }],
      ["DEMO-DLV-04", "Link 95% of PRs to a Jira ticket", 15, {
        kind: "auto", widget: "LINKAGE",
        source: { provider: "combined", metric: "linkage_pct", window: "90d", target: { op: ">=", value: 95 } },
      }],
      ["DEMO-DLV-05", "85% of PRs approved on first review", 15, {
        kind: "auto", widget: "FIRST_PASS_RATE",
        source: { provider: "combined", metric: "first_pass_rate", window: "quarter", target: { op: ">=", value: 85 } },
      }],
      ["DEMO-DLV-06", "Grade PR quality against the team rubric", 20, {
        kind: "auto", widget: "CODE_RUBRIC", firstReviewOnly: true,
        context: { required: true, questions: [
          { id: "quality-standards", kind: "list", prompt: "Which quality standards should each PR be graded against?" },
        ] },
      }, null, { "quality-standards": [
        "Has tests covering the change",
        "No lint or type errors",
        "PR description explains the why",
        "Follows the feature-slice import rules",
      ] }],
    ],
  },
  {
    code: "DEMO-OPS",
    title: "Reliability & delivery pipeline",
    weightage: 20,
    l2s: [
      ["DEMO-OPS-01", "Resolve tickets within 5 days (cycle time)", 20, {
        kind: "auto", widget: "TICKET_CYCLE",
        source: { provider: "jira", metric: "ticket_cycle_time", window: "90d", target: { op: "<=", value: 5 } },
      }],
      ["DEMO-OPS-02", "Deploy to production at least weekly", 20, {
        kind: "auto", widget: "DEPLOY_FREQUENCY",
        source: { provider: "github_actions", metric: "deploy_frequency", window: "30d", filter: { repo: REPO }, target: { op: ">=", value: 4 } },
      }],
      ["DEMO-OPS-03", "Commit-to-deploy lead time under 48h", 20, {
        kind: "auto", widget: "LEAD_TIME",
        source: { provider: "github_actions", metric: "lead_time", window: "30d", filter: { repo: REPO }, target: { op: "<=", value: 48 } },
      }],
      ["DEMO-OPS-04", "Keep CI build pass rate at 90%+", 20, {
        kind: "auto", widget: "BUILD_PASS_RATE",
        source: { provider: "github_actions", metric: "build_pass_rate", window: "30d", filter: { repo: REPO }, target: { op: ">=", value: 90 } },
      }],
      ["DEMO-OPS-05", "Restore environments within 2 hours of an incident", 20, {
        kind: "manual", widget: "INCIDENT_LOG",
        manual: { prompt: "Log each environment incident with its restoration time.", cadence: "quarterly", unit: "minutes", target: { op: "<=", value: 120, period: "quarterly" } },
      }, [
        { d: 70, value: { severity: "P2", downtime: 95, rca: "Expired TLS cert on staging", action: "Renewed and added expiry alert", preventive: "closed", resolvedAt: iso(70), writeUpAt: iso(69) } },
        { d: 30, value: { severity: "P1", downtime: 140, rca: "DB disk full on QA", action: "Expanded volume, added retention job", preventive: "open", resolvedAt: iso(30), writeUpAt: iso(28) } },
        { d: 9, value: { severity: "P3", downtime: 40, rca: "Bad env var after deploy", action: "Rolled back", preventive: "closed", resolvedAt: iso(9), writeUpAt: iso(9) } },
      ]],
    ],
  },
  {
    code: "DEMO-QLT",
    title: "Quality & defects",
    weightage: 15,
    l2s: [
      ["DEMO-QLT-01", "Keep post-delivery defects at 3 or fewer per quarter", 25, {
        kind: "manual", widget: "INCIDENT_LOG",
        manual: { prompt: "Log each defect found after delivery.", cadence: "quarterly", unit: "defects", target: { op: "<=", value: 3, period: "quarterly" } },
      }, [
        { d: 40, value: { severity: "P3", rca: "Missed edge case in date picker", action: "Added regression test", preventive: "closed" } },
        { d: 12, value: { severity: "P2", rca: "Export crashed on empty goals", action: "Guarded empty state", preventive: "open" } },
        { d: 5, value: { deliverables: 14 } },
      ]],
      ["DEMO-QLT-02", "Cut flaky test count from baseline", 25, {
        kind: "manual", widget: "BEFORE_AFTER",
        manual: { prompt: "Record the flaky-test count at the start and now.", cadence: "monthly", unit: "flaky tests", target: { op: "<=", value: 5 } },
      }, [
        { d: 120, value: { baseline: 23, current: 23 } },
        { d: 3, value: { baseline: 23, current: 7 } },
      ]],
      ["DEMO-QLT-03", "Self-rated code review quality", 25, {
        kind: "manual", widget: "SCALE",
        manual: { prompt: "How well did you review this month? (1–5)", cadence: "monthly" },
      }, [{ d: 60, value: 3 }, { d: 30, value: 4 }, { d: 2, value: 4 }]],
      ["DEMO-QLT-04", "Overall quality scorecard", 25, {
        kind: "hybrid", widget: "SCORECARD", source: null, manual: null,
        scorecard: { aggregate: "weighted", components: [
          { label: "First-pass rate", weight: 50, widget: "FIRST_PASS_RATE", kind: "auto",
            source: { provider: "combined", metric: "first_pass_rate", window: "quarter", target: { op: ">=", value: 85 } } },
          { label: "Bugs fixed", weight: 30, widget: "COUNTER", kind: "manual",
            manual: { prompt: "Bugs you fixed", cadence: "monthly", unit: "bugs", target: { op: ">=", value: 10 } } },
          { label: "Quality self-rating", weight: 20, widget: "SCALE", kind: "manual",
            manual: { prompt: "Rate your quality this month (1–5)", cadence: "monthly" } },
        ] },
      }, [
        { goalSuffix: "::sc1", d: 20, value: 4 },
        { goalSuffix: "::sc1", d: 6, value: 3 },
        { goalSuffix: "::sc2", d: 4, value: 4 },
      ]],
    ],
  },
  {
    code: "DEMO-GRW",
    title: "Growth, knowledge sharing & AI adoption",
    weightage: 15,
    l2s: [
      ["DEMO-GRW-01", "Deliver 6 knowledge-sharing sessions", 15, {
        kind: "manual", widget: "COUNTER",
        manual: { prompt: "Log each session you ran.", cadence: "quarterly", unit: "sessions", target: { op: ">=", value: 6 } },
      }, [{ d: 80, value: 1 }, { d: 50, value: 1 }, { d: 22, value: 2 }]],
      ["DEMO-GRW-02", "Log every mentoring 1:1", 15, {
        kind: "manual", widget: "DATE_LOG",
        manual: { prompt: "Log the date of each mentoring 1:1.", cadence: "monthly", unit: "sessions", target: { op: ">=", value: 12 } },
      }, [45, 31, 17, 3].map((d) => ({ d, value: iso(d), note: "1:1 with junior dev" }))],
      ["DEMO-GRW-03", "Weekly learning journal", 15, {
        kind: "manual", widget: "FREE_TEXT",
        manual: { prompt: "What did you learn this week?", cadence: "weekly" },
      }, [
        { d: 14, value: "Went deep on Next.js cache components and PPR." },
        { d: 7, value: "Paired on the scheduler; learned how idempotency stamps work." },
      ]],
      ["DEMO-GRW-04", "Complete the certification roadmap", 15, {
        kind: "manual", widget: "MILESTONE",
        manual: { prompt: "Tick off each certification step.", cadence: "milestone", items: ["Pick certification", "Finish course", "Pass practice exam", "Pass exam"] },
      }, [{ d: 10, value: { items: [
        { id: "m1", label: "Pick certification", done: true },
        { id: "m2", label: "Finish course", done: true, evidence: "https://example.com/certificate" },
        { id: "m3", label: "Pass practice exam", done: false },
        { id: "m4", label: "Pass exam", done: false },
      ] } }]],
      ["DEMO-GRW-05", "Monthly engineering hygiene checklist", 15, {
        kind: "manual", widget: "RECURRING_MILESTONE",
        manual: { prompt: "Complete the checklist each month.", cadence: "monthly", items: ["Update dependencies", "Triage stale PRs", "Review alerts"] },
      }, [1, 0].map((m) => {
        const dt = new Date(); dt.setMonth(dt.getMonth() - m);
        const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
        return { d: m * 30 + 1, value: { periodKey: key, items: [
          { id: "r1", label: "Update dependencies", done: true },
          { id: "r2", label: "Triage stale PRs", done: m === 1 },
          { id: "r3", label: "Review alerts", done: m === 1 },
        ] } };
      })],
      ["DEMO-GRW-06", "70% of PRs AI-assisted (Claude Code)", 25, {
        kind: "auto", widget: "ASSISTED_SHARE",
        source: { provider: "combined", metric: "assisted_share", window: "quarter", target: { op: ">=", value: 70 } },
      }],
    ],
  },
  {
    code: "DEMO-SIG",
    title: "GitHub labels, tickets & repo queries",
    weightage: 15,
    l2s: [
      ["DEMO-SIG-01", "Fix at least 5 bug PRs this year (label count)", 10, {
        kind: "auto", widget: "LABEL_SHARE",
        source: { provider: "github", metric: "label_share", window: "90d", filter: { repo: REPO }, labels: ["bug"], labelMode: "count", target: { op: ">=", value: 5 } },
        tierScale: { unit: "bug PRs", direction: "higher", achieved: 5, overAchieved: 8, roleModel: 12 },
      }],
      ["DEMO-SIG-02", "Keep hotfixes under 10% of merged PRs (label share)", 10, {
        kind: "auto", widget: "LABEL_SHARE",
        source: { provider: "github", metric: "label_share", window: "90d", filter: { repo: REPO }, labels: ["hotfix"], target: { op: "<=", value: 10 } },
        tierScale: { unit: "%", direction: "lower", achieved: 10, overAchieved: 5, roleModel: 2 },
      }],
      ["DEMO-SIG-03", "40% of merged PRs are feature work (several labels)", 10, {
        kind: "auto", widget: "LABEL_SHARE",
        source: { provider: "combined", metric: "label_share", window: "quarter", labels: ["feature", "enhancement"], target: { op: ">=", value: 40 } },
      }],
      ["DEMO-SIG-04", "Track refactor PRs (label picked from my PRs)", 10, {
        kind: "auto", widget: "LABEL_SHARE",
        source: { provider: "github", metric: "label_share", window: "90d", filter: { repo: REPO } },
        context: { required: true, questions: [
          { id: "labels", kind: "label_select", prompt: "Which PR labels should this goal count?" },
        ] },
      }, null, { labels: ["refactor"] }],
      ["DEMO-SIG-05", "Track a label of your choosing (pick it now)", 10, {
        kind: "auto", widget: "LABEL_SHARE",
        source: { provider: "github", metric: "label_share", window: "90d", filter: { repo: REPO } },
        context: { required: true, questions: [
          { id: "labels", kind: "label_select", prompt: "Which PR labels should this goal count?" },
        ] },
      }],
      ["DEMO-SIG-06", "Ship 80% of PRs with Claude Code (named assistant label)", 10, {
        kind: "auto", widget: "ASSISTED_SHARE",
        source: { provider: "github", metric: "assisted_share", window: "90d", filter: { repo: REPO }, labels: ["claude-code-assisted"], target: { op: ">=", value: 80 } },
      }],
      ["DEMO-SIG-07", "Copilot-assisted share (legacy single-label filter)", 10, {
        kind: "auto", widget: "ASSISTED_SHARE",
        source: { provider: "combined", metric: "assisted_share", window: "30d", filter: { label: "copilot" }, target: { op: ">=", value: 30 } },
      }],
      ["DEMO-SIG-08", "Merge PRs against Jira Bug tickets (ticket type)", 10, {
        kind: "auto", widget: "TICKET_TYPE_SHARE",
        source: { provider: "github", metric: "ticket_type_share", window: "90d", filter: { repo: REPO, ticketType: "bug" } },
      }],
      ["DEMO-SIG-09", "Half of merged PRs deliver Jira Stories (ticket type)", 10, {
        kind: "auto", widget: "TICKET_TYPE_SHARE",
        source: { provider: "combined", metric: "ticket_type_share", window: "quarter", filter: { ticketType: "Story" }, target: { op: ">=", value: 50 } },
      }],
      ["DEMO-SIG-10", "Repo hygiene tracker (fields read from GitHub)", 10, {
        kind: "manual", widget: "COMPOSED", source: null, manual: null,
        composed: { cadence: "monthly", prompt: "This month's repo check — the GitHub fields fill themselves." },
        fields: [
          { id: "bug-prs", kind: "counter", label: "Bug-labelled PRs I merged this year", unit: "PRs",
            source: { provider: "github", query: "pr_label_count", params: { repo: REPO, label: "bug" }, extract: "count" } },
          { id: "docs-prs", kind: "counter", label: "PRs mentioning docs", unit: "PRs",
            source: { provider: "github", query: "pr_search_count", params: { repo: REPO, search_query: "docs" }, extract: "count" } },
          { id: "open-prs", kind: "counter", label: "Open PRs right now", unit: "PRs",
            source: { provider: "github", query: "open_pr_count", params: { repo: REPO }, extract: "count" } },
          { id: "agents-md", kind: "checkbox", label: "AGENTS.md present in the repo",
            source: { provider: "github", query: "repo_file_exists", params: { repo: REPO, path: "AGENTS.md" }, extract: "exists" } },
          { id: "readme-updated", kind: "date", label: "README last updated",
            source: { provider: "github", query: "repo_file_updated", params: { repo: REPO, path: "README.md" }, extract: "latest_date" } },
          { id: "note", kind: "text", label: "Anything worth noting", optional: true },
        ],
      }],
    ],
  },
  {
    code: "DEMO-PLN",
    title: "Quarterly plan & workflow states",
    weightage: 15,
    l2s: [
      ["DEMO-PLN-01", "Quarterly delivery plan (composed)", 40, {
        kind: "manual", widget: "COMPOSED", source: null, manual: null,
        fields: [
          { id: "shipped", kind: "checkbox", label: "Planned release shipped" },
          { id: "features", kind: "counter", label: "Features delivered", unit: "features", target: { op: ">=", value: 3 } },
          { id: "confidence", kind: "scale", label: "Delivery confidence" },
          { id: "coverage", kind: "number", label: "Test coverage", unit: "%", target: { op: ">=", value: 80 } },
          { id: "summary", kind: "text", label: "Quarter summary", optional: true },
          { id: "demo", kind: "date", label: "Stakeholder demo date" },
          { id: "status", kind: "select", label: "Overall status", options: ["On track", "At risk", "Off track"] },
          { id: "doc", kind: "link", label: "Release notes link", optional: true },
          { id: "openprs", kind: "counter", label: "Open PRs right now",
            source: { provider: "github", query: "open_pr_count", params: { repo: REPO }, extract: "count" } },
        ],
        composed: {
          cadence: "quarterly",
          prompt: "Fill in this quarter's delivery plan.",
          cycleStart: `${YEAR}-01-01`, cycleEnd: `${YEAR}-12-31`,
          notes: [{ kind: "risk", label: "Key dependency on platform team", likelihood: "medium", impact: "high", mitigation: "Weekly sync with platform lead" }],
          periods: [1, 2, 3, 4].map((q) => ({
            key: `${YEAR}-Q${q}`, label: `Q${q}`,
            detail: {
              focus: ["Foundations", "Core features", "Hardening", "Polish & handover"][q - 1],
              activities: ["Plan scope with PM", "Build and review", "Demo to stakeholders"],
              deliverables: [{ label: `Q${q} release`, format: "Release notes", criteria: "Shipped to production" }],
            },
          })),
        },
      }, [1, 2, 3].map((q) => ({ d: (3 - q) * 90 + 20, value: {
        periodKey: `${YEAR}-Q${q}`,
        values: { shipped: true, features: 2 + q, confidence: 3 + (q % 2), coverage: 70 + q * 4, summary: `Q${q} went as planned.`, demo: `${YEAR}-${String(q * 3).padStart(2, "0")}-20`, status: q === 3 ? "At risk" : "On track" },
        evidence: { doc: "https://example.com/release-notes" },
      } }))],
      ["DEMO-PLN-02", "Architecture review participation (pending approval)", 15, {
        kind: "manual", widget: "COUNTER",
        manual: { prompt: "Log each architecture review you joined.", cadence: "monthly", unit: "reviews", target: { op: ">=", value: 6 } },
        approval: { status: "pending", submittedAt: iso(2) },
      }],
      ["DEMO-PLN-03", "Team collaboration (judged by manager)", 15, {
        kind: "manual", widget: "SCALE",
        manual: { prompt: "Manager rates collaboration (1–5).", cadence: "quarterly" },
        delegated: { delegated: true, judge: "manager", note: "Rated by the line manager at each quarterly review." },
      }],
      ["DEMO-PLN-04", "Client satisfaction score (not trackable yet)", 15, {
        kind: "manual", widget: "SCALE",
        manual: { prompt: "Client CSAT (1–5).", cadence: "quarterly" },
        untrackable: { reason: "The client survey tool has no export yet — parked until it does." },
      }],
      ["DEMO-PLN-05", "Ship the onboarding milestones (needs context)", 15, {
        kind: "manual", widget: "MILESTONE",
        manual: { prompt: "Tick off each onboarding milestone.", cadence: "milestone" },
        context: { required: true, questions: [
          { id: "milestones", kind: "list", prompt: "Which milestones make up this goal?" },
          { id: "owner", kind: "select", prompt: "Who signs off?", options: ["Me", "Manager", "Client"] },
        ] },
      }],
    ],
  },
];

// ─── Build + validate everything before touching the DB ─────────────

const tree = [];
const specs = [];
const inputs = [];
const contexts = [];
const errors = [];

for (const l1 of L1S) {
  const l2s = [];
  for (const [code, title, weightage, raw, rows, answers] of l1.l2s) {
    l2s.push({ id: code, code, title, description: "", rubric: "", weightage, priority: "medium", startDate: `${YEAR}-01-01`, dueDate: `${YEAR}-12-31`, category: "" });
    const res = validateSpec({ schemaVersion: 1, reasoning: "Demo account seed", classifiedAt: now, ...raw, goalId: code, title });
    if (!res.ok) { errors.push(`${code}: ${res.errors.join("; ")}`); continue; }
    specs.push(res.spec);
    for (const r of rows || []) {
      inputs.push({ goalId: code + (r.goalSuffix || ""), ts: ago(r.d), value: r.value, note: r.note ?? null, source: "manual" });
    }
    if (answers) contexts.push({ goalId: code, answers });
  }
  tree.push({ id: l1.code, code: l1.code, title: l1.title, description: "", rubric: "", weightage: l1.weightage, category: "", l2s });
}

if (errors.length) {
  console.error("[seed] spec validation failed — nothing written:\n  " + errors.join("\n  "));
  process.exit(1);
}
const covered = new Set(specs.map((s) => s.widget));
const missing = ALL_SPEC_KINDS.filter((k) => !covered.has(k));
if (missing.length) {
  console.error(`[seed] widget kinds not covered: ${missing.join(", ")}`);
  process.exit(1);
}

if (process.argv.includes("--dry-run")) {
  for (const s of specs) console.log(s.goalId.padEnd(12), s.widget.padEnd(20), s.kind.padEnd(7), [s.approval && "approval:" + s.approval.status, s.delegated?.delegated && "delegated", s.untrackable && "untrackable", s.context?.required && "context", s.scorecard && "sc" + s.scorecard.components.length, s.composed && "periods" + s.composed.periods?.length, s.fields && "fields" + s.fields.length, s.tierScale && "tierScale"].filter(Boolean).join(" "));
  if (process.argv.includes("--verbose")) for (const s of specs.filter((x) => x.goalId.startsWith("DEMO-SIG"))) console.log(s.goalId, JSON.stringify(s.source ?? s.fields.map((f) => f.source?.query ?? f.kind)));
  console.log(`[seed] dry run OK — ${specs.length} specs, ${covered.size}/${ALL_SPEC_KINDS.length} kinds, ${inputs.length} inputs`);
  process.exit(0);
}

// ─── Write ──────────────────────────────────────────────────────────

const client = new MongoClient(URI, { serverSelectionTimeoutMS: 10000 });
await client.connect();
try {
  const db = client.db(DB);
  const user = await db.collection("users").findOne({ email: { $regex: `^${EMAIL.replace(/[.+]/g, "\\$&")}$`, $options: "i" } });
  if (!user) throw new Error(`no user for ${EMAIL}`);
  const { _id: userId, orgId } = user;
  const at = new Date();

  await db.collection("goals").updateOne(
    { orgId, userId },
    { $set: { orgId, userId, schemaVersion: 2, l1s: tree, cycleId: null, updatedAt: at } },
    { upsert: true },
  );
  for (const spec of specs) {
    await db.collection("goal_specs").updateOne(
      { orgId, userId, goalId: spec.goalId },
      { $set: { orgId, userId, goalId: spec.goalId, spec, generatedAt: at, classifierVersion: "demo-seed" } },
      { upsert: true },
    );
  }
  for (const c of contexts) {
    await db.collection("goal_context").updateOne(
      { orgId, userId, goalId: c.goalId },
      { $set: { orgId, userId, goalId: c.goalId, answers: c.answers, updatedAt: at } },
      { upsert: true },
    );
  }
  // Replace (not append) the seed's own sample entries so a re-run stays idempotent.
  await db.collection("goal_inputs").deleteMany({ orgId, userId, goalId: { $regex: "^DEMO-" } });
  if (inputs.length) await db.collection("goal_inputs").insertMany(inputs.map((i) => ({ orgId, userId, ...i })));

  console.log(`[seed] ${EMAIL} (db ${DB})`);
  console.log(`[seed] L1s ${tree.length} · L2s ${specs.length} · widget kinds ${covered.size}/${ALL_SPEC_KINDS.length}`);
  console.log(`[seed] goal_context ${contexts.length} · goal_inputs ${inputs.length}`);
} finally {
  await client.close();
}
