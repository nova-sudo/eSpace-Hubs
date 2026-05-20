/**
 * One-off backfill: set `engagement: "espace"` on every user row that
 * doesn't already have an engagement field set.
 *
 * Without this, the Mongo $jsonSchema validator (which allows null but
 * not undefined for the field) would still accept legacy rows because
 * the field is optional, BUT the readers default to "espace" already
 * — so existing users would silently behave as eSpace devs. We run
 * this backfill to make the data explicit + so admin patches that
 * change the engagement have a real `before` value to audit-log
 * instead of "(unset)".
 *
 * USAGE
 *   node scripts/backfill-user-engagement.mjs \
 *     --mongo "mongodb+srv://USER:PASS@HOST/" \
 *     --db    "devhub-dev" \
 *     [--default-engagement "espace"] [--dry-run]
 *
 * Falls back to apps/api/.env.local's MONGO_URI / MONGO_DB_NAME when
 * --mongo / --db aren't passed.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argv = parseArgs(process.argv.slice(2));

// Read apps/api/.env.local for fallback Mongo URI + DB name. We
// don't take a hard dependency on dotenv — just parse the file
// ourselves since the format is line-based KEY=VALUE.
function readApiEnvLocal() {
  const p = path.resolve(__dirname, "..", "apps", "api", ".env.local");
  if (!fs.existsSync(p)) return {};
  const out = {};
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}
const envFile = readApiEnvLocal();

const MONGO_URI = argv.mongo || process.env.MONGO_URI || envFile.MONGO_URI;
const DB_NAME =
  argv.db || process.env.MONGO_DB_NAME || envFile.MONGO_DB_NAME || "devhub-dev";
const DEFAULT_ENGAGEMENT =
  argv["default-engagement"] || envFile.DEFAULT_ENGAGEMENT || "espace";
const DRY_RUN = Boolean(argv["dry-run"]);

if (!MONGO_URI) {
  console.error(
    "Missing --mongo / MONGO_URI / apps/api/.env.local. See usage.",
  );
  process.exit(1);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next == null || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function redact(uri) {
  return String(uri).replace(/:\/\/([^:]+):([^@]+)@/, "://$1:***@");
}

async function main() {
  console.log("Backfill: User.engagement");
  console.log(`  Mongo: ${redact(MONGO_URI)} db=${DB_NAME}`);
  console.log(`  Default engagement: "${DEFAULT_ENGAGEMENT}"`);
  console.log(`  Mode: ${DRY_RUN ? "DRY-RUN" : "LIVE"}`);
  console.log("");

  const client = new MongoClient(MONGO_URI);
  await client.connect();
  try {
    const users = client.db(DB_NAME).collection("users");

    // Match documents where the field is missing OR explicitly null.
    // (We treat both as "needs backfill".)
    const filter = {
      $or: [
        { engagement: { $exists: false } },
        { engagement: null },
      ],
    };

    const toBackfill = await users.countDocuments(filter);
    console.log(`Users without an engagement set: ${toBackfill}`);

    if (DRY_RUN || toBackfill === 0) {
      console.log(DRY_RUN ? "Dry-run — no writes." : "Nothing to do.");
      return;
    }

    const res = await users.updateMany(filter, {
      $set: { engagement: DEFAULT_ENGAGEMENT, updatedAt: new Date() },
    });
    console.log(`Updated ${res.modifiedCount} users → engagement="${DEFAULT_ENGAGEMENT}"`);
  } finally {
    await client.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error("FATAL:", err.message || err);
  process.exit(1);
});
