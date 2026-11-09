/**
 * GitHub-links demo seed — the GitHub layer on top of seed-demo-account.mjs.
 * Gives ONE account a published COMPOSED tracker whose periods are real
 * GitHub issues in every state the feature knows about, so the widget chips,
 * the Evidence "Linked on GitHub" card, the 1:1 thread and the correlation
 * report all have something to show.
 *
 * Usage:
 *   node apps/api/scripts/seed-github-demo.mjs <email> --repo owner/name [--manager <email>] [--dry-run]
 *   env: MONGO_URI, MONGO_DB_NAME (default devhub),
 *        GITHUB_TOKEN          (the DEVELOPER's token; required unless --dry-run)
 *        GITHUB_MANAGER_TOKEN  (optional; posts the manager's comments — falls back to GITHUB_TOKEN)
 *
 *   Token: classic PAT with `repo` (or `public_repo` for a public repo), or a
 *   fine-grained token on that repo with Issues, Pull requests and Contents
 *   = read & write. The repo should be a throwaway demo repo with at least one
 *   commit and issues enabled — this script creates issues, a branch, a commit
 *   and merges a demo PR into the side branch `espace-demo/base` (never the
 *   default branch).
 *
 * Writes (scoped to the target user; found again by code, so re-runs update
 * instead of duplicating):
 *   goals          L1 "DEMO-GH" with two L2s (replaced in place on re-run)
 *   goal_specs     DEMO-GH-01  monthly COMPOSED plan, 7 authored periods, two
 *                              fields read from the period's own issue
 *                              (issue_state → closed, issue_tasklist → ratio)
 *                  DEMO-GH-02  weekly COMPOSED plan, 6 periods, left
 *                              UNPUBLISHED so the demo can press "Publish"
 *   github_links   one `linked` row per published DEMO-GH-01 period, keyed by
 *                  the same idempotencyKey publish.ts computes — a real publish
 *                  later adopts them instead of creating duplicates
 *   goal_inputs    one `source: "github"` reading per completed-closed period,
 *                  plus manual entries for periods 0 and 4 (DEMO-GH-* only)
 *   evidence       the merged PR starred as `mr-gh-<prId>`
 *   with --manager (must be the target's users.managerId):
 *     manager_report_notes         one note shared with the report
 *     manager_goal_verdict_events  a grade for period 0 (+ the current
 *     manager_goal_verdicts        projection), both posted as issue comments
 *     assigned_goals               DEMO-GH-SH, assigned to the target, with
 *                                  `github` requested and no links — the
 *                                  "Your manager asked for GitHub issues" callout
 *
 * GitHub (skipped with --dry-run; every write ≥ 1 s apart):
 *   labels `espace` + `espace:DEMO-GH-01`; one issue per published period
 *   (existing marker-matched issues are reused); then the mix below; a
 *   developer reply on period 2; branch + commit + PR "Closes #<p0>", merged.
 *
 *   period 0  closed completed, every box ticked, merged PR   → no flag
 *   period 1  closed completed, no evidence                    → closed_no_evidence
 *   period 2  open, 1/3 ticked, past due, dev reply + 1:1 note  → open_past_deadline
 *   period 3  closed not_planned                               → no flag, no reading
 *   period 4  NOT published, has a manual entry                → evidence_no_issue
 *   period 5+ open, untouched (future)                         → no flag
 *
 * --dry-run does everything except the network: issue numbers, URLs and
 * states are fabricated. Those links point nowhere real — the hourly sync
 * will mark them missing (issue_missing) on its next pass.
 */

import { createHash } from "node:crypto";
import { MongoClient, ObjectId } from "mongodb";
import { assignedWindows, resolvePeriodContent, validateSpec } from "@espace-devhub/shared/goal-specs";
import {
  buildCommentMarker,
  buildIssueBody,
  buildIssueTitle,
  ESPACE_LABEL,
  ESPACE_LABEL_COLOR,
  espaceLabel,
  extractClosingRefs,
  parseCommentMarker,
  parseMarker,
  taskListProgress,
} from "@espace-devhub/shared/github-links";

// ─── args ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flagValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null;
};
const EMAIL = args.find((a, i) => !a.startsWith("--") && !["--repo", "--manager"].includes(args[i - 1]));
const REPO = (flagValue("--repo") || "").toLowerCase();
const MANAGER_EMAIL = flagValue("--manager");
const DRY = args.includes("--dry-run");
const URI = process.env.MONGO_URI;
const DB = process.env.MONGO_DB_NAME || "devhub";
const TOKEN = process.env.GITHUB_TOKEN || "";
const MANAGER_TOKEN = process.env.GITHUB_MANAGER_TOKEN || TOKEN;
const REPO_RE = /^[a-z0-9._-]+\/[a-z0-9._-]+$/;

if (!EMAIL || !URI || !REPO) {
  console.error(
    "usage: MONGO_URI=... [MONGO_DB_NAME=devhub] GITHUB_TOKEN=... node apps/api/scripts/seed-github-demo.mjs <email> --repo owner/name [--manager <email>] [--dry-run]",
  );
  process.exit(1);
}
if (!REPO_RE.test(REPO) || REPO.includes("..")) {
  console.error(`[gh-seed] --repo must be owner/name, got "${REPO}"`);
  process.exit(1);
}
if (!DRY && !TOKEN) {
  console.error("[gh-seed] GITHUB_TOKEN is required unless --dry-run");
  process.exit(1);
}

// ─── time + plan ─────────────────────────────────────────────────────

const DAY = 86_400_000;
const NOW = new Date();
const nowMs = NOW.getTime();
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
const monthStart = (offset) => Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() + offset, 1);

const L1_CODE = "DEMO-GH";
const GOAL_A = "DEMO-GH-01"; // published, monthly
const GOAL_B = "DEMO-GH-02"; // unpublished, weekly
const SHARED_CODE = "DEMO-GH-SH";
const CLASSIFIER = "seed:github-demo";
const PUBLISH_SKIP = new Set([4]); // left unpublished → evidence_no_issue
const PR_BRANCH = "espace-demo/demo-gh-01-period-0";
const DEMO_BASE = "espace-demo/base"; // PRs merge here, never into the default branch

