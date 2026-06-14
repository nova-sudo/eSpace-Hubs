/**
 * One-off MongoDB migration: copy every collection (and its indexes)
 * from a SOURCE cluster to a DESTINATION cluster.
 *
 * Source: local Mongo (apps/api/.env.local). Defaults to
 * `mongodb://localhost:27017` / db `devhub-dev`.
 * Destination: Atlas cluster passed via CLI args or env.
 *
 * USAGE
 *   node scripts/migrate-mongo.mjs \
 *     --src "mongodb://localhost:27017" --srcDb "devhub-dev" \
 *     --dst "mongodb+srv://USER:PASS@HOST/" --dstDb "devhub-dev" \
 *     [--dry-run] [--drop-target]
 *
 * Behaviour notes
 * ───────────────
 * - DEFAULT mode preserves any existing data in the destination
 *   (inserts only). Pass `--drop-target` to drop each destination
 *   collection BEFORE copying — recommended when the destination is
 *   a fresh cluster that should mirror the source exactly.
 * - `--dry-run` connects to both ends + lists collection counts
 *   without writing anything. Always run dry-run first when you're
 *   not sure.
 * - Indexes are recreated on the destination AFTER documents are
 *   copied so the import doesn't fight uniqueness constraints
 *   during insert. Failed-to-create indexes are logged but do not
 *   abort the migration.
 * - The script DOES NOT delete from the source — it's a copy, not a
 *   move. Source stays intact; you point the app at the destination
 *   when ready and decommission the source on your own schedule.
 *
 * Failure recovery
 * ────────────────
 * Re-running with `--drop-target` is idempotent (each collection
 * starts fresh). Without `--drop-target`, duplicate _id errors are
 * tolerated because we use `ordered: false` — partial batches still
 * land what they can.
 */

import { MongoClient } from "mongodb";

const args = parseArgs(process.argv.slice(2));

const SRC_URI = args.src || process.env.SRC_URI;
const SRC_DB = args.srcDb || process.env.SRC_DB || "devhub-dev";
const DST_URI = args.dst || process.env.DST_URI;
const DST_DB = args.dstDb || process.env.DST_DB || SRC_DB;
const DRY_RUN = Boolean(args["dry-run"]);
const DROP_TARGET = Boolean(args["drop-target"]);
const BATCH = Number(args.batch || 500);

if (!SRC_URI || !DST_URI) {
  console.error(
    "Missing --src and/or --dst. See script header for usage.",
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
  // Mask the password portion of a mongodb URL so console logs
  // don't leak credentials.
  return String(uri).replace(/:\/\/([^:]+):([^@]+)@/, "://$1:***@");
}

async function main() {
  console.log("MongoDB migration");
  console.log(`  Source:      ${redact(SRC_URI)} db=${SRC_DB}`);
  console.log(`  Destination: ${redact(DST_URI)} db=${DST_DB}`);
  console.log(`  Mode:        ${DRY_RUN ? "DRY-RUN" : "LIVE"}${DROP_TARGET ? " · drop-target" : ""}`);
  console.log(`  Batch size:  ${BATCH}`);
  console.log("");

  const srcClient = new MongoClient(SRC_URI);
  const dstClient = new MongoClient(DST_URI);

  try {
    await srcClient.connect();
    console.log("✓ Connected to source");
    await dstClient.connect();
    console.log("✓ Connected to destination");

    const srcDb = srcClient.db(SRC_DB);
    const dstDb = dstClient.db(DST_DB);

    // List ALL collections including system ones (we filter
    // system.* out below). Some Atlas tiers reject inserts into
    // system collections.
    const collections = await srcDb
      .listCollections({}, { nameOnly: false })
      .toArray();
    const userCollections = collections
      .filter((c) => !c.name.startsWith("system."))
      // Skip views — they aren't real collections and can't be
      // copied; the user would re-create them on the destination
      // separately if they have any.
      .filter((c) => c.type !== "view");

    console.log(
      `\n${userCollections.length} user collections in ${SRC_DB}` +
        (collections.length - userCollections.length > 0
          ? ` (skipping ${collections.length - userCollections.length} system/view)`
          : ""),
    );

    const summary = [];
    for (const coll of userCollections) {
      const name = coll.name;
      const srcColl = srcDb.collection(name);
      const dstColl = dstDb.collection(name);

      const srcCount = await srcColl.countDocuments();
      const dstCountBefore = await dstColl.countDocuments();
      console.log(
        `\n[${name}] src=${srcCount} dst=${dstCountBefore}`,
      );

      if (DRY_RUN) {
        summary.push({ name, srcCount, dstBefore: dstCountBefore, copied: 0 });
        continue;
      }

      if (DROP_TARGET && dstCountBefore > 0) {
        console.log(`  · dropping destination collection (${dstCountBefore} docs)`);
        await dstColl.drop();
      }

      if (srcCount === 0) {
        console.log(`  · source is empty — nothing to copy`);
        summary.push({ name, srcCount, dstBefore: dstCountBefore, copied: 0 });
        continue;
      }

      // Stream + batch insert. `ordered: false` lets a batch
      // continue past duplicate-_id errors (relevant when not
      // using --drop-target).
      const cursor = srcColl.find({});
      let batch = [];
      let copied = 0;
      for await (const doc of cursor) {
        batch.push(doc);
        if (batch.length >= BATCH) {
          await safeInsert(dstColl, batch);
          copied += batch.length;
          batch = [];
          process.stdout.write(`\r  · copying ${copied}/${srcCount}`);
        }
      }
      if (batch.length > 0) {
        await safeInsert(dstColl, batch);
        copied += batch.length;
      }
      process.stdout.write(`\r  · copied ${copied}/${srcCount}      \n`);

      // Copy indexes — skip the implicit _id_ which every
      // collection already has.
      const indexes = await srcColl.listIndexes().toArray();
      let createdIndexes = 0;
      for (const idx of indexes) {
        if (idx.name === "_id_") continue;
        const { key, name: idxName, v: _v, ns: _ns, ...opts } = idx;
        try {
          await dstColl.createIndex(key, { ...opts, name: idxName });
          createdIndexes++;
        } catch (err) {
          console.log(`  ! index ${idxName} failed: ${err.message}`);
        }
      }
      console.log(`  · ${createdIndexes} indexes copied`);

      summary.push({ name, srcCount, dstBefore: dstCountBefore, copied });
    }

    console.log("\n──────── Summary ────────");
    for (const s of summary) {
      console.log(
        `  ${s.name.padEnd(28)} ${String(s.copied).padStart(6)} copied  (src=${s.srcCount}, dst-before=${s.dstBefore})`,
      );
    }
    console.log(
      `\n${DRY_RUN ? "Dry-run" : "Migration"} complete.`,
    );
  } finally {
    await srcClient.close().catch(() => {});
    await dstClient.close().catch(() => {});
  }
}

async function safeInsert(coll, docs) {
  try {
    await coll.insertMany(docs, { ordered: false });
  } catch (err) {
    // BulkWriteError carries `writeErrors` for the rows that
    // failed (typically duplicate _id). We've already inserted
    // what we could thanks to ordered:false — log + continue.
    const code = err?.code;
    if (code === 11000 || /duplicate key/i.test(err?.message || "")) {
      // Quiet — duplicates are expected when migrating into a
      // partially-populated destination.
      return;
    }
    throw err;
  }
}

main().catch((err) => {
  console.error("\nFATAL:", err.message || err);
  console.error(err.stack);
  process.exit(1);
});
