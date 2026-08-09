/**
 * Backend environment overrides — lets the companion inject apps/api
 * env vars straight into the spawned process, bypassing .env.local /
 * .env entirely.
 *
 * Why this exists
 * ────────────────
 * apps/api/src/config/env.ts loads .env.local then .env via dotenv,
 * whose default `override: false` only fills keys that aren't already
 * in process.env — real process.env entries always win. So anything we
 * set here and pass into the child's `env` at spawn time is guaranteed
 * to beat whatever's on disk, without ever writing to a file the user
 * has to remember exists (or ever accidentally commit). That matters
 * for values like SESSION_SECRET, which must byte-for-byte match
 * whatever signed a session cookie elsewhere (e.g. production) — a
 * stale copy sitting in .env.local from a fresh clone is exactly the
 * kind of drift this sidesteps.
 *
 * Storage
 * ───────
 * Routed through keychain.ts (OS-encrypted), not settings.ts's
 * plaintext JSON — these are exactly as sensitive as the VPN password
 * already stored that way (MONGO_URI and SESSION_SECRET both grant
 * real access if leaked).
 *
 * Allowlisted against apps/api/src/config/env.ts's zod schema so the
 * companion can never be made to inject an arbitrary env var into its
 * own spawned child.
 */

import * as keychain from "./keychain.js";

const KEY_PREFIX = "envOverride:";

export interface EnvOverrideDef {
  key: string;
  label: string;
  help: string;
  secret: boolean;
}

export const ENV_OVERRIDE_DEFS: EnvOverrideDef[] = [
  {
    key: "MONGO_URI",
    label: "Mongo URI",
    help: "Point at the real database instead of whatever's in .env.local.",
    secret: true,
  },
  {
    key: "MONGO_DB_NAME",
    label: "Mongo DB name",
    help: "Overrides MONGO_DB_NAME.",
    secret: false,
  },
  {
    key: "SESSION_SECRET",
    label: "Session secret",
    help: "Must match whatever signs session cookies elsewhere, or logins created there will 401 here.",
    secret: true,
  },
  {
    key: "INTEGRATION_TOKEN_KEY",
    label: "Integration token key",
    help: "Must match the key that encrypted stored GitLab/Jira tokens, or decrypting them fails.",
    secret: true,
  },
  {
    key: "CORS_ALLOWED_ORIGINS",
    label: "CORS allowed origins",
    help: "Comma-separated list of allowed origins.",
    secret: false,
  },
  {
    key: "LOG_LEVEL",
    label: "Log level",
    help: "fatal | error | warn | info | debug | trace",
    secret: false,
  },
  {
    key: "PORT",
    label: "Port",
    help: "Port the api listens on.",
    secret: false,
  },
];

const VALID_KEYS = new Set(ENV_OVERRIDE_DEFS.map((d) => d.key));

function storageKey(key: string): string {
  return `${KEY_PREFIX}${key}`;
}

function assertKnownKey(key: string): void {
  if (!VALID_KEYS.has(key)) {
    throw new Error(`Unknown env override key: ${key}`);
  }
}

export function listEnvOverrides(): Array<EnvOverrideDef & { set: boolean }> {
  return ENV_OVERRIDE_DEFS.map((def) => ({
    ...def,
    set: keychain.has(storageKey(def.key)),
  }));
}

export function setEnvOverride(key: string, value: string): void {
  assertKnownKey(key);
  keychain.set(storageKey(key), value);
}

export function clearEnvOverride(key: string): void {
  assertKnownKey(key);
  keychain.clear(storageKey(key));
}

/**
 * Everything currently set, decrypted, ready to spread into a spawned
 * child's `env`. Returns {} (never throws) if the keychain is
 * unavailable or a value fails to decrypt — startBackend() falls back
 * to whatever's in .env.local/.env in that case, same as before this
 * feature existed.
 */
export function resolveEnvOverrides(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const def of ENV_OVERRIDE_DEFS) {
    const v = keychain.get(storageKey(def.key));
    if (v) out[def.key] = v;
  }
  return out;
}