// DEMO-GH-01: seven months, four in the past, the current one, two ahead.
const A_START = monthStart(-4);
const A_END = monthStart(3) - DAY;
const A_PHASES = [
  ["Discovery", "Map the API surface and agree the issue format with the team",
    ["Interview two teams on how they track goals", "Read the GitHub REST issue + timeline docs", "Draft the marker format"],
    [["Integration RFC", "Markdown doc in the repo", "reviewed by two engineers"], ["Marker spec", "Section of the RFC", "round-trips through parseMarker"], ["Risk list", "Table in the RFC", "every risk has an owner"]]],
  ["Publish flow", "Create one issue per period, idempotently",
    ["Implement claim-first publish", "Add crash-recovery adoption", "Load-test with 50 periods"],
    [["Publish endpoint", "Merged PR", "unit tests cover retry and double-click"], ["Adoption by marker", "Merged PR", "a killed publish recovers without duplicates"]]],
  ["Read-back sync", "Mirror issue state, task list and linked PRs hourly",
    ["Hourly scheduler job", "Timeline + closing-ref parsing", "Comment mirroring"],
    [["Sync job", "Merged PR", "runs hourly behind GITHUB_LINKS_SYNC"], ["Linked PRs on the chip", "Merged PR", "merged PR shows on the period chip"], ["Runbook", "docs/ page", "on-call can disable sync in one step"]]],
  ["Manager thread", "Let a manager post notes and grades to the issue",
    ["Comment markers", "Manager-only post endpoint", "Idempotent posts"],
    [["Comment endpoint", "Merged PR", "a re-post never duplicates"], ["Thread UI", "Screenshot in the PR", "manager sees replies inline"]]],
  ["Correlation report", "Join both layers per period and flag gaps",
    ["Flag rules with tests", "Manager report surface", "Evidence card"],
    [["Correlation endpoint", "Merged PR", "all five flags covered by tests"], ["Report board column", "Merged PR", "flags render for a manager"], ["Demo script", "Recorded walkthrough", "shared with the team"]]],
  ["Hardening", "Rate limits, token loss, deleted issues",
    ["Chaos-test the sync", "Reconnect flow", "Audit trail review"],
    [["Failure drills", "Checklist in docs", "each drill passed once"], ["Audit review", "Notes doc", "signed off by security"]]],
  ["Rollout", "Turn it on for every team",
    ["Enable per org", "Office hours", "Collect feedback"],
    [["Rollout note", "Email + changelog", "sent to all leads"], ["Feedback summary", "Doc", "top three asks triaged"]]],
];

function monthlyPeriods() {
  const probe = { widget: "COMPOSED", composed: { cadence: "monthly", cycleStart: ymd(A_START), cycleEnd: ymd(A_END), periods: A_PHASES.map(() => ({ label: "x" })) } };
  return assignedWindows(probe, nowMs).map((w, i) => {
    const [name, focus, activities, deliverables] = A_PHASES[i];
    return {
      key: w.key,
      label: `${w.label} — ${name}`,
      dueAt: ymd(w.end - DAY),
      detail: {
        focus,
        activities,
        deliverables: deliverables.map(([label, format, criteria]) => ({ label, format, criteria })),
      },
    };
  });
}

// DEMO-GH-02: six work weeks starting on the Sunday three weeks ago.
const thisSunday = Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), NOW.getUTCDate()) - NOW.getUTCDay() * DAY;
const B_START = thisSunday - 3 * 7 * DAY;
const B_END = B_START + 6 * 7 * DAY - DAY;
const B_PHASES = [
  ["Triage the backlog", ["Label every open bug", "Close duplicates"], [["Triaged board", "Jira filter", "no unlabelled bugs"], ["Duplicate report", "Comment on epic", "linked to originals"]]],
  ["Flaky tests", ["Quarantine the worst five", "Add retries with logging"], [["Quarantine PR", "Merged PR", "CI green three runs in a row"], ["Flake log", "Spreadsheet", "every flake has a cause"]]],
  ["Docs pass", ["Update the README", "Record a setup video"], [["README update", "Merged PR", "a new joiner sets up in < 30 min"], ["Setup video", "Loom link", "under 10 minutes"]]],
  ["Perf budget", ["Measure the dashboard", "Fix the top regression"], [["Perf report", "Doc", "p95 measured on three pages"], ["Fix PR", "Merged PR", "p95 back under budget"], ["Budget check", "CI step", "fails the build over budget"]]],
  ["Pairing week", ["Pair with two juniors", "Write up learnings"], [["Pairing log", "Notes", "two sessions logged"], ["Learnings post", "Team channel post", "posted and pinned"]]],
  ["Retro + plan", ["Run the retro", "Plan next cycle"], [["Retro notes", "Doc", "three actions with owners"], ["Next-cycle plan", "Tracker", "approved by the manager"]]],
];
function weeklyPeriods() {
  const probe = { widget: "COMPOSED", composed: { cadence: "weekly", cycleStart: ymd(B_START), cycleEnd: ymd(B_END), periods: B_PHASES.map(() => ({ label: "x" })) } };
  return assignedWindows(probe, nowMs).slice(0, B_PHASES.length).map((w, i) => {
    const [focus, activities, deliverables] = B_PHASES[i];
    return {
      key: w.key,
      label: `${w.label} — ${focus}`,
      dueAt: ymd(w.end - DAY),
      detail: { focus, activities, deliverables: deliverables.map(([label, format, criteria]) => ({ label, format, criteria })) },
    };
  });
}

function approved(manager) {
  return {
    status: "approved",
    submittedAt: nowMs - 30 * DAY,
    reviewedAt: nowMs - 29 * DAY,
    ...(manager ? { reviewedBy: manager._id.toHexString(), reviewedByName: manager.displayName || manager.email } : { reviewedByName: "Demo seed" }),
  };
}

