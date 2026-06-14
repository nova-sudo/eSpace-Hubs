#!/usr/bin/env node
/**
 * rewrite-goals-from-zoho-pdf.mjs — one-shot goal-tree rewriter.
 *
 * Re-import counterpart to scripts/import-zoho-goals.mjs. That script
 * parses Zoho CSV exports; this one carries an inline tree built from
 * the user's Zoho-People L2-view PDF (the export they shared on
 * 2026-05-18 with 14 mapped L2s under the same 4 L1s as before).
 *
 * Why a separate script:
 *   - The PDF view isn't in a parseable CSV format
 *   - The data shape is bespoke (multi-paragraph rubrics, priorities)
 *   - Keeping it as code means the user can re-run cleanly if anything
 *     goes wrong, without re-asking for the document
 *
 * Behaviour:
 *   - Looks up the user by email
 *   - Fetches the existing goal tree to preserve L1 ids by L1 code
 *     (so any L1 classifications that already landed in the goal-specs
 *     store stay anchored to the same goalId)
 *   - Generates L2 ids from the L2 code (e.g. "DP-L0-2-PSCS-L2-02-02"),
 *     which makes them self-documenting and idempotent across re-runs
 *   - Replaces the tree wholesale via the same `goals` collection
 *     upsert as the CSV importer
 *
 * Usage:
 *   node scripts/rewrite-goals-from-zoho-pdf.mjs \
 *     --email abdelrahmannoa76@gmail.com \
 *     [--dry-run] [--mongo mongodb://localhost:27017] [--db devhub-dev]
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

const requireFromHere = createRequire(import.meta.url);
function loadMongo() {
  const candidates = [
    path.join(REPO_ROOT, "apps/api/node_modules/mongodb"),
    path.join(REPO_ROOT, "node_modules/mongodb"),
  ];
  for (const c of candidates) {
    try {
      return requireFromHere(c);
    } catch {
      /* try next */
    }
  }
  return requireFromHere("mongodb");
}
const { MongoClient } = loadMongo();

const GOALS_SCHEMA_VERSION = 2;

// ─── argv ─────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {
    email: null,
    dryRun: false,
    mongoUri: "mongodb://localhost:27017",
    dbName: "devhub-dev",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--email") out.email = argv[++i];
    else if (a === "--mongo") out.mongoUri = argv[++i];
    else if (a === "--db") out.dbName = argv[++i];
    else if (a === "-h" || a === "--help") {
      printHelp();
      process.exit(0);
    } else {
      console.error(`✗ unknown argument: ${a}`);
      printHelp();
      process.exit(1);
    }
  }
  return out;
}

function printHelp() {
  console.log(`Usage: node scripts/rewrite-goals-from-zoho-pdf.mjs --email <addr> [flags]

Flags:
  --email <addr>     user email (required)
  --dry-run          log the tree summary, don't write
  --mongo <uri>      Mongo URI (default mongodb://localhost:27017)
  --db <name>        DB name (default devhub-dev)
  -h, --help         show this help
`);
}

// ─── inline tree data (from the user's Zoho L2-view PDF, 2026-05-18) ─

/**
 * Each L2 mirrors the shape `import-zoho-goals.mjs` produces from CSVs:
 *
 *   { code, title, description, rubric, weightage, priority }
 *
 * `description` is the one-liner near the top of each card; `rubric`
 * is the four-step Not/Achieved/Over/Role-Model block. Both get
 * surfaced verbatim in the analyst's classification prompt.
 *
 * Priorities are taken straight from the PDF (the High/Medium chip).
 */

