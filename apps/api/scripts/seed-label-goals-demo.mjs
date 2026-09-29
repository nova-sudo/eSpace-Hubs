/**
 * Seed a set of goals that exercise the GitHub label / ticket / query features
 * for one real account, for trying them on a deployment. Plain node (no tsx)
 * so it runs inside the api container, where MONGO_URI / MONGO_DB_NAME are
 * already set:
 *
 *   node scripts/seed-label-goals-demo.mjs <email>                 # dry run (default)
 *   node scripts/seed-label-goals-demo.mjs <email> --apply         # write
 *   node scripts/seed-label-goals-demo.mjs <email> --revert        # show what would be undone
 *   node scripts/seed-label-goals-demo.mjs <email> --revert --yes  # undo everything
 *
 * Optional: --repo owner/name (default nova-sudo/espace-hubs) scopes every
 * goal to one repository so the numbers match a labelled seed exactly.
 *
 * Writes (found again by the L1 code DEMO-LBL):
 *   - one L1 "Demo · GitHub signals" appended to your goal tree, with six L2s
 *   - one goal_specs row per L2, already classified (no AI call, no review):
 *       1 ASSISTED_SHARE     % of merged PRs labelled claude-code-assisted …   target >= 80
 *       2 LABEL_SHARE count  merged PRs labelled bug                            target >= 5
 *       3 LABEL_SHARE share  % of merged PRs labelled hotfix                    target <= 10
 *       4 LABEL_SHARE + a label_select question — nothing watched until you pick
 *       5 TICKET_TYPE_SHARE  merged PRs whose Jira ticket is a Bug (needs Jira)
 *       6 COMPOSED tracker whose fields read themselves: pr_label_count(bug)
 *         and repo_file_exists(AGENTS.md) — the scoped query templates
 *
 * Expected on the nova-sudo/espace-hubs seed (30 merged PRs YTD by nova-sudo):
 *   1 → 33% (10 of 30)   2 → 5   3 → 7% (2 of 30)   6 → 5 and "yes"
 * The account's GitHub integration must be the PR author (nova-sudo).
 */
import { createRequire } from "node:module";
import { validateSpec } from "@espace-devhub/shared/goal-specs";

const require = createRequire(import.meta.url);
const { MongoClient } = require("mongodb");

const args = process.argv.slice(2);
const email = args.find((a) => !a.startsWith("--"));
const APPLY = args.includes("--apply");
const REVERT = args.includes("--revert");
const repoArg = args[args.indexOf("--repo") + 1];
const REPO = (args.includes("--repo") && repoArg ? repoArg : "nova-sudo/espace-hubs").toLowerCase();
const L1_CODE = "DEMO-LBL";
const CLASSIFIER = "seed:label-goals-demo";

if (!email || !process.env.MONGO_URI) {
  console.error(
    "usage: MONGO_URI=... [MONGO_DB_NAME=...] node scripts/seed-label-goals-demo.mjs <email> [--apply|--revert [--yes]] [--repo owner/name]",
  );
  process.exit(2);
}

// ─── the goals ───────────────────────────────────────────────────────

const year = new Date().getUTCFullYear();
const stamp = Date.now().toString(36);
const gid = (n) => `demo-lbl-${stamp}-${n}`;
const l2 = (n, code, title, description) => ({
  id: gid(n),
  code: `${L1_CODE}-L2-0${n}`,
  title,
  description,
  rubric: "",
  weightage: 0,
  priority: "medium",
  startDate: `${year}-01-01`,
  dueDate: `${year}-12-31`,
  category: "Demo",
});

const l1 = {
  id: gid(0),
  code: L1_CODE,
  title: "Demo · GitHub signals",
  description: "Seeded goals that exercise label, ticket and query tracking. Safe to delete.",
  rubric: "",
  weightage: 0,
  category: "Demo",
  l2s: [
    l2(1, "AI adoption", "Ship 80% of my merged PRs with Claude Code assistance."),
    l2(2, "Bug fixes shipped", "Fix at least 5 bug PRs this year."),
    l2(3, "Hotfix share", "Keep hotfixes under 10% of my merged PRs."),
    l2(4, "Pick your own label", "Track a label of your choosing across my merged PRs."),
    l2(5, "Bug tickets closed", "Merge PRs against Jira Bug tickets."),
    l2(6, "Repo hygiene tracker", "A build-your-own tracker whose fields read themselves from GitHub."),
  ],
};

// Every spec goes through the same validator the API and the classifier use,
// so a shape this script gets wrong fails here rather than rendering blank.
function spec(goal, body) {
  const result = validateSpec({
    schemaVersion: 1,
    goalId: goal.id,
    title: goal.title,
    reasoning: "Seeded for testing — not AI-classified.",
    context: null,
    delegated: null,
    untrackable: null,
    scorecard: null,
    tiers: null,
    ...body,
  });
  if (!result.ok || !result.spec) {
    console.error(`spec for "${goal.title}" invalid:`, result.errors);
    process.exit(1);
  }
  return result.spec;
}
const auto = (metric, extra = {}) => ({
  kind: "auto",
  manual: null,
  fields: null,
  composed: null,
  source: { provider: "github", metric, window: "90d", filter: { repo: REPO }, ...extra },
});

