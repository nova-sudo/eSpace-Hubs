/**
 * Full wipe for ONE user — everything they've built in the app, goals
 * included. Writes an EJSON backup of every deleted document first.
 *
 * Deletes: goals, goal_specs, goal_context, goal_inputs, goal_tier_verdicts,
 *   manager_goal_verdicts, grading_verdicts, snapshots, notifications,
 *   review_packets, goal_evidence files + chunks.
 * Keeps: the user, sessions, integrations (login + provider connections).
 *
 * Usage:
 *   MONGO_URI=... [MONGO_DB_NAME=devhub] node apps/api/scripts/wipe-user-data.mjs <email> <backup.json>
 */

import fs from "node:fs";
import { MongoClient, BSON } from "mongodb";

const { EJSON } = BSON;

const [EMAIL, BACKUP] = process.argv.slice(2);
const URI = process.env.MONGO_URI;
const DB = process.env.MONGO_DB_NAME || "devhub";
if (!EMAIL || !BACKUP || !URI) {
  console.error("usage: MONGO_URI=... node wipe-user-data.mjs <email> <backup.json>");
  process.exit(1);
}

const COLLECTIONS = [
  "goals", "goal_specs", "goal_context", "goal_inputs", "goal_tier_verdicts",
  "manager_goal_verdicts", "grading_verdicts", "snapshots", "notifications",
  "review_packets", "goal_evidence.files",
];

const client = new MongoClient(URI, { serverSelectionTimeoutMS: 10000 });
await client.connect();
try {
  const db = client.db(DB);
  const user = await db.collection("users").findOne({ email: { $regex: `^${EMAIL.replace(/[.+]/g, "\\$&")}$`, $options: "i" } });
  if (!user) throw new Error(`no user for ${EMAIL}`);
  const id = user._id;
  const q = { $or: [{ userId: id }, { userId: id.toHexString() }, { "metadata.userId": id }, { "metadata.userId": id.toHexString() }] };

  const backup = {};
  for (const n of COLLECTIONS) backup[n] = await db.collection(n).find(q).toArray();
  const fileIds = backup["goal_evidence.files"].map((f) => f._id);
  backup["goal_evidence.chunks"] = await db.collection("goal_evidence.chunks").find({ files_id: { $in: fileIds } }).toArray();
  fs.writeFileSync(BACKUP, EJSON.stringify(backup));
  console.log(`[wipe] backup → ${BACKUP}`);

  const chunks = await db.collection("goal_evidence.chunks").deleteMany({ files_id: { $in: fileIds } });
  console.log(`[wipe] ${"goal_evidence.chunks".padEnd(24)} deleted ${chunks.deletedCount}`);
  for (const n of COLLECTIONS) {
    const r = await db.collection(n).deleteMany(q);
    console.log(`[wipe] ${n.padEnd(24)} deleted ${r.deletedCount}`);
  }
} finally {
  await client.close();
}