const TREE = [
  {
    code: "DP-L0-2-PSCS-L1-02",
    title:
      "Ensure ≥ 85% of deliverables meet agreed quality standards on first review and maintain ≤ 10% post-delivery defects per quarter.",
    weightage: 20,
    rubric: [
      "- Not Achieved: Less than 75% of deliverables pass first review OR more than 15% post-delivery defect rate.",
      "- Achieved: Equal to or more than 85% First-Review Pass Rate AND equal to or less than 10% Post-Delivery Defects.",
      "- Over-Achieved: 90%-95% First-Review Pass Rate AND less than 5% Post-Delivery Defects.",
      "- Role Model: 100% First-Review Pass Rate with Zero major defects",
    ].join("\n"),
    l2s: [
      {
        code: "DP-L0-2-PSCS-L2-02-02",
        title: "Post-Delivery Defect Control",
        priority: "High",
        weightage: 10,
        description:
          "Minimize defects that escape into production/client environments, and close the loop on every escape through root-cause analysis and preventive action.",
        rubric: [
          "- Not Achieved: More than 15% post-delivery defect rate OR any major/critical defect without a documented root-cause analysis OR preventive actions from prior defects left open past due date.",
          "- Achieved: ≤ 10% post-delivery defect rate AND every escaped defect has a documented root cause and corrective action AND all preventive actions closed on time.",
          "- Over Achieved: < 5% post-delivery defect rate AND zero major defects in the period AND repeat-defect rate (same root cause recurring) reduced by ≥ 25% vs prior period.",
          "- Role Model: Zero major defects sustained across consecutive periods AND preventive actions routinely encoded as automated guardrails (tests, policies, monitoring) rather than manual checks AND defect-escape trend independently validated through client feedback or audit.",
        ].join("\n"),
      },
      {
        code: "DP-L0-2-PSCS-L2-02-01",
        title: "First-Review Pass Rate",
        priority: "High",
        weightage: 10,
        description:
          "Ensure deliverables meet agreed quality standards before they reach the reviewer, through pre-submission checks, peer review, and definition-of-done discipline.",
        rubric: [
          "- Not Achieved: Less than 75% of deliverables pass first review OR no documented quality checklist / definition of done exists OR pre-submission peer review is skipped on more than 20% of deliverables.",
          "- Achieved: ≥ 85% first-review pass rate AND every deliverable follows a documented quality checklist / definition of done AND peer review completed before submission on 100% of deliverables.",
          "- Over Achieved: 90–95% first-review pass rate AND root causes of first-review failures tracked and trending down period-over-period AND checklist/definition of done updated at least once in the period based on findings.",
          "- Role Model: 100% first-review pass rate AND pre-submission quality gates are largely automated (linters, test suites, doc validators, AI-assisted review) AND the team's quality standard is adopted as a reference by other teams.",
        ].join("\n"),
      },
    ],
  },

  {
    code: "R-L0-3-PSCS-L1-06",
    title:
      "Achieve 100% compliance with client-specific uptime SLAs and maintain a ≤ 2-hour restoration window for dev team environments in case of failures, ensuring full backup and recovery procedures are tested quarterly",
    weightage: 20,
    rubric: [
      "- Not Achieved: Any breach of a client SLA OR developer environment restoration exceeded 2 hours OR failed to conduct/document quarterly recovery tests OR missed RTO/RPO targets during a drill.",
      "- Achieved: 100% adherence to all client SLAs AND developer environments restored in equal to or less than 2 hours AND 100% of quarterly recovery tests completed/documented AND met all predefined RTO/RPO targets.",
      "- Over Achieved: Sustained uptime significantly above SLA requirements AND developer environments restored in equal to or less than 1 hour AND Monthly recovery tests completed AND significantly beat RTO/RPO targets (e.g., by 25%+).",
      "- Role Model: Zero unplanned downtime across all client systems AND Continuous/Automated recovery validation (Self-healing) AND Developer environment restoration is fully automated/instant.",
    ].join("\n"),
    l2s: [
      {
        code: "R-L0-3-PSCS-L2-06-06",
        title: "Incident Post-Mortem & Preventive Action",
        priority: "Medium",
        weightage: 15,
        description:
          "For every SLA-affecting or recovery-affecting event, produce a blameless post-mortem and track preventive actions to closure.",
        rubric: [
          "- Not Achieved: Any qualifying incident without a post-mortem OR post-mortem missing root cause / corrective actions OR preventive actions left open past agreed due dates.",
          "- Achieved: 100% of qualifying incidents have a post-mortem published within 5 business days AND each includes root cause, timeline, and corrective actions AND all actions closed on time.",
          "- Over Achieved: Post-mortems published within 2 business days AND repeat-incident rate reduced by ≥ 25% vs prior period AND learnings shared in a cross-team forum.",
          "- Role Model: Repeat-incident rate at zero for the period AND preventive actions routinely encoded as automated guardrails (tests, policies, alerts) rather than manual checklists.",
        ].join("\n"),
      },
      {
        code: "R-L0-3-PSCS-L2-06-05",
        title: "Dev Environment Restoration Capability",
        priority: "Medium",
        weightage: 5,
        description:
          "Maintain runbooks, automation, and on-call coverage to restore developer environments within the committed window after any failure.",
        rubric: [
          "- Not Achieved: Any dev environment restoration exceeded 2 hours OR no documented restoration runbook exists OR on-call rotation has coverage gaps.",
          "- Achieved: 100% of dev-environment restorations completed in ≤ 2 hours AND runbooks exist and are current for every dev environment AND 24×5 on-call coverage with no gaps.",
          "- Over Achieved: 100% of dev-environment restorations completed in ≤ 1 hour AND restoration triggered via a single command/script AND environments version-controlled as code.",
          "- Role Model: Dev-environment restoration is fully automated and effectively instant (self-healing; no human ticket required) AND ephemeral environments can be recreated on demand from code in minutes.",
        ].join("\n"),
      },
      {
        code: "R-L0-3-PSCS-L2-06-04",
        title: "RTO / RPO Definition & Achievement",
        priority: "Medium",
        weightage: 2.5,
        description:
          "Define, publish, and meet RTO/RPO targets per system tier, and measure actuals during every real or simulated recovery event.",
        rubric: [
          "- Not Achieved: Any in-scope system without documented RTO/RPO OR measured RTO/RPO missed during a drill or real incident OR actuals not captured/reported.",
          "- Achieved: RTO/RPO documented for 100% of in-scope systems AND every drill and real incident meets its targets AND actuals captured in a central register.",
          "- Over Achieved: Measured RTO/RPO beats targets by ≥ 25% across all Tier-1 systems AND targets themselves tightened at least once in the period based on capability gains.",
          "- Role Model: RTO approaches zero (sub-minute failover) for all Tier-1 systems AND RPO approaches zero via continuous replication AND targets are validated automatically on every deployment.",
        ].join("\n"),
      },
      {
        code: "R-L0-3-PSCS-L2-06-03",
        title: "Quarterly Disaster Recovery Drills",
        priority: "Medium",
        weightage: 2.5,
        description:
          "Plan, execute, and document recovery drills that simulate realistic failure scenarios and validate recovery runbooks.",
        rubric: [
          "- Not Achieved: Any scheduled quarterly drill skipped OR drill conducted but not documented (scenario, participants, timings, findings) OR action items from prior drills left unclosed into the next cycle.",
          "- Achieved: 100% of quarterly drills executed on schedule AND each drill fully documented with scenario, measured RTO/RPO, and findings AND all action items closed before the next drill.",
          "- Over Achieved: Drills conducted monthly AND scenarios rotated to cover region loss, ransomware, provider outage, and data corruption AND drill results shared with clients where contractually relevant.",
          "- Role Model: Continuous game-day / chaos-engineering program with unannounced failure injection in production-like environments AND recovery runbooks are executable code (not just documents) AND zero drill failures across the period.",
        ].join("\n"),
      },
      {
        code: "R-L0-3-PSCS-L2-06-02",
        title: "Backup Integrity & Coverage",
        priority: "High",
        weightage: 2.5,
        description:
          "Ensure every in-scope system (client production + dev environments) has defined, executed, and verified backups aligned to its data-criticality tier.",
        rubric: [
          "- Not Achieved: Any in-scope system without a scheduled backup OR any failed backup job left unremediated beyond the next cycle OR backup integrity (restore-ability) never verified in the period.",
          "- Achieved: 100% of in-scope systems have scheduled backups per policy AND all failed backup jobs remediated within one cycle AND backup integrity verified at least quarterly via sample restore.",
          "- Over Achieved: Backup integrity verified monthly via automated restore-and-checksum AND backup windows reduced by ≥ 25% vs baseline AND immutable/air-gapped copies maintained for all Tier-1 systems.",
          "- Role Model: Continuous backup validation (every backup automatically restored to a sandbox and checksum-verified) AND cross-region/cross-provider redundancy for all client data AND zero unverified backups at any point in the period.",
        ].join("\n"),
      },
      {
        code: "R-L0-3-PSCS-L2-06-01",
        title: "Client SLA Uptime Monitoring & Adherence",
        priority: "High",
        weightage: 2.5,
        description:
          "Continuously monitor and report uptime against each client's contractual SLA, with proactive alerting before thresholds are breached.",
        rubric: [
          "- Not Achieved: Any client SLA breach in the period OR monitoring gaps (blind spots) on any production system OR uptime reports not delivered to clients on schedule.",
          "- Achieved: 100% of client SLAs met AND all production systems covered by uptime monitoring with alerting AND SLA reports delivered on time to every client.",
          "- Over Achieved: Sustained uptime exceeds each client SLA by a meaningful margin (e.g., 99.99% vs 99.9% contractual) AND predictive alerts fire before user-visible impact in ≥ 80% of incidents.",
          "- Role Model: Zero unplanned downtime across the entire client portfolio AND SLA posture is published on a live client-facing status page AND monitoring coverage is continuously validated via synthetic transactions.",
        ].join("\n"),
      },
    ],
  },

  {
    code: "PO-L0-4-PSCS-L1-07",
    title:
      "Accelerate team capability by ensuring 85% of staff complete their personalized Professional Development Plans, securing 1:1 succession readiness for critical leadership roles.",
    weightage: 20,
    rubric: [
      "- Not Achieved: Less than 65% of PDPs completed OR failure to identify/train successors for key roles.",
      "- Achieved: 85% of PDP milestones met AND identified successors have completed initial leadership transition training.",
      "- Over Achieved: 100% PDP completion AND 50% of critical roles have a \"Ready-Now\" successor",
      "- Role Model: Established a self-sustaining \"Learning Culture\" where team members lead internal knowledge-sharing sessions AND 100% of critical roles have \"ready-now\" internal successors.",
    ].join("\n"),
    l2s: [
      {
        code: "PO-L0-4-PSCS-L2-07-03",
        title: "Internal Knowledge Sharing & Learning Culture",
        priority: "High",
        weightage: 10,
        description:
          "Build the mechanisms — sessions, content, and recognition — that turn individual development into collective team capability.",
        rubric: [
          "- Not Achieved: No recurring internal knowledge-sharing cadence OR knowledge-sharing participation concentrated in a few individuals (e.g., < 25% of team has led a session) OR no shared repository of learning artifacts.",
          "- Achieved: Regular knowledge-sharing cadence in place (at least monthly) AND ≥ 50% of team members have led or co-led at least one session in the period AND learning artifacts (recordings, docs, playbooks) stored in a shared, searchable repository.",
          "- Over Achieved: 100% of team members have led at least one session AND sessions are linked to PDP goals and team capability gaps AND measurable reuse of shared artifacts (cited in work, referenced in onboarding).",
          "- Role Model: A self-sustaining learning culture where sessions, mentoring, and artifact creation happen without management prompting AND team members are recognized/rewarded for teaching contributions AND the team is a net exporter of knowledge to the wider organization (cross-team sessions, published internal standards).",
        ].join("\n"),
      },
      {
        code: "PO-L0-4-PSCS-L2-07-02",
        title: "Succession Readiness for Critical Roles",
        priority: "High",
        weightage: 5,
        description:
          "Identify critical leadership roles, name successors, and progress them through a structured leadership transition pathway.",
        rubric: [
          "- Not Achieved: Any critical role without an identified successor OR identified successors have not started leadership transition training OR no documented criteria for what \"critical role\" means.",
          "- Achieved: 100% of critical roles have at least one named successor AND every named successor has completed initial leadership transition training AND readiness is reviewed at least twice in the period.",
          "- Over Achieved: ≥ 50% of critical roles have a \"Ready-Now\" successor (able to step in within 30 days) AND each critical role has a documented 1:1 transition plan AND successors have shadowed or acted-up in the role at least once.",
          "- Role Model: 100% of critical roles have a \"Ready-Now\" internal successor AND a secondary (Ready-in-1-Year) bench exists for every critical role AND at least one real succession event in the period was executed internally with no capability gap.",
        ].join("\n"),
      },
      {
        code: "PO-L0-4-PSCS-L2-07-01",
        title: "Personalized Development Plan Design & Completion",
        priority: "High",
        weightage: 5,
        description:
          "Ensure every team member has a current, personalized PDP with measurable milestones, and drive completion of those milestones across the team.",
        rubric: [
          "- Not Achieved: Less than 65% of PDP milestones completed OR any team member without a documented, current PDP OR PDPs not reviewed with manager at least twice in the period.",
          "- Achieved: ≥ 85% of PDP milestones completed across the team AND 100% of staff have a current PDP aligned to role and career aspiration AND each PDP reviewed at least quarterly with the manager.",
          "- Over Achieved: 100% PDP milestone completion AND each PDP includes at least one stretch/cross-functional goal AND measurable skill uplift demonstrated (certification earned, assessment score, or delivered artifact) for ≥ 75% of staff.",
          "- Role Model: 100% completion sustained across consecutive periods AND PDPs are peer-reviewed and linked to team capability gaps AND skill uplift is independently validated (external certification, client feedback, or internal capability assessment) for every team member.",
        ].join("\n"),
      },
    ],
  },

  {
    code: "DP-L0-5-PSCS-L1-05",
    title:
      "Achieve 80% team Adoption for \"Agentic Workflows,\" with more than 70% of project tasks involving Claude Code (or similar Agentic tools), resulting in a 20% reduction in manual coding/documentation hours per project by Q4.",
    weightage: 40,
    rubric: [
      "- Not Achieved: Less than 70% of the team is complying; Agentic tool adoption is inconsistent or limited to a few engineers.",
      "- Achieved: 80% of engineers and non-developers completed Agentic coding/Claude Code internal training. 70% of project tasks utilize Agentic tools for execution or documentation.",
      "- Over Achieved: All \"Achieved\" criteria met, PLUS more than 30% reduction in time-to-deliver for standard project phases.",
      "- Role Model: 100% adoption across all departments with Zero-Surprise execution across the entire process.",
    ].join("\n"),
    l2s: [
      {
        code: "DP-L0-5-PSCS-L2-05-03",
        title: "Productivity & Delivery Impact from Agentic Adoption",
        priority: "Medium",
        weightage: 15,
        description:
          "Measure and realize the tangible efficiency gains promised by agentic adoption — reduced manual hours and faster delivery.",
        rubric: [
          "- Not Achieved: No baseline established for manual coding/documentation hours OR reduction is less than 20% OR savings not measured or reported per project.",
          "- Achieved: ≥ 20% reduction in manual coding/documentation hours per project by Q4 AND baseline and actuals documented for every project AND savings reviewed in project retrospectives.",
          "- Over Achieved: All \"Achieved\" criteria met PLUS ≥ 30% reduction in time-to-deliver for standard project phases AND quality metrics (defect rate, review rework) held stable or improved AND savings reinvested into higher-value work, documented in the period.",
          "- Role Model: Sustained ≥ 40% reduction in manual hours and ≥ 30% faster time-to-deliver across all projects AND productivity gains independently validated (client feedback, delivery metrics, or finance sign-off) AND the team's agentic practices adopted as a reference pattern elsewhere in the organization.",
        ].join("\n"),
      },
      {
        code: "DP-L0-5-PSCS-L2-05-02",
        title: "Agentic Tool Utilization in Project Execution",
        priority: "High",
        weightage: 10,
        description:
          "Embed Claude Code / agentic tools into day-to-day project work so that execution and documentation tasks are routinely agent-assisted, not ad-hoc.",
        rubric: [
          "- Not Achieved: Less than 70% of the team is actively using agentic tools OR usage limited to a few engineers OR no tracking mechanism exists to measure task-level adoption.",
          "- Achieved: ≥ 70% of project tasks utilize agentic tools for execution or documentation AND adoption tracked per project (task tags, PR labels, or tooling telemetry) AND every active project has at least one documented agentic workflow in use.",
          "- Over Achieved: ≥ 85% of project tasks agent-assisted AND agentic workflows standardized across ≥ 3 task categories (e.g., code generation, test authoring, documentation, code review) AND reusable workflow templates published for team-wide use.",
          "- Role Model: 100% adoption across all departments with Zero-Surprise execution — agentic workflows are the default, with guardrails, review gates, and audit trails making outcomes predictable across every project phase.",
        ].join("\n"),
      },
      {
        code: "DP-L0-5-PSCS-L2-05-01",
        title: "Agentic Workflows Training & Enablement",
        priority: "High",
        weightage: 5,
        description:
          "Build team-wide fluency in Claude Code and equivalent agentic tools through structured training, internal sessions, and certified completion.",
        rubric: [
          "- Not Achieved: Less than 70% of the team completed agentic coding / Claude Code internal training OR fewer than 3 internal enablement sessions delivered in the period OR no documented training materials/playbooks exist.",
          "- Achieved: ≥ 80% of engineers and non-developers completed agentic coding / Claude Code internal training AND at least 3 internal sessions delivered in the period (e.g., intro workshop, hands-on lab, advanced patterns) AND session recordings and playbooks stored in a shared, searchable repository.",
          "- Over Achieved: ≥ 95% training completion AND at least 6 internal sessions delivered including role-specific deep-dives (dev, QA, PM, docs) AND ≥ 50% of team members have co-led or contributed content to a session AND a published internal \"prompt/pattern library\" actively maintained.",
          "- Role Model: 100% training completion across all departments AND a continuous enablement cadence (weekly office hours or clinics) AND the team exports training to other teams/departments AND external recognition (internal showcase, case study, or cross-org adoption driven by this team).",
        ].join("\n"),
      },
    ],
  },
];