const [g1, g2, g3, g4, g5, g6] = l1.l2s;
const specBodies = [
  [g1, { widget: "ASSISTED_SHARE", ...auto("assisted_share", { target: { op: ">=", value: 80 } }) }],
  [g2, { widget: "LABEL_SHARE", ...auto("label_share", { labels: ["bug"], labelMode: "count", target: { op: ">=", value: 5 } }) }],
  [g3, { widget: "LABEL_SHARE", ...auto("label_share", { labels: ["hotfix"], target: { op: "<=", value: 10 } }) }],
  [
    g4,
    {
      widget: "LABEL_SHARE",
      ...auto("label_share"),
      context: {
        required: true,
        questions: [
          { id: "labels", kind: "label_select", prompt: "Which PR labels should this goal count?" },
        ],
      },
    },
  ],
  [g5, { widget: "TICKET_TYPE_SHARE", ...auto("ticket_type_share", { filter: { repo: REPO, ticketType: "bug" } }) }],
  [
    g6,
    {
      widget: "COMPOSED",
      kind: "manual",
      source: null,
      manual: null,
      composed: { cadence: "monthly", prompt: "This month's repo check — the two auto fields read themselves." },
      fields: [
        {
          id: "bug-prs",
          kind: "counter",
          label: "Bug PRs I merged this year",
          unit: "PRs",
          source: { provider: "github", query: "pr_label_count", params: { repo: REPO, label: "bug" }, extract: "count" },
        },
        {
          id: "agents-md",
          kind: "checkbox",
          label: "AGENTS.md present in the repo",
          source: { provider: "github", query: "repo_file_exists", params: { repo: REPO, path: "AGENTS.md" }, extract: "exists" },
        },
        { id: "note", kind: "text", label: "Anything worth noting", optional: true },
      ],
    },
  ],
];
const built = specBodies.map(([goal, body]) => ({ goal, spec: spec(goal, body) }));

// Specs are built and validated BEFORE touching the database, so a shape
// mistake fails fast and never leaves a half-written tree behind.
const client = await MongoClient.connect(process.env.MONGO_URI);
// Same default as src/config/env.ts.
const db = client.db(process.env.MONGO_DB_NAME || "devhub-dev");
const users = db.collection("users");
const goals = db.collection("goals");
const specs = db.collection("goal_specs");

const me = await users.findOne({ email: email.toLowerCase() });
if (!me) {
  console.error(`No user with email ${email} in db "${db.databaseName}".`);
  process.exit(1);
}
const scope = { orgId: me.orgId, userId: me._id };
console.log(`db=${db.databaseName}  user=${me.displayName} <${me.email}>  repo=${REPO}`);

const tree = await goals.findOne(scope);
const existing = (tree?.l1s ?? []).find((l1) => l1.code === L1_CODE) ?? null;

if (REVERT) {
  const ids = existing ? [existing.id, ...(existing.l2s ?? []).map((l2) => l2.id)] : [];
  console.log(`revert: ${existing ? 1 : 0} L1, ${Math.max(0, ids.length - 1)} L2s, specs/inputs/context/readings on ${ids.length} goal id(s)`);
  if (!args.includes("--yes")) {
    console.log("(dry run — add --yes to revert)");
  } else if (ids.length > 0) {
    await goals.updateOne(scope, { $pull: { l1s: { code: L1_CODE } }, $set: { updatedAt: new Date() } });
    await specs.deleteMany({ ...scope, goalId: { $in: ids } });
    for (const name of ["goal_inputs", "goal_context", "goal_tier_verdicts", "goal_locks"]) {
      await db.collection(name).deleteMany({ ...scope, goalId: { $in: ids } });
    }
    console.log("reverted.");
  }
  await client.close();
  process.exit(0);
}

if (existing) {
  console.log(`An L1 with code ${L1_CODE} already exists — run --revert --yes first to re-seed.`);
  await client.close();
  process.exit(1);
}


console.log("plan:");
for (const { goal, spec: s } of built) {
  const detail =
    s.widget === "COMPOSED"
      ? `${s.fields.length} fields, ${s.fields.filter((f) => f.source).length} auto`
      : [s.source.metric, s.source.labels?.join("/"), s.source.labelMode, s.source.filter?.ticketType, s.source.target && `${s.source.target.op} ${s.source.target.value}`]
          .filter(Boolean)
          .join(" · ");
  console.log(`  ${goal.code}  ${s.widget.padEnd(18)} ${detail}`);
}
if (!APPLY) {
  console.log("(dry run — add --apply to write)");
  await client.close();
  process.exit(0);
}

const now = new Date();
if (tree) {
  await goals.updateOne(scope, { $push: { l1s: l1 }, $set: { updatedAt: now } });
} else {
  await goals.insertOne({ ...scope, schemaVersion: 2, l1s: [l1], cycleId: null, updatedAt: now });
}
await specs.insertMany(
  built.map(({ goal, spec: s }) => ({ ...scope, goalId: goal.id, spec: s, generatedAt: now, classifierVersion: CLASSIFIER })),
);
console.log(`seeded: L1 ${l1.id} with ${l1.l2s.length} L2s and ${built.length} specs. Open the Goals page.`);
await client.close();
