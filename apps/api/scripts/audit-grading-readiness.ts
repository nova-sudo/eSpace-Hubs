/**
 * Read-only audit: for every user, can their goals actually show a grade?
 *
 * A goal only renders a tier badge when BOTH are true:
 *   1. a goal_specs row exists for (userId, goalId)   — else it reads unclassified
 *   2. that spec carries `tiers`                       — else GoalTierBadge returns null
 *
 * Reports per user: tree size, specs owned, specs missing, specs without
 * tiers, verdicts stored, and verdicts that can never be drawn. Also flags
 * specs whose goalId belongs to ANOTHER user's tree (ownership drift).
 *
 * Usage: npx tsx scripts/audit-grading-readiness.ts
 */
import { connect, disconnect } from "../src/db/client.js";
import {
  getUsersCollection,
  getGoalsCollection,
  getGoalSpecsCollection,
  getGoalInputsCollection,
  getGoalTierVerdictsCollection,
  getManagerGoalVerdictsCollection,
} from "../src/db/collections.js";

type L2 = { id: string; title?: string };

function l2sOf(tree: any): L2[] {
  const out: L2[] = [];
  for (const l1 of tree?.l1s || []) {
    for (const l2 of l1?.l2s || []) out.push({ id: String(l2.id), title: l2.title });
  }
  return out;
}

async function main(): Promise<void> {
  await connect();
  const users = await (await getUsersCollection()).find({}).toArray();
  const trees = await (await getGoalsCollection()).find({}).toArray();
  const specs = await (await getGoalSpecsCollection()).find({}).toArray();
  const inputs = await (await getGoalInputsCollection()).find({}).toArray();
  const verdicts = await (await getGoalTierVerdictsCollection()).find({}).toArray();
  const mgr = await (await getManagerGoalVerdictsCollection()).find({}).toArray();

  const emailOf = new Map(users.map((u: any) => [String(u._id), u.email]));

  // goalId -> set of userIds whose TREE contains it
  const treeOwners = new Map<string, Set<string>>();
  for (const t of trees as any[]) {
    for (const g of l2sOf(t)) {
      if (!treeOwners.has(g.id)) treeOwners.set(g.id, new Set());
      treeOwners.get(g.id)!.add(String(t.userId));
    }
  }

  console.log("=".repeat(78));
  console.log("PER-USER GRADING READINESS");
  console.log("=".repeat(78));

  for (const u of users as any[]) {
    const uid = String(u._id);
    const tree = (trees as any[]).find((t) => String(t.userId) === uid);
    const goals = tree ? l2sOf(tree) : [];
    if (goals.length === 0) continue;

    const mySpecs = (specs as any[]).filter((s) => String(s.userId) === uid);
    const specByGoal = new Map(mySpecs.map((s) => [String(s.goalId), s]));
    const myVerdicts = (verdicts as any[]).filter((v) => String(v.userId) === uid);
    const myMgr = (mgr as any[]).filter((v) => String(v.userId) === uid);
    const myInputs = (inputs as any[]).filter((i) => String(i.userId) === uid);

    const noSpec: L2[] = [];
    const noTiers: L2[] = [];
    const gradable: L2[] = [];
    for (const g of goals) {
      const s = specByGoal.get(g.id);
      if (!s) noSpec.push(g);
      else if (!s.spec?.tiers) noTiers.push(g);
      else gradable.push(g);
    }

    const gradableIds = new Set(gradable.map((g) => g.id));
    const buriedVerdicts = myVerdicts.filter((v) => !gradableIds.has(String(v.goalId)));

    console.log(`\n${u.email}  (${uid})`);
    console.log(`  goals in tree            ${goals.length}`);
    console.log(`  specs owned              ${mySpecs.length}`);
    console.log(`  → no spec at all         ${noSpec.length}`);
    console.log(`  → spec but no tiers      ${noTiers.length}`);
    console.log(`  → CAN show a grade       ${gradable.length}`);
    console.log(`  inputs owned             ${myInputs.length}`);
    console.log(`  AI verdicts stored       ${myVerdicts.length}  (undrawable: ${buriedVerdicts.length})`);
    console.log(`  manager verdicts         ${myMgr.length}`);

    // Specs this user owns whose goalId is NOT in their own tree.
    const drifted = mySpecs.filter((s) => {
      const owners = treeOwners.get(String(s.goalId));
      return owners && !owners.has(uid);
    });
    if (drifted.length) {
      console.log(`  !! ${drifted.length} spec(s) for goals that live in SOMEONE ELSE'S tree:`);
      for (const s of drifted) {
        const owners = [...(treeOwners.get(String(s.goalId)) || [])].map((o) => emailOf.get(o) ?? o);
        console.log(`       ${s.goalId} → tree owned by ${owners.join(", ")}`);
      }
    }
    const orphanSpecs = mySpecs.filter((s) => !treeOwners.has(String(s.goalId)));
    if (orphanSpecs.length) {
      console.log(`  ?? ${orphanSpecs.length} spec(s) for goalIds in NO tree: ${orphanSpecs.map((s) => s.goalId).join(", ")}`);
    }
  }

  console.log(`\n${"=".repeat(78)}`);
  console.log("TOTALS");
  console.log("=".repeat(78));
  const specsWithTiers = (specs as any[]).filter((s) => s.spec?.tiers).length;
  console.log(`specs in db: ${specs.length}, of which carry tiers: ${specsWithTiers}`);
  console.log(`verdicts in db: ${verdicts.length}`);
  await disconnect();
}

main().catch(async (err) => {
  console.error("[audit] failed:", err instanceof Error ? err.message : err);
  await disconnect().catch(() => {});
  process.exit(1);
});