/**
 * Normalise the Zoho "High"/"Medium" priority chip to the lowercase
 * enum the spec validator uses ("low"|"medium"|"high"|""). Matches the
 * normaliser in import-zoho-goals.mjs so re-imports stay consistent.
 */
function normalizePriority(raw) {
  const v = String(raw || "").trim().toLowerCase();
  if (v === "low" || v === "medium" || v === "high") return v;
  return "";
}

/**
 * Build the L1/L2 tree the goals collection expects, using the existing
 * L1 ids from `existingTree` where the L1 codes match. L2 ids are the
 * L2 codes themselves — stable across re-runs and self-documenting.
 */
function buildTree(existingTree) {
  const existingByCode = new Map();
  for (const l1 of existingTree?.l1s || []) {
    if (l1.code) existingByCode.set(l1.code, l1);
  }

  return {
    l1s: TREE.map((l1) => {
      const existing = existingByCode.get(l1.code);
      return {
        id: existing?.id || l1.code,
        code: l1.code,
        title: l1.title,
        description: "",
        rubric: l1.rubric,
        weightage: l1.weightage,
        category: existing?.category || "",
        l2s: l1.l2s.map((l2) => ({
          id: l2.code,
          code: l2.code,
          title: l2.title,
          description: l2.description,
          rubric: l2.rubric,
          weightage: l2.weightage,
          priority: normalizePriority(l2.priority),
          startDate: "",
          dueDate: "",
          category: "",
        })),
      };
    }),
  };
}

