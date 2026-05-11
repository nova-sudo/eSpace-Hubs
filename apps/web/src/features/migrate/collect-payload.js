/**
 * Assemble the /api/v1/migrate/import payload from the seven
 * localStorage keys the legacy stores write. Pure read — never
 * mutates localStorage.
 *
 * Shape returned matches the server's importSchema (Zod) verbatim:
 * each top-level field is optional and is omitted entirely when the
 * corresponding storage key is empty or absent. The server accepts a
 * partial payload, so an empty body would be a valid (no-op) call —
 * but emitting only what we actually have keeps the request small
 * and makes the audit log readable.
 *
 * Returns `{ payload, hasAny }`:
 *   payload  the request body to POST
 *   hasAny   true when at least one key contributed something
 *            (lets the caller skip the call entirely on a fresh
 *            device that has no legacy data to migrate)
 */

const KEYS = {
  goals: "espace-devhub:goals",
  goalSpecs: "espace-devhub:goal-specs",
  goalContext: "espace-devhub:goal-context",
  goalInputs: "espace-devhub:goal-inputs",
  snapshots: "espace-devhub:snapshots",
  grading: "espace-devhub:grading",
  integrations: "espace-devhub:integrations",
};

function readJSON(key) {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function nonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0 ? value : null;
}

function nonEmptyObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.keys(value).length > 0 ? value : null;
}

export function collectMigrationPayload() {
  const payload = {};
  let hasAny = false;

  // ── goals ─────────────────────────────────────────────────────────
  // Stored as { schemaVersion, l1s }. The server only wants { l1s }.
  const goalsRaw = readJSON(KEYS.goals);
  const l1s = nonEmptyArray(goalsRaw?.l1s);
  if (l1s) {
    payload.goals = { l1s };
    hasAny = true;
  }

  // ── goal-specs ────────────────────────────────────────────────────
  // Stored as { specs: {goalId: spec}, lastAnalyzedAt }. Server wants
  // { specs }.
  const specsRaw = readJSON(KEYS.goalSpecs);
  const specs = nonEmptyObject(specsRaw?.specs);
  if (specs) {
    payload.goalSpecs = { specs };
    hasAny = true;
  }

  // ── goal-context ──────────────────────────────────────────────────
  // Stored as { [goalId]: { ...answers, __updatedAt? } }. Server
  // accepts the same shape and strips __updatedAt itself.
  const contextRaw = readJSON(KEYS.goalContext);
  const context = nonEmptyObject(contextRaw);
  if (context) {
    payload.goalContext = context;
    hasAny = true;
  }

  // ── goal-inputs ───────────────────────────────────────────────────
  // Stored as { [goalId]: [entry, …] }. Server accepts the same.
  const inputsRaw = readJSON(KEYS.goalInputs);
  const inputs = nonEmptyObject(inputsRaw);
  if (inputs) {
    // Filter out empty arrays so the server doesn't see noise.
    const trimmed = {};
    for (const [goalId, entries] of Object.entries(inputs)) {
      if (Array.isArray(entries) && entries.length > 0) {
        trimmed[goalId] = entries;
      }
    }
    if (Object.keys(trimmed).length > 0) {
      payload.goalInputs = trimmed;
      hasAny = true;
    }
  }

  // ── snapshots ─────────────────────────────────────────────────────
  // Stored as an array.
  const snapshotsRaw = readJSON(KEYS.snapshots);
  const snapshots = nonEmptyArray(snapshotsRaw);
  if (snapshots) {
    payload.snapshots = snapshots;
    hasAny = true;
  }

  // ── grading verdicts ──────────────────────────────────────────────
  // Stored as { [cacheKey]: {prId, rubricHash, verdict, gradedAt} }.
  // Server accepts the same; cacheKey is ignored in favour of
  // (prId, rubricHash).
  const gradingRaw = readJSON(KEYS.grading);
  const grading = nonEmptyObject(gradingRaw);
  if (grading) {
    payload.gradingVerdicts = grading;
    hasAny = true;
  }

  // ── integrations ──────────────────────────────────────────────────
  // Stored as { [providerId]: {accessToken?, apiToken?, …} }. Server
  // encrypts before insert; we send plaintext over the wire (the
  // request body is HTTPS in non-dev). Migration is one-shot per
  // device, so the plaintext exposure is bounded.
  const integrationsRaw = readJSON(KEYS.integrations);
  const integrations = nonEmptyObject(integrationsRaw);
  if (integrations) {
    payload.integrations = integrations;
    hasAny = true;
  }

  return { payload, hasAny };
}

export const MIGRATION_SOURCE_KEYS = KEYS;
