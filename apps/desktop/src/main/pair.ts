/**
 * Companion-side device pairing.
 *
 * The server-side flow lives in apps/api/src/modules/companion (Phase
 * 3c, PR #107). This module is the desktop counterpart:
 *
 *   1. POST /api/v1/companion/pair/start { deviceName }
 *      → { code, expiresAt, approvalUrl }
 *
 *   2. Open `approvalUrl` in the user's default browser. They're
 *      already logged into the Dev Hub there; they click Approve.
 *
 *   3. Poll GET /api/v1/companion/pair/poll?code=... until it returns
 *      `{ status: "approved", token, deviceId, deviceName }`. Up to
 *      ~4½ minutes — the server expires the pairing at the 5-minute
 *      mark, so we give up just before that.
 *
 *   4. Persist the bearer token via keychain.ts (safeStorage). From
 *      that point on, any /me/companion-tunnel call carries it as
 *      `Authorization: Bearer <token>`.
 *
 * The token NEVER returns to the renderer. The renderer asks
 * `companion.pair.status()` and gets back a boolean + the device
 * name; the plaintext lives only in OS keychain-encrypted form on
 * disk and in this module's memory while signing requests.
 *
 * Re-pairing: calling `pair()` while a token is already stored just
 * replaces it. The old device row stays valid on the server (and is
 * cleanly revocable from the Devices UI in Phase 3e) — that lets the
 * user pair a laptop they've already paired without first revoking.
 */

import { shell } from "electron";
import os from "node:os";
import * as keychain from "./keychain.js";
import { settings } from "./settings.js";

/** Public URL we default to when the user hasn't customised
 *  `apiBaseUrl` in settings. Production deployment of the frontend. */
const DEFAULT_API_BASE_URL = "https://espace-hubs.vercel.app";

/** Keychain key under which the bearer token + device metadata live. */
const TOKEN_KEY = "companionToken";
const DEVICE_META_KEY = "companionDeviceMeta";

/** Server-side TTL is 5 minutes. We stop polling ~30s short of that so
 *  we don't race the cleanup. */
const POLL_TIMEOUT_MS = 270_000;
/** How often to poll /pair/poll. Balance is between "responsive to
 *  the user clicking Approve" and "don't hammer the API." 2s is the
 *  same cadence the existing health-ping uses. */
const POLL_INTERVAL_MS = 2000;

export interface PairResult {
  ok: boolean;
  deviceId?: string;
  deviceName?: string;
  message: string;
}

export interface PairStatus {
  /** Whether we hold a bearer token on this machine. */
  paired: boolean;
  /** The label the server returned at pair-approval time. */
  deviceName: string | null;
  /** Server's ObjectId for this device — needed for self-revoke. */
  deviceId: string | null;
}

interface PendingPairing {
  code: string;
  expiresAt: number;
  approvalUrl: string;
}

let currentPolling: AbortController | null = null;

function apiBaseUrl(): string {
  const explicit = settings.get<string>("apiBaseUrl", "");
  return (explicit && explicit.trim() ? explicit : DEFAULT_API_BASE_URL).replace(
    /\/$/,
    "",
  );
}

function defaultDeviceName(): string {
  // Fallback: "<hostname> (Companion)". Users can rename via the
  // Devices UI later (Phase 3e). os.hostname() works on every
  // platform Electron supports.
  const host = os.hostname() || "Unknown";
  return `${host} (Companion)`;
}

/** Returns the active bearer token, or null if we've never paired. */
export function getToken(): string | null {
  return keychain.get(TOKEN_KEY);
}

/** Light status lookup for the renderer — never leaks the token. */
export function status(): PairStatus {
  const tokenSet = keychain.has(TOKEN_KEY);
  if (!tokenSet) {
    return { paired: false, deviceName: null, deviceId: null };
  }
  const metaRaw = keychain.get(DEVICE_META_KEY);
  if (!metaRaw) {
    // Token exists but metadata's gone — treat as paired but
    // unlabelled. UI shows "(unknown device)" and offers re-pair.
    return { paired: true, deviceName: null, deviceId: null };
  }
  try {
    const parsed = JSON.parse(metaRaw) as {
      deviceId: string;
      deviceName: string;
    };
    return {
      paired: true,
      deviceName: parsed.deviceName || null,
      deviceId: parsed.deviceId || null,
    };
  } catch {
    return { paired: true, deviceName: null, deviceId: null };
  }
}

/**
 * Cancel any in-flight polling loop. Idempotent — no-op when nothing
 * is running. Called when the user clicks Cancel in the UI, or when
 * the renderer triggers a fresh pair() while one is already underway.
 */
export function cancelPairing(): void {
  if (currentPolling) {
    currentPolling.abort();
    currentPolling = null;
  }
}

/**
 * Run the full pairing handshake. Resolves when:
 *   - the user approves in the browser (`ok: true`)
 *   - the pairing expires server-side (`ok: false`)
 *   - the user cancels via cancelPairing() (`ok: false`)
 *
 * Caller is the IPC handler; it returns the PairResult to the
 * renderer so the UI can show success or surface the failure.
 */
