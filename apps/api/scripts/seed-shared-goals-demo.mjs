/**
 * Seed a shared-goals demo for one real account, for trying the feature on a
 * deployment. Plain node (no tsx) so it runs inside the api container, where
 * MONGO_URI / MONGO_DB_NAME are already set:
 *
 *   node scripts/seed-shared-goals-demo.mjs <email>                  # dry run (default)
 *   node scripts/seed-shared-goals-demo.mjs <email> --apply          # write
 *   node scripts/seed-shared-goals-demo.mjs <email> --revert         # show what would be undone
 *   node scripts/seed-shared-goals-demo.mjs <email> --revert --yes   # undo everything
 *
 * Writes (demo users tagged `seed: "shared-goals-demo"`, the goal found by code DEMO-SH-1):
 *   - your user: adds roles "manager" + "dev" (previous roles saved for revert)
 *   - 2 inactive-login test users in your org ("Demo Assignee A/B", no password)
 *   - 1 shared goal you own: weekly, 5 weeks, started 3 weeks ago, 12h grace,
 *     Africa/Cairo; assignees = you + A + B
 *   - entries for A and B only, back-dated so the grid shows on time / late /
 *     missing; you fill your own periods through the UI
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { MongoClient, ObjectId } = require("mongodb");

const [email, flag] = process.argv.slice(2);
const APPLY = flag === "--apply";
const REVERT = flag === "--revert";
const TAG = "shared-goals-demo";
const DEMO_CODE = "DEMO-SH-1"; // assigned_goals rejects extra fields, so the demo goal is found by code
if (!email || !process.env.MONGO_URI) {
  console.error("usage: MONGO_URI=... [MONGO_DB_NAME=...] node scripts/seed-shared-goals-demo.mjs <email> [--apply|--revert [--yes]]");
  process.exit(2);
}

const client = await MongoClient.connect(process.env.MONGO_URI);
// Same default as src/config/env.ts.
const db = client.db(process.env.MONGO_DB_NAME || "devhub-dev");
const users = db.collection("users");
const goals = db.collection("assigned_goals");
const inputs = db.collection("goal_inputs");
const notifications = db.collection("notifications");

const me = await users.findOne({ email: email.toLowerCase() });
if (!me) {
  console.error(`No user with email ${email} in db "${db.databaseName}".`);
  process.exit(1);
}
console.log(`db=${db.databaseName}  user=${me.displayName} <${me.email}>  roles=${JSON.stringify(me.roles ?? [me.role])}`);

if (REVERT) {
  const demoGoals = await goals.find({ orgId: me.orgId, createdBy: me._id, code: DEMO_CODE }).toArray();
  const gids = demoGoals.map((g) => `asg_${g._id.toHexString()}`);
  const demoUsers = await users.find({ seed: TAG }).toArray();
  console.log(`revert: ${demoGoals.length} goal(s), ${demoUsers.length} demo user(s), inputs on ${gids.length} goal id(s), roles back to ${JSON.stringify(me.seedPrevRoles)}`);
  if (!process.argv.includes("--yes")) {
    console.log("(dry run — add --yes to revert)");
  } else {
    await inputs.deleteMany({ goalId: { $in: gids } });
    await notifications.deleteMany({ "data.assignedGoalId": { $in: demoGoals.map((g) => g._id.toHexString()) } });
    await db.collection("manager_goal_verdicts").deleteMany({ goalId: { $in: gids } });
    await goals.deleteMany({ _id: { $in: demoGoals.map((g) => g._id) } });
    await users.deleteMany({ seed: TAG });
    if (me.seedPrevRoles) {
      await users.updateOne({ _id: me._id }, { $set: { roles: me.seedPrevRoles }, $unset: { seedPrevRoles: "" } });
    }
    console.log("reverted.");
  }
  await client.close();
  process.exit(0);
}

const now = new Date();
const DAY = 86_400_000;
const HOUR = 3_600_000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const startMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 21 * DAY;
const start = iso(startMs);
const end = iso(startMs + 35 * DAY - DAY);
const week = (i) => ({ key: `${start.slice(0, 4)}-W${i + 1}`, start: startMs + i * 7 * DAY, end: startMs + (i + 1) * 7 * DAY });
// Deadline = local (Cairo) midnight at window end + 12h grace. Cairo is UTC+3 in summer, +2 in winter;
// seeded "late" rows are 2 days after, "on time" rows 2 days before — safe either way.

const roles = new Set([...(me.roles?.length ? me.roles : [me.role]), "manager", "dev"]);
const plan = {
  roles: [...roles],
  demoUsers: ["Demo Assignee A", "Demo Assignee B"],
  goal: { title: "Demo · Weekly delivery update", cadence: "weekly", start, end, weeks: 5 },
};
console.log("plan:", JSON.stringify(plan, null, 2));
if (await goals.findOne({ orgId: me.orgId, createdBy: me._id, code: DEMO_CODE })) {
  console.log("A demo goal already exists — run --revert --yes first to re-seed.");
  await client.close();
  process.exit(1);
}
if (!APPLY) {
  console.log("(dry run — add --apply to write)");
  await client.close();
  process.exit(0);
}

await users.updateOne(
  { _id: me._id },
  { $set: { roles: [...roles], seedPrevRoles: me.roles?.length ? me.roles : [me.role] } },
);

async function demoUser(name, slug) {
  const _id = new ObjectId();
  await users.insertOne({
    _id, orgId: me.orgId, email: `${slug}+${me._id.toHexString().slice(-6)}@demo.invalid`,
    passwordHash: null, role: "dev", roles: ["dev"], status: "active",
    totpSecret: null, totpEnrolledAt: null, zohoEmployeeId: null, managerId: me._id, level: null,
    hireDate: null, displayName: name, createdAt: now, updatedAt: now, invitedBy: me._id, invitedAt: now,
    lastLoginAt: null, failedLoginAttempts: 0, lockedUntil: null,
    allowedHubs: ["dev"], primaryHub: "dev", seed: TAG,
  });
  return _id;
}
const a = await demoUser("Demo Assignee A", "demo-a");
const b = await demoUser("Demo Assignee B", "demo-b");

const goalId = new ObjectId();
await goals.insertOne({
  _id: goalId, orgId: me.orgId, createdBy: me._id, createdByName: me.displayName || me.email,
  code: DEMO_CODE, title: "Demo · Weekly delivery update",
  description: "Seeded demo. Each week: did you ship, and a short note on what.",
  spec: {
    schemaVersion: 1, kind: "manual", widget: "COMPOSED", title: "Demo · Weekly delivery update",
    reasoning: "", source: null, manual: null, context: null, delegated: null, untrackable: null,
    scorecard: null, tiers: null,
    fields: [
      { id: "shipped", kind: "checkbox", label: "Shipped something this week" },
      { id: "what", kind: "text", label: "What shipped" },
    ],
    composed: { cadence: "weekly", periodCount: 5, cycleStart: start, cycleEnd: end },
  },
  assigneeIds: [me._id, a, b], viewerIds: [], graceHours: 12, timeZone: "Africa/Cairo",
  status: "active", archivedAt: null, specRevision: 0, createdAt: now, updatedAt: now,
});
const gid = `asg_${goalId.toHexString()}`;

const entry = (userId, w, createdAt, values) => ({
  orgId: me.orgId, userId, goalId: gid, ts: new Date((w.start + w.end) / 2),
  value: { periodKey: w.key, values }, note: null, source: "manual", createdAt: new Date(createdAt),
});
await inputs.insertMany([
  // A: W1 on time, W2 late, W3 on time → 1 late
  entry(a, week(0), week(0).end - 2 * DAY, { shipped: true, what: "Login page" }),
  entry(a, week(1), week(1).end + 2 * DAY, { shipped: true, what: "Search (late)" }),
  entry(a, week(2), week(2).end - 1 * DAY, { shipped: false, what: "Blocked on review" }),
  // B: W1 late, W2 missing, W3 missing
  entry(b, week(0), week(0).end + 3 * DAY, { shipped: true, what: "Onboarding copy" }),
]);

console.log(`seeded: goal ${goalId.toHexString()} (${gid}), users A=${a} B=${b}`);
await client.close();
