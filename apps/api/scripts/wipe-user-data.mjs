/**
 * Full wipe for ONE user — everything they've built in the app, goals
 * included, so the account looks like a brand-new sign-in (onboarding
 * runs again). Writes an EJSON backup of every deleted document first.
 *
 * Deletes (all pinned to the user's _id):
 *   goals, goal_specs, goal_context, goal_inputs, goal_locks, goal_cycles,
 *   review_packets, snapshots, grading_verdicts, goal_tier_verdicts,
 *   evidence (stars), notifications, notification_prefs,
 *   manager_goal_verdicts + manager_goal_verdict_events (as the subject),
 *   manager_report_notes (as the report), goal_evidence files + chunks.
 * Resets on the user row: onboardingCompletedAt → null, prefs.lastReviewDate.
 * Keeps: the user, sessions, integrations (login + provider connections),
 *   audit_log, companion devices/pairings.
 *
 * Usage:
 *   MONGO_URI=... [MONGO_DB_NAME=devhub] node apps/api/scripts/wipe-user-data.mjs <email> <backup.json> [--dry-run]
 *
 * In the deployed api container (Coolify → api → Terminal), MONGO_URI is
 * already in the environment:
 *   node scripts/wipe-user-data.mjs <email> /tmp/wipe-backup.json
 */

import fs from "node:fs";
import { MongoClient, BSON } from "mongodb";

const { EJSON } = BSON;

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const [EMAIL, BACKUP] = args.filter((a) => !a.startsWith("--"));
const URI = process.env.MONGO_URI;
const DB = process.env.MONGO_DB_NAME || "devhub";
if (!EMAIL || !BACKUP || !URI) {
  console.error(
    "usage: MONGO_URI=... node wipe-user-data.mjs <email> <backup.json> [--dry-run]",
  );
  process.exit(1);
}

const client = new MongoClient(URI, { serverSelectionTimeoutMS: 10000 });
await client.connect();
try {
  const db = client.db(DB);
  const user = await db.collection("users").findOne({ email: EMAIL.toLowerCase() });
  if (!user) throw new Error(`no user for ${EMAIL}`);
  const id = user._id;
  const hex = id.toHexString();
  console.log(`[wipe] user ${EMAIL} _id=${hex} org=${String(user.orgId)}${DRY ? "  (DRY RUN)" : ""}`);

  const byUser = { userId: { $in: [id, hex] } };
  const targets = [
    ["goals", byUser],
    ["goal_specs", byUser],
    ["goal_context", byUser],
    ["goal_inputs", byUser],
    ["goal_locks", byUser],
    ["goal_cycles", byUser],
    ["review_packets", byUser],
    ["snapshots", byUser],
    ["grading_verdicts", byUser],
    ["goal_tier_verdicts", byUser],
    ["evidence", byUser],
    ["notifications", byUser],
    ["notification_prefs", byUser],
    ["manager_goal_verdicts", { subjectUserId: id }],
    ["manager_goal_verdict_events", { subjectUserId: id }],
    ["manager_report_notes", { reportId: id }],
    ["goal_evidence.files", { "metadata.userId": { $in: [id, hex] } }],
  ];

  const backup = {};
  for (const [name, q] of targets) backup[name] = await db.collection(name).find(q).toArray();
  const fileIds = backup["goal_evidence.files"].map((f) => f._id);
  backup["goal_evidence.chunks"] = await db
    .collection("goal_evidence.chunks")
    .find({ files_id: { $in: fileIds } })
    .toArray();
  backup.users = [user];
  fs.writeFileSync(BACKUP, EJSON.stringify(backup));
  console.log(`[wipe] backup → ${BACKUP}`);

  for (const name of [...targets.map(([n]) => n), "goal_evidence.chunks"]) {
    console.log(`[wipe] ${name.padEnd(28)} ${DRY ? "would delete" : "found"} ${backup[name].length}`);
  }
  if (DRY) {
    console.log("[wipe] dry run — nothing deleted");
  } else {
    const chunks = await db
      .collection("goal_evidence.chunks")
      .deleteMany({ files_id: { $in: fileIds } });
    console.log(`[wipe] ${"goal_evidence.chunks".padEnd(28)} deleted ${chunks.deletedCount}`);
    for (const [name, q] of targets) {
      const r = await db.collection(name).deleteMany(q);
      console.log(`[wipe] ${name.padEnd(28)} deleted ${r.deletedCount}`);
    }
    await db.collection("users").updateOne(
      { _id: id },
      {
        $set: { onboardingCompletedAt: null, updatedAt: new Date() },
        $unset: { "prefs.lastReviewDate": "" },
      },
    );
    console.log("[wipe] users                        onboardingCompletedAt → null, prefs.lastReviewDate cleared");
    console.log("[wipe] done — sign out and back in; onboarding will run again.");
  }
} finally {
  await client.close();
}