function buildSpecs(manager) {
  const raw = [
    [GOAL_A, "Ship the GitHub integration (monthly plan, tracked on GitHub)", {
      kind: "manual", widget: "COMPOSED", source: null, manual: null,
      fields: [
        { id: "issue-closed", kind: "checkbox", label: "Period issue closed as done",
          source: { provider: "github", query: "issue_state", params: { repo: "{{ctx:__espace_gh_repo}}", issue: "{{ctx:__espace_gh_issue}}" }, extract: "closed" } },
        { id: "deliverables-done", kind: "number", label: "Share of the issue's deliverables ticked", unit: "ratio",
          target: { op: ">=", value: 1 },
          source: { provider: "github", query: "issue_tasklist", params: { repo: "{{ctx:__espace_gh_repo}}", issue: "{{ctx:__espace_gh_issue}}" }, extract: "ratio" } },
        { id: "demos", kind: "counter", label: "Demos given to the team", unit: "demos", target: { op: ">=", value: 1 } },
        { id: "summary", kind: "text", label: "What shipped this month", optional: true },
      ],
      composed: {
        cadence: "monthly",
        prompt: "This month's slice of the GitHub integration — the two GitHub fields read the period's own issue.",
        cycleStart: ymd(A_START), cycleEnd: ymd(A_END),
        notes: [{ kind: "risk", label: "GitHub rate limits during the hourly sync", likelihood: "medium", impact: "medium", mitigation: "Spacing + backoff; sync can be disabled with GITHUB_LINKS_SYNC=false" }],
        periods: monthlyPeriods(),
      },
      approval: approved(manager),
    }],
    [GOAL_B, "Engineering hygiene sprint (weekly plan, not yet on GitHub)", {
      kind: "manual", widget: "COMPOSED", source: null, manual: null,
      fields: [
        { id: "shipped", kind: "checkbox", label: "Week's deliverables shipped" },
        { id: "prs", kind: "counter", label: "PRs merged this week", unit: "PRs", target: { op: ">=", value: 3 } },
        { id: "note", kind: "text", label: "Notes", optional: true },
      ],
      composed: {
        cadence: "weekly",
        prompt: "Weekly hygiene check-in.",
        cycleStart: ymd(B_START), cycleEnd: ymd(B_END),
        periods: weeklyPeriods(),
      },
      approval: approved(manager),
    }],
  ];
  const errors = [];
  const specs = [];
  for (const [goalId, title, body] of raw) {
    const res = validateSpec({ schemaVersion: 1, reasoning: "Seeded for the GitHub demo — not AI-classified.", classifiedAt: nowMs, context: null, delegated: null, untrackable: null, scorecard: null, tiers: null, ...body, goalId, title });
    if (!res.ok) errors.push(`${goalId}: ${res.errors.join("; ")}`);
    else specs.push(res.spec);
  }
  return { specs, errors };
}

function buildSharedSpec() {
  const start = thisSunday - 7 * DAY;
  const end = start + 4 * 7 * DAY - DAY;
  const probe = { widget: "COMPOSED", composed: { cadence: "weekly", cycleStart: ymd(start), cycleEnd: ymd(end), periods: [1, 2, 3, 4].map(() => ({ label: "x" })) } };
  const focus = ["Agree the on-call rota", "Write the incident template", "Run a game day", "Retro the game day"];
  const periods = assignedWindows(probe, nowMs).slice(0, 4).map((w, i) => ({
    key: w.key,
    label: `${w.label} — ${focus[i]}`,
    dueAt: ymd(w.end - DAY),
    detail: {
      focus: focus[i],
      activities: ["Draft", "Review with the team"],
      deliverables: [
        { label: `${focus[i]} — doc`, format: "Markdown in the team repo", criteria: "reviewed by one peer" },
        { label: "Status update", format: "Team channel post", criteria: "posted by Thursday" },
      ],
    },
  }));
  const res = validateSpec({
    schemaVersion: 1, goalId: "asg_seed", kind: "manual", widget: "COMPOSED", title: "Demo · On-call readiness (publish to GitHub)",
    reasoning: "", source: null, manual: null, context: null, delegated: null, untrackable: null, scorecard: null, tiers: null,
    fields: [
      { id: "done", kind: "checkbox", label: "Week's deliverables done" },
      { id: "note", kind: "text", label: "What got done", optional: true },
    ],
    composed: { cadence: "weekly", cycleStart: ymd(start), cycleEnd: ymd(end), periods },
    classifiedAt: nowMs,
  });
  if (!res.ok) return { error: res.errors.join("; ") };
  const { goalId: _drop, ...spec } = res.spec; // assigned_goals store the spec without goalId
  return { spec };
}

// ─── mirrors of the API (publish.ts / sync.ts / comments.ts) ─────────

/** publish.ts idempotencyKey — byte for byte. */
function idempotencyKey(orgId, userId, goalId, periodIndex) {
  return createHash("sha256")
    .update(`v1|${orgId.toHexString()}|${userId.toHexString()}|${goalId}|${periodIndex}`)
    .digest("hex");
}

const toDate = (v) => {
  if (typeof v !== "string" || !v) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? new Date(ms) : null;
};
const isObj = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/** sync.ts reduceIssue. */
function reduceIssue(raw) {
  const labels = [];
  for (const l of Array.isArray(raw.labels) ? raw.labels : []) {
    const name = typeof l === "string" ? l : l?.name;
    if (typeof name === "string" && name) labels.push(name.slice(0, 100));
    if (labels.length >= 50) break;
  }
  const assignees = [];
  for (const a of Array.isArray(raw.assignees) ? raw.assignees : []) {
    if (typeof a?.login === "string" && a.login) assignees.push(a.login.slice(0, 100));
    if (assignees.length >= 20) break;
  }
  const tasks = taskListProgress(raw.body);
  return {
    issueState: raw.state === "closed" ? "closed" : "open",
    stateReason: typeof raw.state_reason === "string" ? raw.state_reason.slice(0, 40) : null,
    closedAt: toDate(raw.closed_at),
    updatedAt: toDate(raw.updated_at),
    title: typeof raw.title === "string" ? raw.title.slice(0, 300) : "",
    tasks: { done: tasks.done, total: tasks.total },
    labels,
    assignees,
    commentsCount: Number.isInteger(raw.comments) && raw.comments >= 0 ? raw.comments : 0,
    linkedPrs: [],
    comments: [],
  };
}

/** sync.ts reduceComments — drops eSpace's own posts and bots, newest 20. */
function reduceComments(raw) {
  const out = [];
  for (const c of Array.isArray(raw) ? raw : []) {
    if (!isObj(c)) continue;
    const user = isObj(c.user) ? c.user : null;
    if (!user || user.type === "Bot") continue;
    const login = typeof user.login === "string" ? user.login : "";
    if (!login) continue;
    const body = typeof c.body === "string" ? c.body : "";
    if (parseCommentMarker(body)) continue;
    const createdAt = toDate(c.created_at);
    if (!Number.isInteger(c.id) || c.id < 1 || !createdAt) continue;
    out.push({ commentId: c.id, author: login.slice(0, 100), body: body.slice(0, 2000), createdAt, url: typeof c.html_url === "string" ? c.html_url.slice(0, 500) : "" });
  }
  out.sort((a, b) => a.createdAt - b.createdAt);
  return out.slice(-20);
}

/** sync.ts reducePull — a PR read through the ISSUES endpoint (prId = issue id). */
function reducePull(raw, repo) {
  if (!isObj(raw) || !raw.pull_request) return null;
  if (!Number.isInteger(raw.id) || raw.id < 1 || !Number.isInteger(raw.number) || raw.number < 1) return null;
  const pr = isObj(raw.pull_request) ? raw.pull_request : {};
  const mergedAt = toDate(pr.merged_at ?? raw.merged_at);
  const url = typeof pr.html_url === "string" && pr.html_url ? pr.html_url : typeof raw.html_url === "string" ? raw.html_url : "";
  const user = isObj(raw.user) ? raw.user : null;
  return {
    repo,
    number: raw.number,
    prId: raw.id,
    url: url.slice(0, 500),
    title: typeof raw.title === "string" ? raw.title.slice(0, 300) : "",
    state: mergedAt ? "merged" : raw.state === "closed" ? "closed" : "open",
    mergedAt,
    author: typeof user?.login === "string" && user.login ? user.login.slice(0, 100) : null,
  };
}

