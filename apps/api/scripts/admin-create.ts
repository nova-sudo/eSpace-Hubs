/**
 * One-shot CLI: create the first admin user for an org.
 *
 * Usage:
 *   npm run admin:create -- --email=you@example.com --password='secret'
 *
 * Optional:
 *   --org=<slug>       defaults to "default"
 *   --display=<name>   defaults to the local-part of the email
 *   --force            allow creating an additional admin (refuses by
 *                      default if the org already has one — first-admin
 *                      bootstrap is a one-time op)
 *
 * Why this exists:
 *   - The /invite endpoint requires a logged-in admin, but a fresh
 *     install has no admin yet — chicken/egg.
 *   - Direct mongosh insertion would skip argon2 hashing, role enums,
 *     status defaults, and audit logging.
 *
 * The script connects to Mongo, runs the operation, and exits. It does
 * NOT start the Express server. Re-runs are safe — it refuses to
 * duplicate an admin unless --force is passed.
 */

import { connect, disconnect } from "../src/db/client.js";
import { bootstrap } from "../src/db/collections.js";
import { seedDefaultOrg } from "../src/db/seed.js";
import {
  getOrgsCollection,
  getUsersCollection,
} from "../src/db/collections.js";
import { hashPassword } from "../src/lib/argon2.js";
import { writeAudit } from "../src/lib/audit.js";
import { logger } from "../src/lib/logger.js";
import type { User, UserRole } from "../src/db/types.js";
import { ALL_USER_ROLES } from "../src/db/types.js";
import { DEFAULT_HUB_ID, HUB_ORDER } from "@espace-devhub/shared/hubs";

interface Args {
  email: string;
  password: string;
  org: string;
  display: string | null;
  force: boolean;
  /**
   * M-CAP roles. Defaults to ["admin"] — bootstrap admins get only
   * the admin role unless the operator explicitly opts in to more.
   * Pass --roles=admin,dev,qa to give your account multi-hub visibility
   * (useful if you're the only seat in the org during dev work).
   */
  roles: UserRole[];
}

function parseArgs(argv: readonly string[]): Args {
  const out: Partial<Args> & { force: boolean; roles: UserRole[] } = {
    org: "default",
    display: null,
    force: false,
    roles: ["admin"],
  };
  for (const raw of argv) {
    if (raw === "--force") {
      out.force = true;
      continue;
    }
    const eq = raw.indexOf("=");
    if (!raw.startsWith("--") || eq < 0) {
      die(`unrecognised arg: ${raw}`);
    }
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
      case "display":
        out.display = value;
        break;
      case "roles": {
        const parsed = value
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        for (const r of parsed) {
          if (!ALL_USER_ROLES.includes(r as UserRole)) {
            die(
              `--roles: unknown role "${r}". Allowed: ${ALL_USER_ROLES.join(", ")}.`,
            );
          }
        }
        if (parsed.length === 0) die("--roles must list at least one role");
        if (!parsed.includes("admin")) {
          die("--roles must include 'admin' (this is admin:create)");
        }
        out.roles = parsed as UserRole[];
        break;
      }
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

function die(message: string): never {
  // eslint-disable-next-line no-console
  console.error(`[admin:create] ${message}`);
  // eslint-disable-next-line no-console
  console.error(
    "\nUsage:\n  npm run admin:create -- --email=you@example.com --password='secret' [--org=default] [--display='Your Name'] [--roles=admin,dev,qa] [--force]",
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Ensure validators + indexes are in place — running this CLI on a
  // fresh DB shouldn't fail just because the server hasn't booted yet.
  await connect();
  await bootstrap();
  // The seeder is idempotent; running it here covers the case where
  // the operator runs admin:create before ever starting the server.
  if (args.org === "default") {
    await seedDefaultOrg();
  }

  const orgs = await getOrgsCollection();
  const org = await orgs.findOne({ slug: args.org });
  if (!org) {
    die(`org not found: slug="${args.org}"`);
  }

  const users = await getUsersCollection();
  const existing = await users.findOne({ orgId: org._id, email: args.email });
  if (existing) {
    die(
      `user already exists: ${args.email} (status=${existing.status}, role=${existing.role}). Use the admin dashboard or invite flow instead.`,
    );
  }

  if (!args.force) {
    const adminCount = await users.countDocuments({
      orgId: org._id,
      role: "admin",
    });
    if (adminCount > 0) {
      die(
        `org "${args.org}" already has ${adminCount} admin(s). Pass --force to create another (or use the admin dashboard once it ships in M7).`,
      );
    }
  }

  const display =
    args.display && args.display.trim().length > 0
      ? args.display.trim()
      : args.email.split("@")[0] ?? args.email;

  const passwordHash = await hashPassword(args.password);
  const now = new Date();

  // M-CAP: write both the legacy `role` (= roles[0]) and the new
  // multi-role `roles` array. `roles` drives /hubs/me; the singular
  // field is kept for compat until removed in a follow-up.
  const draft = {
    orgId: org._id,
    email: args.email,
    passwordHash,
    role: args.roles[0],
    roles: args.roles,
    status: "active" as const,
    totpSecret: null,
    totpEnrolledAt: null,
    zohoEmployeeId: null,
    managerId: null,
    level: null,
    hireDate: null,
    displayName: display,
    createdAt: now,
    updatedAt: now,
    invitedBy: null,
    invitedAt: null,
    lastLoginAt: null,
    failedLoginAttempts: 0,
    lockedUntil: null,
    // Bootstrap admin lands with access to every hub by default —
    // they're the org's first user and the most likely candidate to
    // visit any hub for setup work. Onboarding (M-OB) and the admin
    // config UI (M10.5) refine this for everyone else.
    allowedHubs: [...HUB_ORDER],
    primaryHub: DEFAULT_HUB_ID,
    // Bootstrap admin skips onboarding — the M-OB form gates regular
    // users at /onboarding when this is null. The admin's profile
    // fields (employeeId, department) stay null; the admin UI for
    // managing user profiles will let them edit their own row later.
    onboardingCompletedAt: now,
    employeeId: null,
    department: null,
  } as unknown as User;

  await users.insertOne(draft);

  await writeAudit({
    orgId: org._id,
    actorUserId: null, // system action — the CLI runs out-of-session
    actorRole: null,
    action: "user.bootstrap_admin",
    targetType: "user",
    targetId: draft._id.toHexString(),
    after: { email: args.email, role: "admin", status: "active" },
    ip: null,
    ua: "admin-create-cli",
  });

  logger.info(
    {
      userId: draft._id.toHexString(),
      orgId: org._id.toHexString(),
      orgSlug: org.slug,
      email: args.email,
    },
    "[admin:create] admin created",
  );
}

main()
  .then(async () => {
    await disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    logger.error({ err }, "[admin:create] failed");
    await disconnect().catch(() => {});
    process.exit(1);
  });
