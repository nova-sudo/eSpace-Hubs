/**
 * Fresh-start reset for ONE user — wipes the derived/tracked data so the
 * account looks "just onboarded with goals added", WITHOUT touching the
 * goal tree itself.
 *
 * Deletes (scoped to the target user only — safe on a shared cluster):
 *   - snapshots
 *   - goal_inputs        (check-in entries)
 *   - goal_specs         (classified widgets)
 *   - goal_context       (context answers feeding widgets)
 *   - grading_verdicts   (AI PR grades)
 *
 * Keeps:
 *   - goals              (the L1/L2 tree)
 *   - the user, sessions, integrations, hub configs
 *
 * Usage:
 *   cd apps/api
 *   npx tsx scripts/reset-user-data.ts <email>
 *   (email defaults to the one below if omitted)
 */

import { connect, disconnect } from "../src/db/client.js";
import {
  getUsersCollection,
  getGoalsCollection,
  getGoalSpecsCollection,
  getGoalContextCollection,
  getGoalInputsCollection,
  getSnapshotsCollection,
  getGradingVerdictsCollection,
} from "../src/db/collections.js";

const EMAIL = process.argv[2] || "abdelrahman.mohamed@trybytes.ai";

async function main(): Promise<void> {
  await connect();

  const users = await getUsersCollection();
  const user = await users.findOne({ email: EMAIL });
  if (!user) {
    // eslint-disable-next-line no-console
    console.error(`[reset] no user found for email: ${EMAIL}`);
    await disconnect();
    process.exit(1);
  }
  const userId = user._id;
  // eslint-disable-next-line no-console
  console.log(
    `[reset] target user: ${EMAIL}  (_id=${userId.toHexString()}, org=${String(
      (user as { orgId?: unknown }).orgId ?? "—",
    )})`,
  );

  const goals = await getGoalsCollection();
  const goalsKept = await goals.countDocuments({ userId });

  const targets: Array<{ name: string; coll: { deleteMany: (f: object) => Promise<{ deletedCount?: number }> } }> = [
    { name: "snapshots", coll: await getSnapshotsCollection() },
    { name: "goal_inputs", coll: await getGoalInputsCollection() },
    { name: "goal_specs", coll: await getGoalSpecsCollection() },
    { name: "goal_context", coll: await getGoalContextCollection() },
    { name: "grading_verdicts", coll: await getGradingVerdictsCollection() },
  ];

  for (const t of targets) {
    const res = await t.coll.deleteMany({ userId });
    // eslint-disable-next-line no-console
    console.log(`[reset] ${t.name.padEnd(18)} deleted ${res.deletedCount ?? 0}`);
  }

  // eslint-disable-next-line no-console
  console.log(`[reset] goals KEPT: ${goalsKept} doc(s) (goal tree untouched)`);
  // eslint-disable-next-line no-console
  console.log("[reset] done — account is back to 'goals added, nothing tracked'.");

  await disconnect();
}

main().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error("[reset] failed:", err instanceof Error ? err.message : err);
  await disconnect().catch(() => {});
  process.exit(1);
});
