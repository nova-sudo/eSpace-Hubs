/**
 * One-shot CLI: reset a user's password.
 *
 * Usage:
 *   npm run admin:reset-password -- --email=manager@example.com --password='newsecret'
 *
 * Optional:
 *   --org=<slug>   defaults to "default"
 *
 * Why this exists:
 *   - Passwords are argon2id-hashed and irreversible — a forgotten
 *     password can NEVER be recovered, only reset.
 *   - The built-in /forgot-password flow emails a reset link, so it's
 *     useless on an instance without email configured.
 *   - A raw mongosh update would skip the exact argon2 params the app
 *     verifies against. This reuses the project's own `hashPassword`, so
 *     the stored hash matches — and it clears the login-lockout counter
 *     so the user can sign in immediately.
 *
 * Connects to Mongo, runs the update, exits. Does NOT start the server.
 */

import { connect, disconnect } from "../src/db/client.js";
import {
  bootstrap,
  getOrgsCollection,
  getUsersCollection,
} from "../src/db/collections.js";
import { hashPassword } from "../src/lib/argon2.js";
import { writeAudit } from "../src/lib/audit.js";
import { logger } from "../src/lib/logger.js";

interface Args {
  email: string;
  password: string;
  org: string;
}

function die(message: string): never {
  // eslint-disable-next-line no-console
  console.error(`[admin:reset-password] ${message}`);
  // eslint-disable-next-line no-console
  console.error(
    "\nUsage:\n  npm run admin:reset-password -- --email=you@example.com --password='newsecret' [--org=default]",
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
      case "password":
        out.password = value;
        break;
      case "org":
        out.org = value;
        break;
      default:
        die(`unrecognised flag: --${key}`);
    }
  }
  if (!out.email) die("missing required --email");
  if (!out.password) die("missing required --password");
  if (out.password.length < 8) die("--password must be at least 8 chars");
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

  const passwordHash = await hashPassword(args.password);
  const now = new Date();

  await users.updateOne(
    { _id: user._id },
    {
      $set: {
        passwordHash,
        // Clear any lockout so the reset takes effect immediately.
        failedLoginAttempts: 0,
        lockedUntil: null,
        updatedAt: now,
      },
    },
  );

  await writeAudit({
    orgId: org._id,
    actorUserId: null, // system action — the CLI runs out-of-session
    actorRole: null,
    action: "user.password_reset_cli",
    targetType: "user",
    targetId: user._id.toHexString(),
    after: { email: args.email },
    ip: null,
    ua: "reset-password-cli",
  });

  logger.info(
    {
      userId: user._id.toHexString(),
      orgSlug: org.slug,
      email: args.email,
    },
    "[admin:reset-password] password reset",
  );
  // eslint-disable-next-line no-console
  console.log(
    `\n✔ Password reset for ${args.email}. Sign in with the new password now.` +
      "\n  (If TOTP is enrolled, you'll still be asked for your 2FA code.)",
  );
}

main()
  .then(async () => {
    await disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    logger.error({ err }, "[admin:reset-password] failed");
    await disconnect().catch(() => {});
    process.exit(1);
  });