// ─── main ─────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.email) {
    console.error("✗ --email is required");
    printHelp();
    process.exit(1);
  }

  console.log(`\n  connecting to ${args.mongoUri}/${args.dbName}…`);
  const client = new MongoClient(args.mongoUri);
  await client.connect();
  try {
    const db = client.db(args.dbName);
    const users = db.collection("users");
    const goals = db.collection("goals");

    const user = await users.findOne({
      email: { $regex: `^${args.email}$`, $options: "i" },
    });
    if (!user) {
      console.error(`✗ no user found with email ${args.email}`);
      process.exit(1);
    }
    console.log(
      `  user: ${user.displayName || user.email} · _id=${user._id.toString()} · org=${user.orgId.toString()}`,
    );

    const existing = await goals.findOne({
      orgId: user.orgId,
      userId: user._id,
    });
    if (existing) {
      const existingL2Count = (existing.l1s || []).reduce(
        (s, l) => s + (l.l2s?.length || 0),
        0,
      );
      console.log(
        `  existing tree: ${existing.l1s?.length || 0} L1s, ${existingL2Count} L2s`,
      );
    } else {
      console.log("  no existing tree — will create");
    }

    const tree = buildTree(existing);
    const totalL2s = tree.l1s.reduce((s, l) => s + l.l2s.length, 0);
    console.log(`  new tree: ${tree.l1s.length} L1s, ${totalL2s} L2s`);
    for (const l1 of tree.l1s) {
      console.log(
        `    L1 [${l1.code}] ${l1.title.slice(0, 70)} (${l1.weightage}%) — ${l1.l2s.length} L2s`,
      );
      for (const l2 of l1.l2s) {
        console.log(
          `       L2 [${l2.code}] ${l2.title} (${l2.weightage}%, ${l2.priority || "no priority"})`,
        );
      }
    }

    if (args.dryRun) {
      console.log("\n  dry-run — nothing written. Re-run without --dry-run.");
      return;
    }

    const result = await goals.updateOne(
      { orgId: user.orgId, userId: user._id },
      {
        $set: {
          orgId: user.orgId,
          userId: user._id,
          schemaVersion: GOALS_SCHEMA_VERSION,
          l1s: tree.l1s,
          cycleId: null,
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );

    if (result.upsertedCount > 0) {
      console.log(`\n  ✓ inserted new goal tree (_id=${result.upsertedId})`);
    } else {
      console.log(
        `\n  ✓ updated existing goal tree (matched ${result.matchedCount}, modified ${result.modifiedCount})`,
      );
    }

    const verified = await goals.findOne({
      orgId: user.orgId,
      userId: user._id,
    });
    const verifiedL2s = (verified.l1s || []).reduce(
      (s, l) => s + (l.l2s?.length || 0),
      0,
    );
    console.log(
      `  verified: ${verified.l1s.length} L1s, ${verifiedL2s} L2s persisted.`,
    );
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error(`✗ fatal: ${e.message}`);
  if (process.env.DEBUG) console.error(e);
  process.exit(1);
});