export async function pair(): Promise<PairResult> {
  cancelPairing();

  const base = apiBaseUrl();
  let pending: PendingPairing;
  try {
    pending = await startPairing(base);
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof Error
          ? `Couldn't start pairing — ${err.message}`
          : "Couldn't start pairing.",
    };
  }

  // Surface the approval URL to the user's default browser. We don't
  // wait on this — if the user has a browser handler issue, the poll
  // loop will still observe an approval if they navigate to the URL
  // manually from a different machine (the URL is in the IPC return
  // value for the UI to show).
  try {
    await shell.openExternal(pending.approvalUrl);
  } catch (err) {
    console.warn(
      "[pair] failed to open approval URL — user can paste manually:",
      err instanceof Error ? err.message : String(err),
    );
  }

  currentPolling = new AbortController();
  try {
    const approved = await pollForApproval(base, pending, currentPolling);
    persistToken(approved.token, approved.deviceId, approved.deviceName);
    return {
      ok: true,
      deviceId: approved.deviceId,
      deviceName: approved.deviceName,
      message: `Paired as “${approved.deviceName}.”`,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, message: "Pairing cancelled." };
    }
    return {
      ok: false,
      message:
        err instanceof Error
          ? err.message
          : "Pairing failed for an unknown reason.",
    };
  } finally {
    currentPolling = null;
  }
}

/** Drop the local token. Does NOT call the server's /devices/:id
 *  revoke endpoint — that's a Phase 3e UI affordance ("Revoke from
 *  all my devices"). This is local-only forget so the user can re-pair
 *  a different account. */
export function unpair(): void {
  keychain.clear(TOKEN_KEY);
  keychain.clear(DEVICE_META_KEY);
}

// ─── private ─────────────────────────────────────────────────────────

async function startPairing(base: string): Promise<PendingPairing> {
  const res = await fetch(`${base}/api/v1/companion/pair/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceName: defaultDeviceName() }),
  });
  if (!res.ok) {
    throw new Error(`pair/start returned ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as {
    code: string;
    expiresAt: string;
    approvalUrl: string;
  };
  if (!data.code || !data.approvalUrl) {
    throw new Error("pair/start response was missing code/approvalUrl");
  }
  return {
    code: data.code,
    expiresAt: new Date(data.expiresAt).getTime(),
    approvalUrl: data.approvalUrl,
  };
}

interface ApprovedPairing {
  token: string;
  deviceId: string;
  deviceName: string;
}

async function pollForApproval(
  base: string,
  pending: PendingPairing,
  ctrl: AbortController,
): Promise<ApprovedPairing> {
  const deadline = Math.min(
    Date.now() + POLL_TIMEOUT_MS,
    pending.expiresAt - 5_000,
  );

  while (Date.now() < deadline) {
    if (ctrl.signal.aborted) {
      throw aborted();
    }

    let body: {
      status: string;
      token?: string;
      deviceId?: string;
      deviceName?: string;
    };
    try {
      const res = await fetch(
        `${base}/api/v1/companion/pair/poll?code=${encodeURIComponent(
          pending.code,
        )}`,
        { signal: ctrl.signal },
      );
      body = (await res.json()) as typeof body;
    } catch (err) {
      if (ctrl.signal.aborted) throw aborted();
      // Network blip — log + keep polling. Don't bail; the user could
      // be reconnecting Wi-Fi between calls.
      console.warn(
        "[pair] poll fetch failed (will retry):",
        err instanceof Error ? err.message : String(err),
      );
      await sleep(POLL_INTERVAL_MS, ctrl.signal);
      continue;
    }

    if (body.status === "approved") {
      if (!body.token || !body.deviceId) {
        throw new Error(
          "approved response missing token or deviceId — server bug?",
        );
      }
      return {
        token: body.token,
        deviceId: body.deviceId,
        deviceName: body.deviceName ?? defaultDeviceName(),
      };
    }
    if (body.status === "expired") {
      throw new Error(
        "Pairing code expired before you approved. Try pairing again.",
      );
    }
    if (body.status === "not_found") {
      throw new Error(
        "Pairing code disappeared on the server. Try pairing again.",
      );
    }
    if (body.status === "consumed") {
      // Another companion (or the same one on a prior run) already
      // fetched this token. Treat as expired from this caller's POV.
      throw new Error(
        "Pairing was already used by another device. Try pairing again.",
      );
    }
    // status === "pending" — fall through.
    await sleep(POLL_INTERVAL_MS, ctrl.signal);
  }
  throw new Error(
    "Timed out waiting for browser approval. Restart pairing and click Approve faster next time.",
  );
}

function persistToken(token: string, deviceId: string, deviceName: string): void {
  keychain.set(TOKEN_KEY, token);
  keychain.set(
    DEVICE_META_KEY,
    JSON.stringify({ deviceId, deviceName }),
  );
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(aborted());
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(aborted());
      },
      { once: true },
    );
  });
}

function aborted(): Error {
  const e = new Error("Pairing aborted.");
  e.name = "AbortError";
  return e;
}