/** sync.ts reduceTimelinePrRefs. */
function timelinePrRefs(events, repo) {
  const seen = new Set();
  const out = [];
  for (const ev of Array.isArray(events) ? events : []) {
    if (!isObj(ev) || (ev.event !== "cross-referenced" && ev.event !== "connected")) continue;
    const source = isObj(ev.source) ? ev.source : null;
    const issue = source && isObj(source.issue) ? source.issue : isObj(ev.subject) ? ev.subject : null;
    if (!issue || !issue.pull_request || !Number.isInteger(issue.number) || issue.number < 1) continue;
    const full = isObj(issue.repository) && typeof issue.repository.full_name === "string" ? issue.repository.full_name.toLowerCase() : repo;
    const k = `${full}#${issue.number}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ repo: full, number: issue.number });
  }
  return out;
}

/** comments.ts commentDate + render*Comment — same text a real post makes. */
const commentDate = (d) => d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
const TIER_LABEL = { not_achieved: "Not achieved", achieved: "Achieved", over_achieved: "Over achieved", role_model: "Role model" };
function withMarker(text, kind, sourceId) {
  const marker = buildCommentMarker(kind, sourceId);
  return `${text.trim().slice(0, 60_000 - marker.length - 2)}\n\n${marker}`;
}
const renderTierVerdictComment = (ev) => {
  const label = TIER_LABEL[ev.tier] ?? ev.tier;
  const note = (ev.note ?? "").trim();
  const head = note ? `**Tier:** ${label} — ${note}` : `**Tier:** ${label}`;
  return withMarker(`${head}\n\n_Graded by ${ev.gradedByName || "their manager"} on ${commentDate(ev.gradedAt)} in eSpace_`, "tier_verdict", ev._id.toHexString());
};
const renderManagerNoteComment = (n) =>
  withMarker(`${n.body.trim()}\n\n_1:1 note from ${n.managerName || "their manager"}, ${commentDate(n.createdAt)} in eSpace_`, "manager_note", n._id.toHexString());

/** Tick the first `n` boxes of an issue body (n = Infinity → all), unticking the rest. */
function withTicks(body, n) {
  let seen = 0;
  return body.split(/\r?\n/).map((line) => {
    const m = /^(\s*[-*+]\s+)\[([ xX])\](\s+\S.*)$/.exec(line);
    if (!m) return line;
    seen += 1;
    return `${m[1]}[${seen <= n ? "x" : " "}]${m[3]}`;
  }).join("\n");
}

// ─── GitHub REST (real mode only) ────────────────────────────────────

const API = "https://api.github.com";
let lastWrite = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gh(method, path, body, { token = TOKEN, ok = [] } = {}) {
  const isWrite = method !== "GET";
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (isWrite) {
      const wait = lastWrite + 1100 - Date.now();
      if (wait > 0) await sleep(wait);
      lastWrite = Date.now();
    }
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "espace-devhub-demo-seed",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    const limited = res.status === 429 || (res.status === 403 && (res.headers.get("x-ratelimit-remaining") === "0" || res.headers.get("retry-after")));
    if (limited && attempt < 3) {
      const retry = Number(res.headers.get("retry-after")) || 30;
      console.log(`[gh-seed] rate limited on ${method} ${path} — waiting ${Math.min(retry, 90)}s`);
      await sleep(Math.min(retry, 90) * 1000);
      continue;
    }
    if (res.ok || ok.includes(res.status)) return { status: res.status, json };
    const msg = json?.message ? `${json.message}${json.errors ? " " + JSON.stringify(json.errors) : ""}` : text.slice(0, 200);
    throw new Error(`GitHub ${method} ${path} → ${res.status}: ${msg}`);
  }
  throw new Error(`GitHub ${method} ${path}: still rate limited`);
}

const [OWNER, NAME] = REPO.split("/");
const rp = `/repos/${encodeURIComponent(OWNER)}/${encodeURIComponent(NAME)}`;
const alreadyExists = (r) => r.status === 422 && JSON.stringify(r.json?.errors ?? r.json?.message ?? "").includes("already");

async function ensureLabel(name, description) {
  const r = await gh("POST", `${rp}/labels`, { name, color: ESPACE_LABEL_COLOR, description: description.slice(0, 100) }, { ok: [403, 404, 422] });
  if (r.status === 201 || alreadyExists(r)) return true;
  console.warn(`[gh-seed] label "${name}" not created (${r.status}) — issues will go out unlabelled`);
  return false;
}

async function listEspaceIssues() {
  const out = [];
  for (let page = 1; page <= 5; page += 1) {
    const { json } = await gh("GET", `${rp}/issues?labels=${encodeURIComponent(ESPACE_LABEL)}&state=all&per_page=100&page=${page}`);
    const rows = Array.isArray(json) ? json : [];
    out.push(...rows.filter((i) => !i.pull_request));
    if (rows.length < 100) break;
  }
  return out;
}

async function listAllComments(number) {
  const out = [];
  for (let page = 1; page <= 5; page += 1) {
    const { json } = await gh("GET", `${rp}/issues/${number}/comments?per_page=100&page=${page}`);
    const rows = Array.isArray(json) ? json : [];
    out.push(...rows);
    if (rows.length < 100) break;
  }
  return out;
}

/** The sync's view of one issue: state + mirrored replies + linked PRs. */
async function readState(number) {
  const { json: raw } = await gh("GET", `${rp}/issues/${number}`);
  const state = reduceIssue(raw);
  const rawComments = await listAllComments(number);
  state.comments = reduceComments(rawComments);
  const { json: timeline } = await gh("GET", `${rp}/issues/${number}/timeline?per_page=100`);
  const refs = timelinePrRefs(timeline, REPO);
  const bodies = [raw.body, ...rawComments.filter((c) => c?.user?.type !== "Bot").map((c) => c.body)];
  for (const t of bodies) {
    for (const r of extractClosingRefs(t, { repo: REPO })) {
      if (r.repo === REPO && r.number !== number && !refs.some((x) => x.repo === r.repo && x.number === r.number)) refs.push(r);
    }
  }
  const prs = [];
  for (const ref of refs.slice(0, 10)) {
    if (ref.repo !== REPO) continue;
    const r = await gh("GET", `${rp}/issues/${ref.number}`, null, { ok: [404] });
    const pr = r.status === 200 ? reducePull(r.json, REPO) : null;
    if (pr && !prs.some((p) => p.prId === pr.prId)) prs.push(pr);
  }
  state.linkedPrs = prs;
  return { raw, state, rawComments };
}

// ─── main ────────────────────────────────────────────────────────────

const client = new MongoClient(URI, { serverSelectionTimeoutMS: 10000 });
await client.connect();
try {
  const db = client.db(DB);
  const users = db.collection("users");
  const byEmail = (e) => users.findOne({ email: { $regex: `^${e.replace(/[.+*?^$()[\]{}|\\]/g, "\\$&")}$`, $options: "i" } });
  const user = await byEmail(EMAIL);
  if (!user) throw new Error(`no user for ${EMAIL} in db ${DB}`);
  const { _id: userId, orgId } = user;

  let manager = null;
  if (MANAGER_EMAIL) {
    manager = await byEmail(MANAGER_EMAIL);
    if (!manager) throw new Error(`no user for --manager ${MANAGER_EMAIL}`);
    if (!manager.orgId.equals(orgId) || !user.managerId || !user.managerId.equals(manager._id)) {
      console.warn(`[gh-seed] ${MANAGER_EMAIL} is not ${EMAIL}'s manager (users.managerId) — skipping the manager layer`);
      manager = null;
    } else if (!(manager.roles ?? [manager.role]).includes("manager")) {
      console.warn(`[gh-seed] ${MANAGER_EMAIL} has no "manager" role — rows are written, but the manager screens won't show them until it does`);
    }
  }

  // 1. specs — validated before anything is written.
  const { specs, errors } = buildSpecs(manager);
  const shared = manager ? buildSharedSpec() : null;
  if (shared?.error) errors.push(`${SHARED_CODE}: ${shared.error}`);
  if (errors.length) {
    console.error("[gh-seed] spec validation failed — nothing written:\n  " + errors.join("\n  "));
    process.exit(1);
  }
  const specA = specs.find((s) => s.goalId === GOAL_A);
  const titles = { [GOAL_A]: specA.title, [GOAL_B]: specs.find((s) => s.goalId === GOAL_B).title };

  const at = new Date();
  const l2 = (id, weightage) => ({ id, code: id, title: titles[id], description: "", rubric: "", weightage, priority: "medium", startDate: ymd(id === GOAL_A ? A_START : B_START), dueDate: ymd(id === GOAL_A ? A_END : B_END), category: "Demo" });
  const l1 = { id: L1_CODE, code: L1_CODE, title: "DEMO-GH — Work tracked on GitHub", description: "Seeded by seed-github-demo.mjs. Safe to delete.", rubric: "", weightage: 0, category: "Demo", l2s: [l2(GOAL_A, 60), l2(GOAL_B, 40)] };
  const goals = db.collection("goals");
  const tree = await goals.findOne({ orgId, userId });
  if (tree) {
    const l1s = (tree.l1s ?? []).filter((x) => x.code !== L1_CODE);
    await goals.updateOne({ _id: tree._id }, { $set: { l1s: [...l1s, l1], updatedAt: at } });
  } else {
    await goals.insertOne({ orgId, userId, schemaVersion: 2, l1s: [l1], cycleId: null, updatedAt: at });
  }
  for (const spec of specs) {
    await db.collection("goal_specs").updateOne(
      { orgId, userId, goalId: spec.goalId },
      { $set: { orgId, userId, goalId: spec.goalId, spec, generatedAt: at, classifierVersion: CLASSIFIER } },
      { upsert: true },
    );
  }

  // The grid publish.ts would use: windows covered by an authored period.
  const windows = assignedWindows(specA, nowMs).filter((w) => w.index < specA.composed.periods.length);
  const published = windows.filter((w) => !PUBLISH_SKIP.has(w.index));
  const goalLabel = espaceLabel(GOAL_A, GOAL_A);
  const markerFor = (w) => ({ orgId: orgId.toHexString(), userId: userId.toHexString(), goalId: GOAL_A, periodIndex: w.index, periodKey: w.key });
  const issueText = (w) => {
    const content = resolvePeriodContent(specA, w.index);
    const periodLabel = (content.label || w.label || `Period ${w.index + 1}`).slice(0, 200);
    return {
      periodLabel,
      title: buildIssueTitle({ goalCode: GOAL_A, goalTitle: titles[GOAL_A], periodLabel }),
      body: buildIssueBody({ period: { label: periodLabel, dueAt: content.dueAt, prompt: content.prompt, detail: content.detail }, goalTitle: titles[GOAL_A], hubUrl: null, marker: markerFor(w) }),
    };
  };

  // The manager's rows exist before GitHub so their ids can go in the comment markers.
  let note = null;
  let verdictEvent = null;
  if (manager) {
    const managerName = manager.displayName || manager.email;
    const NOTE_BODY = "Good momentum on the sync work. Let's unblock the design sign-off for the export screen this week — ping me if you need me in the review.";
    const notes = db.collection("manager_report_notes");
    note = await notes.findOne({ orgId, managerId: manager._id, reportId: userId, body: NOTE_BODY });
    if (!note) {
      note = { _id: new ObjectId(), orgId, managerId: manager._id, reportId: userId, managerName, body: NOTE_BODY, visibility: "shared-with-report", createdAt: at, updatedAt: at };
      await notes.insertOne(note);
    }
    // recordManagerVerdict, for period 0's key: supersede + append, then the projection.
    const periodKey = windows[0].key;
    const tier = "achieved";
    const vNote = "Discovery landed on time: the RFC and marker spec are exactly what the publish flow needed.";
    const events = db.collection("manager_goal_verdict_events");
    const key = { orgId, subjectUserId: userId, goalId: GOAL_A };
    verdictEvent = await events.findOne({ ...key, periodKey, supersededAt: null });
    if (!verdictEvent || verdictEvent.tier !== tier || verdictEvent.note !== vNote) {
      await events.updateMany({ ...key, periodKey, supersededAt: null }, { $set: { supersededAt: at } });
      verdictEvent = { _id: new ObjectId(), ...key, periodKey, tier, note: vNote, gradedBy: manager._id, gradedByName: managerName, gradedAt: at, supersededAt: null, legacy: false, ack: null };
      await events.insertOne(verdictEvent);
    }
    await db.collection("manager_goal_verdicts").updateOne(
      key,
      { $set: { tier, note: vNote, gradedBy: manager._id, gradedByName: managerName, gradedAt: verdictEvent.gradedAt, updatedAt: at, periodKey, eventId: verdictEvent._id, ack: null } },
      { upsert: true },
    );
  }

  // 2. GitHub — real issues, or fabricated ones.
  /** index → { issue (raw GitHub shape), state, closedAt } */
  const issues = new Map();
  let pr = null; // the merged PR, as reducePull returns it
  const posts = new Map(); // index → GithubLinkPost[]
  const DEV_REPLY = "Started on the timeline parsing — the scheduler job is next. Blocked on design sign-off for the export screen, so the runbook slips to next week.";
  const p = (i) => published.find((w) => w.index === i);

  // Posts already recorded on the rows (kept when this run has no manager).
  const prevLinks = new Map((await db.collection("github_links").find({ orgId, userId, goalId: GOAL_A, status: "linked" }).toArray()).map((l) => [l.periodIndex, l]));

  if (DRY) {
    const fake = (w) => {
      const { title, body: plain } = issueText(w);
      const number = 9000 + w.index;
      const end = w.end;
      const shape = {
        0: { state: "closed", reason: "completed", ticks: Infinity, closedAt: new Date(end - 2 * DAY) },
        1: { state: "closed", reason: "completed", ticks: 0, closedAt: new Date(end - DAY) },
        2: { state: "open", reason: null, ticks: 1, closedAt: null },
        3: { state: "closed", reason: "not_planned", ticks: 0, closedAt: new Date(Math.min(nowMs, w.start + 10 * DAY)) },
      }[w.index] ?? { state: "open", reason: null, ticks: 0, closedAt: null };
      const body = withTicks(plain, shape.ticks);
      return {
        raw: {
          id: 4_000_000_000 + number, node_id: `I_demoSeed${number}`, number,
          html_url: `https://github.com/${REPO}/issues/${number}`, title, body,
          state: shape.state, state_reason: shape.reason,
          closed_at: shape.closedAt?.toISOString() ?? null, updated_at: (shape.closedAt ?? at).toISOString(),
          labels: [{ name: ESPACE_LABEL }, { name: goalLabel }], assignees: [], comments: 0,
        },
      };
    };
    for (const w of published) {
      const { raw } = fake(w);
      const state = reduceIssue(raw);
      issues.set(w.index, { raw, state });
    }
    const w0 = p(0);
    if (w0) {
      const mergedAt = new Date(w0.end - 2 * DAY - 3_600_000);
      pr = { repo: REPO, number: 9100, prId: 4_000_009_100, url: `https://github.com/${REPO}/pull/9100`, title: "Discovery: integration RFC + marker spec", state: "merged", mergedAt, author: "demo-dev" };
      issues.get(0).state.linkedPrs = [pr];
    }
    const s2 = issues.get(2)?.state;
    if (s2) {
      s2.comments = [{ commentId: 4_000_100_001, author: "demo-dev", body: DEV_REPLY, createdAt: new Date(nowMs - 3 * DAY), url: `https://github.com/${REPO}/issues/9002#issuecomment-4000100001` }];
      s2.commentsCount = 1 + (note ? 1 : 0);
    }
    if (note && issues.get(2)) posts.set(2, [{ kind: "manager_note", sourceId: note._id.toHexString(), commentId: 4_000_100_002, postedAt: at, postedBy: manager._id }]);
    if (verdictEvent && issues.get(0)) {
      posts.set(0, [{ kind: "tier_verdict", sourceId: verdictEvent._id.toHexString(), commentId: 4_000_100_003, postedAt: at, postedBy: manager._id }]);
      issues.get(0).state.commentsCount = 1;
    }
  } else {
    const { json: repoInfo } = await gh("GET", rp);
    const base = repoInfo.default_branch;
    const ownerLogin = repoInfo.owner?.login ?? OWNER;
    // reuse marker-matched issues (idempotent re-runs + adoption)
    const existing = new Map();
    for (const issue of await listEspaceIssues()) {
      const m = parseMarker(issue.body);
      if (m && m.orgId === orgId.toHexString() && m.userId === userId.toHexString() && m.goalId === GOAL_A && !existing.has(m.periodIndex)) existing.set(m.periodIndex, issue);
    }
    const labelsOk = (await ensureLabel(ESPACE_LABEL, "Created by eSpace Dev Hub")) && (await ensureLabel(goalLabel, titles[GOAL_A]));
    for (const w of published) {
      let issue = existing.get(w.index);
      if (!issue) {
        const { title, body } = issueText(w);
        const r = await gh("POST", `${rp}/issues`, { title, body, labels: labelsOk ? [ESPACE_LABEL, goalLabel] : [] }, { ok: [422] });
        issue = r.status === 422 ? (await gh("POST", `${rp}/issues`, { title, body })).json : r.json;
        console.log(`[gh-seed] created #${issue.number} for period ${w.index}`);
      } else {
        console.log(`[gh-seed] reusing #${issue.number} for period ${w.index}`);
      }
      issues.set(w.index, { raw: issue, labelsApplied: (issue.labels ?? []).some((l) => (l?.name ?? l) === goalLabel) });
    }

    // Branch + commit + PR "Closes #<p0>", merged — the linked merged PR.
    const i0 = issues.get(0)?.raw;
    if (i0) {
      const prs = (await gh("GET", `${rp}/pulls?state=all&head=${encodeURIComponent(`${ownerLogin}:${PR_BRANCH}`)}&per_page=10`)).json ?? [];
      let pull = prs.find((x) => x.merged_at) ?? prs.find((x) => x.state === "open") ?? null;
      if (!pull) {
        const head = (await gh("GET", `${rp}/git/ref/heads/${encodeURIComponent(base)}`)).json;
        // The PR merges into a side branch, never the default branch: in a real
        // product repo a demo commit on main would ship (and could deploy).
        // GitHub still records the cross-reference, so the PR links to the
        // issue; the issue itself is closed explicitly in the shaping step.
        const sb = await gh("POST", `${rp}/git/refs`, { ref: `refs/heads/${DEMO_BASE}`, sha: head.object.sha }, { ok: [422] });
        if (sb.status === 422 && !alreadyExists(sb) && !/exists/i.test(sb.json?.message ?? "")) throw new Error(`branch ${DEMO_BASE}: ${sb.json?.message}`);
        const ref = await gh("POST", `${rp}/git/refs`, { ref: `refs/heads/${PR_BRANCH}`, sha: head.object.sha }, { ok: [422] });
        if (ref.status === 422 && !alreadyExists(ref) && !/exists/i.test(ref.json?.message ?? "")) throw new Error(`branch ${PR_BRANCH}: ${ref.json?.message}`);
        const path = `espace-demo/${GOAL_A.toLowerCase()}-${windows[0].key}.md`;
        const cur = await gh("GET", `${rp}/contents/${path}?ref=${encodeURIComponent(PR_BRANCH)}`, null, { ok: [404] });
        if (cur.status === 404) {
          const text = `# ${GOAL_A} · ${windows[0].label}\n\nDiscovery output for the eSpace GitHub integration demo.\nSeeded by apps/api/scripts/seed-github-demo.mjs on ${ymd(nowMs)}.\n`;
          await gh("PUT", `${rp}/contents/${path}`, { message: `docs: ${GOAL_A} discovery notes`, content: Buffer.from(text).toString("base64"), branch: PR_BRANCH });
        }
        pull = (await gh("POST", `${rp}/pulls`, { title: "Discovery: integration RFC + marker spec", head: PR_BRANCH, base: DEMO_BASE, body: `Discovery notes for the GitHub integration plan.\n\nCloses #${i0.number}` })).json;
        console.log(`[gh-seed] opened PR #${pull.number}`);
      }
      if (!pull.merged_at) {
        await gh("PUT", `${rp}/pulls/${pull.number}/merge`, { merge_method: "squash" });
        console.log(`[gh-seed] merged PR #${pull.number}`);
        await sleep(3000); // let GitHub record the cross-reference
      }
      pr = reducePull((await gh("GET", `${rp}/issues/${pull.number}`)).json, REPO);
    }

    // Shape the mix (each PATCH only when the issue isn't already there).
    const patch = async (i, fields) => {
      const cur = issues.get(i);
      if (!cur) return;
      cur.raw = (await gh("PATCH", `${rp}/issues/${cur.raw.number}`, fields)).json;
    };
    const fresh = async (i) => {
      const cur = issues.get(i);
      if (cur) cur.raw = (await gh("GET", `${rp}/issues/${cur.raw.number}`)).json;
      return cur?.raw;
    };
    const want = { 0: [Infinity, "closed", "completed"], 1: [0, "closed", "completed"], 2: [1, "open", null], 3: [0, "closed", "not_planned"] };
    for (const [iStr, [ticks, st, reason]] of Object.entries(want)) {
      const i = Number(iStr);
      const raw = await fresh(i);
      if (!raw) continue;
      const body = withTicks(raw.body ?? "", ticks);
      const fields = {};
      if (taskListProgress(body).done !== taskListProgress(raw.body).done) fields.body = body;
      if (raw.state !== st || (st === "closed" && raw.state_reason !== reason)) {
        if (st === "closed" && raw.state === "closed") await patch(i, { state: "open" }); // re-close with the right reason
        fields.state = st;
        if (reason) fields.state_reason = reason;
      }
      if (Object.keys(fields).length) await patch(i, fields);
    }

    // A developer reply on period 2.
    const i2 = issues.get(2)?.raw;
    if (i2) {
      const comments = await listAllComments(i2.number);
      if (!comments.some((c) => c.body === DEV_REPLY)) await gh("POST", `${rp}/issues/${i2.number}/comments`, { body: DEV_REPLY });
    }

    // The manager's note (period 2) and grade (period 0), as posts with comment markers.
    const postOnce = async (i, kind, sourceId, body) => {
      const cur = issues.get(i)?.raw;
      if (!cur) return;
      const list = [...(posts.get(i) ?? prevLinks.get(i)?.posts ?? [])];
      if (list.some((x) => x.kind === kind && x.sourceId === sourceId)) { posts.set(i, list); return; }
      const found = (await listAllComments(cur.number)).find((c) => { const m = parseCommentMarker(c.body); return m && m.kind === kind && m.sourceId === sourceId; });
      const commentId = found ? found.id : (await gh("POST", `${rp}/issues/${cur.number}/comments`, { body }, { token: MANAGER_TOKEN })).json.id;
      list.push({ kind, sourceId, commentId, postedAt: at, postedBy: manager._id });
      posts.set(i, list);
    };
    if (note) await postOnce(2, "manager_note", note._id.toHexString(), renderManagerNoteComment(note));
    if (verdictEvent) await postOnce(0, "tier_verdict", verdictEvent._id.toHexString(), renderTierVerdictComment(verdictEvent));

    // Read every issue back the way the sync does.
    for (const cur of issues.values()) {
      const { raw, state } = await readState(cur.raw.number);
      cur.raw = raw;
      cur.state = state;
    }
  }

  // 3. github_links rows.
  const links = db.collection("github_links");
  const linkIds = new Map();
  for (const w of published) {
    const cur = issues.get(w.index);
    const { periodLabel } = issueText(w);
    const key = idempotencyKey(orgId, userId, GOAL_A, w.index);
    const row = {
      orgId, userId, goalId: GOAL_A, assignedGoalId: null,
      periodIndex: w.index, periodKey: w.key, periodLabel,
      repo: REPO, idempotencyKey: key, status: "linked",
      issueNumber: cur.raw.number, issueId: cur.raw.id, issueNodeId: cur.raw.node_id, issueUrl: cur.raw.html_url,
      labelsApplied: cur.labelsApplied ?? true,
      lastSyncedAt: at, lastSyncError: null, syncFailures: 0,
      state: cur.state,
      readingInputId: null, readingClosedAt: null,
      posts: posts.get(w.index) ?? prevLinks.get(w.index)?.posts ?? [],
      specRevision: null, stale: false, unlinkedAt: null,
    };
    await links.updateOne(
      { idempotencyKey: key },
      { $set: row, $setOnInsert: { claimedAt: at, createdBy: userId, createdAt: at } },
      { upsert: true },
    );
    linkIds.set(w.index, (await links.findOne({ idempotencyKey: key }, { projection: { _id: 1 } }))._id);
  }

  // 4. goal_inputs — replaced wholesale so re-runs keep the same counts.
  const inputs = db.collection("goal_inputs");
  await inputs.deleteMany({ orgId, userId, goalId: { $in: [GOAL_A, GOAL_B] } });
  const w0 = windows[0];
  const manualP0 = {
    periodKey: w0.key,
    values: { demos: 2, summary: "RFC + marker spec merged; demoed to platform and mobile teams." },
    evidence: { demos: "Demo recording and RFC review thread linked in the PR description." },
  };
  const p0Created = new Date(Math.min(w0.end - 5 * DAY, nowMs - DAY));
  await inputs.insertOne({ orgId, userId, goalId: GOAL_A, ts: p0Created, value: manualP0, note: null, source: "manual", createdAt: p0Created });
  const w4 = windows.find((w) => w.index === 4);
  if (w4) {
    const t = new Date(Math.max(w4.start + DAY, Math.min(nowMs - DAY, w4.end - DAY)));
    await inputs.insertOne({ orgId, userId, goalId: GOAL_A, ts: t, value: { periodKey: w4.key, values: { demos: 1, summary: "Correlation endpoint in review." }, evidence: { demos: "Showed the report board at the guild sync." } }, note: null, source: "manual", createdAt: t });
  }
  // DEMO-GH-02: two weekly check-ins so the unpublished tracker isn't empty.
  const bWindows = assignedWindows(specs.find((s) => s.goalId === GOAL_B), nowMs);
  for (const w of bWindows.slice(0, 2)) {
    const t = new Date(Math.min(w.end - DAY, nowMs - DAY));
    await inputs.insertOne({ orgId, userId, goalId: GOAL_B, ts: t, value: { periodKey: w.key, values: { shipped: true, prs: 4, note: "On plan." } }, note: null, source: "manual", createdAt: t });
  }
  // One `source: "github"` reading per period closed as completed — sync.ts writeReading.
  const readings = [];
  for (const w of published) {
    const cur = issues.get(w.index);
    const s = cur.state;
    if (s.issueState !== "closed" || s.stateReason === "not_planned") continue;
    const closedAt = s.closedAt ?? at;
    const prev = w.index === 0 ? manualP0 : {};
    const value = { ...prev, periodKey: w.key, github: { issueNumber: cur.raw.number, repo: REPO, closedAt: closedAt.toISOString(), url: cur.raw.html_url } };
    const _id = new ObjectId();
    await inputs.insertOne({ _id, orgId, userId, goalId: GOAL_A, ts: closedAt, value, note: `Closed on GitHub: ${cur.raw.html_url}`.slice(0, 2000), source: "github", createdAt: closedAt });
    await links.updateOne({ _id: linkIds.get(w.index) }, { $set: { readingInputId: _id, readingClosedAt: closedAt } });
    readings.push(w.index);
  }

  // Star the merged PR (link-model.js prEvidenceItem shape).
  if (pr) {
    await db.collection("evidence").updateOne(
      { orgId, userId, id: `mr-gh-${pr.prId}` },
      { $set: { kind: "merged-pr", ref: `!${pr.number}`, title: pr.title, date: pr.mergedAt ? pr.mergedAt.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "", impact: "Unblocked the publish flow — the marker format every issue now carries." }, $setOnInsert: { orgId, userId, id: `mr-gh-${pr.prId}`, starredAt: at } },
      { upsert: true },
    );
  }

  // 5b. The shared goal with a GitHub request and no links.
  let sharedId = null;
  if (manager && shared?.spec) {
    const assigned = db.collection("assigned_goals");
    const doc = {
      orgId, createdBy: manager._id, createdByName: manager.displayName || manager.email,
      code: SHARED_CODE, title: shared.spec.title,
      description: "Seeded demo. Publish each week to GitHub as an issue and tick the deliverables there.",
      spec: shared.spec, assigneeIds: [userId], viewerIds: [], graceHours: 12, timeZone: "Africa/Cairo",
      status: "active", archivedAt: null, specRevision: 0,
      github: { repo: REPO, requestedAt: at, requestedBy: manager._id },
      updatedAt: at,
    };
    const found = await assigned.findOne({ orgId, createdBy: manager._id, code: SHARED_CODE });
    if (found) {
      await assigned.updateOne({ _id: found._id }, { $set: { ...doc, specRevision: found.specRevision ?? 0 } });
      sharedId = found._id;
    } else {
      sharedId = new ObjectId();
      await assigned.insertOne({ _id: sharedId, ...doc, createdAt: at });
    }
    const asgLinks = await links.countDocuments({ orgId, userId, goalId: `asg_${sharedId.toHexString()}`, status: { $ne: "unlinked" } });
    if (asgLinks > 0) console.warn(`[gh-seed] ${SHARED_CODE} already has ${asgLinks} link(s) — the "asked for GitHub issues" callout hides once published`);
  }

  // 6. summary
  const expected = { 0: "—", 1: "closed_no_evidence", 2: "open_past_deadline", 3: "—", 4: "evidence_no_issue" };
  console.log(`\n[gh-seed] ${EMAIL} · db ${DB} · repo ${REPO}${DRY ? " · DRY RUN" : ""}`);
  console.log("\nGoals");
  console.log(`  ${L1_CODE}     L1  ${l1.title}`);
  console.log(`  ${GOAL_A}  L2  ${titles[GOAL_A]} — monthly, ${windows.length} periods, approved, published`);
  console.log(`  ${GOAL_B}  L2  ${titles[GOAL_B]} — weekly, ${specs.find((s) => s.goalId === GOAL_B).composed.periods.length} periods, approved, NOT published (press Publish in the demo)`);
  if (sharedId) console.log(`  ${SHARED_CODE}  shared asg_${sharedId.toHexString()} by ${MANAGER_EMAIL} — GitHub requested, no links`);
  console.log(`\nIssues (${GOAL_A})`);
  console.log("  idx  period                          issue   state                  tasks  reading  expected flag            url");
  for (const w of windows) {
    const cur = issues.get(w.index);
    const s = cur?.state;
    const st = s ? (s.issueState === "closed" ? `closed/${s.stateReason ?? "-"}` : s.issueState) : "not published";
    const label = (resolvePeriodContent(specA, w.index).label || w.label).slice(0, 30);
    console.log(
      `  ${String(w.index).padEnd(4)} ${label.padEnd(31)} ${(cur ? `#${cur.raw.number}` : "—").padEnd(7)} ${st.padEnd(22)} ${(s ? `${s.tasks.done}/${s.tasks.total}` : "—").padEnd(6)} ${(readings.includes(w.index) ? "github" : "—").padEnd(8)} ${(expected[w.index] ?? "—").padEnd(24)} ${cur?.raw.html_url ?? ""}`,
    );
  }
  if (pr) console.log(`\n  merged PR #${pr.number} (prId ${pr.prId}) → linked to period 0, starred as mr-gh-${pr.prId}  ${pr.url}`);
  if (manager) console.log(`  manager: note → period 2 issue, tier "achieved" for ${windows[0].key} → period 0 issue (link.posts)`);
  console.log("\nCorrelation report (Evidence → GitHub, manager report board → GitHub) should flag:");
  for (const [i, f] of Object.entries(expected)) if (f !== "—") console.log(`  period ${i}: ${f}`);
  if (DRY) {
    console.log("\n[gh-seed] DRY RUN: issue numbers/URLs/states above are fabricated and point nowhere real.");
    console.log("[gh-seed] The hourly github-links sync will mark these links missing (issue_missing) on its next pass;");
    console.log("[gh-seed] set GITHUB_LINKS_SYNC=false on the API to keep the fabricated states visible.");
  }
} finally {
  await client.close();
}
