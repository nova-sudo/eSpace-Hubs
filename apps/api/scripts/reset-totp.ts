/**
 * One-shot CLI: reset a user's two-factor enrolment.
 *
 * Usage:
 *   npm run admin:reset-totp -- --email=someone@example.com
 *
 * Optional:
 *   --org=<slug>   defaults to "default"
 *
 * Why this exists:
 *   - The in-app admin reset (POST /admin/users/:id/totp/reset) needs a
 *     second, signed-in admin. On a single-admin instance where the
 *     admin has lost both their authenticator AND their backup codes,
 *     nobody is left to click the button.
 *   - Mirrors the admin endpoint exactly: clears the TOTP secret, the
 *     enrolment stamp AND every backup code, and flips live sessions to
 *     `totpEnrolled: false` so they are routed back through /totp-setup.
 *
 * Connects to Mongo, runs the update, exits. Does NOT start the server.
 */

import { connect, disconnect } from "../src/db/client.js";
import {
  bootstrap,
  getOrgsCollection,
  getSessionsCollection,
  getUsersCollection,
} from "../src/db/collections.js";
import { writeAudit } from "../src/lib/audit.js";
import { logger } from "../src/lib/logger.js";

interface Args {
  email: string;
  org: string;
}

function die(message: string): never {
  // eslint-disable-next-line no-console
  console.error(`[admin:reset-totp] ${message}`);
  // eslint-disable-next-line no-console
  console.error(
    "\nUsage:\n  npm run admin:reset-totp -- --email=you@example.com [--org=default]",
  );
  process.exit(1);
}

function parseArgs(argv: readonly string[]): Args {
  const out: Partial<Args> = { org: "default" };
  for (const raw of argv) {
    const eq = raw.indexOf("=");
    if (!raw.startsWith("--") || eq < 0) die(`unrecognised arg: ${raw}`);
    const key = raw.slice(2, eq);
    const value = raw.slice(eq + 1);
    switch (key) {
      case "email":
        out.email = value.toLowerCase();
        break;
      case "org":
        out.org = value;
        break;
      default:
        die(`unrecognised flag: --${key}`);
    }
  }
  if (!out.email) die("missing required --email");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) {
    die("--email must look like an email");
  }
  return out as Args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  await connect();
  await bootstrap();

  const orgs = await getOrgsCollection();
  const org = await orgs.findOne({ slug: args.org });
  if (!org) die(`org not found: slug="${args.org}"`);

  const users = await getUsersCollection();
  const user = await users.findOne({ orgId: org._id, email: args.email });
  if (!user) {
    die(`user not found: ${args.email} (org="${args.org}")`);
  }

  const now = new Date();
  await users.updateOne(
    { _id: user._id },
    {
      $set: {
        totpSecret: null,
        totpEnrolledAt: null,
        // Backup codes belong to the enrolment — wipe them with it.
        totpBackupCodes: null,
        totpBackupCodesGeneratedAt: null,
        updatedAt: now,
      },
    },
  );

  const sessions = await getSessionsCollection();
  await sessions.updateMany(
    { userId: user._id },
    { $set: { totpEnrolled: false } },
  );

  await writeAudit({
    orgId: org._id,
    actorUserId: null, // system action — the CLI runs out-of-session
    actorRole: null,
    action: "user.totp_reset_cli",
    targetType: "user",
    targetId: user._id.toHexString(),
    before: {
      totpEnrolledAt: user.totpEnrolledAt
        ? user.totpEnrolledAt.toISOString()
        : null,
    },
    after: { totpEnrolledAt: null, backupCodes: null },
    ip: null,
    ua: "reset-totp-cli",
  });

  logger.info(
    { userId: user._id.toHexString(), orgSlug: org.slug, email: args.email },
    "[admin:reset-totp] two-factor reset",
  );
  // eslint-disable-next-line no-console
  console.log(
    `\n✔ Two-factor reset for ${args.email}. Backup codes cleared.` +
      "\n  They'll be asked to set up an authenticator on next sign-in.",
  );
}

main()
  .then(async () => {
    await disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    logger.error({ err }, "[admin:reset-totp] failed");
    await disconnect().catch(() => {});
    process.exit(1);
  });
