/**
 * Device-pairing client — talks to the Phase 3c backend endpoints to
 * acquire a long-lived bearer token tied to the signed-in user.
 *
 * Flow (paralleling the server's state machine in
 * apps/api/src/modules/companion/controller.ts):
 *
 *   1. We POST /api/v1/companion/pair/start → server returns
 *      { code, expiresAt, approvalUrl }.
 *   2. We open `approvalUrl` in the user's default browser. The user
 *      is already signed into the web app (or signs in en route),
 *      sees the device name + their account, and clicks Approve.
 *   3. We poll GET /pair/poll?code=… every 2s. On the FIRST poll that
 *      sees approvedAt non-null, the server returns
 *      { status: "approved", token, deviceId, deviceName } and the
 *      pairing row is consumed. Subsequent polls return "consumed".
 *   4. We persist the token in the OS keychain (via keychain.ts) and
 *      remember the deviceId + deviceName in settings.ts so the UI
 *      can show "Paired as: <name>" without an extra round trip.
 *
 * Pairings TTL out after 5 minutes on the server (the TTL index on
 * companion_pairings.expiresAt). We surface that as PAIRING_TIMEOUT
 * locally and stop polling when we hit it — the user has to click
 * Start again.
 *
 * No retries on network failures: the polling loop is the retry
 * mechanism. A 4xx response (notably "pairing_expired") flips us into
 * "expired"; the user starts over.
 */

import { shell } from "electron";
import os from "node:os";
import * as keychain from "./keychain";
import { settings } from "./settings";

/** SafeStorage key for the bearer token. */
const TOKEN_KEYCHAIN_KEY = "companionBearerToken";

const DEFAULT_API_BASE_URL = "https://espace-hubs.vercel.app";
const POLL_INTERVAL_MS = 2_000;
const PAIRING_TIMEOUT_MS = 5 * 60 * 1000;

export type PairingState =
  | { phase: "idle" }
  | { phase: "starting" }
  | {
      phase: "pending";
      code: string;
      approvalUrl: string;
      expiresAt: string;
    }
  | { phase: "approved"; deviceId: string; deviceName: string }
  | { phase: "expired" }
  | { phase: "error"; message: string };

/**
 * Listener registry — the IPC bridge subscribes here so it can push
 * state changes to the renderer (via `webContents.send`). One state
 * object at a time; new emissions overwrite the cached current state.
 */
type Listener = (s: PairingState) => void;
const listeners = new Set<Listener>();
let cachedState: PairingState = { phase: "idle" };

function emit(s: PairingState): void {
  cachedState = s;
  for (const l of listeners) {
    try {
      l(s);
    } catch {
      // A bad listener mustn't crash the pairing flow.
    }
  }
}

export function getState(): PairingState {
  return cachedState;
}

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Returns the cached bearer token from the keychain, or null. */
export function getToken(): string | null {
  return keychain.get(TOKEN_KEYCHAIN_KEY);
}

/** True iff the keychain currently holds a paired token. */
export function isPaired(): boolean {
  return getToken() !== null;
}

/** Returns paired-device metadata for UI display. */
export function getPairedDevice(): { deviceId: string | null; deviceName: string | null } {
  return {
    deviceId: settings.get<string | null>("pairedDeviceId", null),
    deviceName: settings.get<string | null>("pairedDeviceName", null),
  };
}

/** Wipe local pairing state. Does NOT call /devices/:id on the server —
 *  the user can revoke from the Devices UI if they want server-side
 *  revocation too. This is the "just stop using the token on this
 *  laptop" knob. */
export function unpair(): void {
  keychain.clear(TOKEN_KEYCHAIN_KEY);
  settings.patch({ pairedDeviceId: undefined, pairedDeviceName: undefined });
  emit({ phase: "idle" });
}

function apiBase(): string {
  const v = settings.get<string>("apiBaseUrl", "");
  return (v && v.trim()) || DEFAULT_API_BASE_URL;
}

function defaultDeviceName(): string {
  // OS hostname is a sensible default — recognisable to the user when
  // they see the approval dialog. They can override it via the UI.
  try {
    const h = os.hostname();
    return h || "Companion";
  } catch {
    return "Companion";
  }
}

/**
 * Cancel-token returned by `startPairing` so the renderer can abort a
 * pending pairing (e.g. user clicked Cancel before approving).
 */
export interface PairingHandle {
  cancel(): void;
}

let activeAbort: AbortController | null = null;

/**
 * Kick off a new pairing if one isn't already running. Returns
 * immediately; observe progress via subscribe(). Subsequent calls
 * while a pairing is active are no-ops (they don't reset state).
 */
export function startPairing(opts: { deviceName?: string } = {}): PairingHandle {
  if (
    cachedState.phase === "starting" ||
    cachedState.phase === "pending"
  ) {
    return { cancel: cancelPairing };
  }
  activeAbort?.abort();
  const ctrl = new AbortController();
  activeAbort = ctrl;
  void runPairing(opts.deviceName ?? defaultDeviceName(), ctrl.signal);
  return { cancel: cancelPairing };
}

/**
 * Cancel an in-flight pairing. Safe to call from anywhere (IPC,
 * lifecycle hooks). Idempotent — calling on idle does nothing.
 */
export function cancelPairing(): void {
  activeAbort?.abort();
  activeAbort = null;
  // Don't overwrite an "approved" terminal state — only knock pending
  // back to idle. Otherwise the UI would lose its just-succeeded state.
  if (
    cachedState.phase === "starting" ||
    cachedState.phase === "pending"
  ) {
    emit({ phase: "idle" });
  }
}

async function runPairing(deviceName: string, signal: AbortSignal): Promise<void> {
  emit({ phase: "starting" });
  try {
    const startRes = await fetch(`${apiBase()}/api/v1/companion/pair/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceName }),
      signal,
    });
    if (!startRes.ok) {
      emit({ phase: "error", message: `Pair start failed (${startRes.status})` });
      return;
    }
    const startBody = (await startRes.json()) as {
      code: string;
      expiresAt: string;
      approvalUrl: string;
    };

    emit({
      phase: "pending",
      code: startBody.code,
      approvalUrl: startBody.approvalUrl,
      expiresAt: startBody.expiresAt,
    });

    // Best-effort: open the user's default browser straight to the
    // approval page. Some Linux setups may not have a default
    // browser registered — we don't treat that as fatal; the user
    // can copy the URL from the UI.
    void shell.openExternal(startBody.approvalUrl).catch(() => {});

    // Poll loop. Stops on:
    //   - signal aborted (user cancelled)
    //   - hard timeout exceeded
    //   - status flips to approved / expired / consumed / not_found
    const deadline = Date.now() + PAIRING_TIMEOUT_MS;
    while (!signal.aborted && Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS, signal);
      if (signal.aborted) return;

      const pollRes = await fetch(
        `${apiBase()}/api/v1/companion/pair/poll?code=${encodeURIComponent(startBody.code)}`,
        { method: "GET", signal },
      );
      if (!pollRes.ok) {
        // 4xx/5xx during poll — keep polling; transient network
        // errors shouldn't kill an otherwise-valid pairing.
        continue;
      }
      const body = (await pollRes.json()) as {
        status: "pending" | "approved" | "consumed" | "expired" | "not_found";
        token?: string;
        deviceId?: string;
        deviceName?: string;
      };

      if (body.status === "approved" && body.token && body.deviceId) {
        // Persist token + metadata. Keychain set throws if safeStorage
        // is unavailable — surface that to the UI rather than silently
        // storing nothing.
        try {
          keychain.set(TOKEN_KEYCHAIN_KEY, body.token);
        } catch (err) {
          emit({
            phase: "error",
            message: `Couldn't store token in OS keychain: ${err instanceof Error ? err.message : String(err)}`,
          });
          return;
        }
        settings.patch({
          pairedDeviceId: body.deviceId,
          pairedDeviceName: body.deviceName ?? deviceName,
        });
        emit({
          phase: "approved",
          deviceId: body.deviceId,
          deviceName: body.deviceName ?? deviceName,
        });
        return;
      }
      if (body.status === "expired" || body.status === "not_found") {
        emit({ phase: "expired" });
        return;
      }
      if (body.status === "consumed") {
        // Either a previous poll already fetched the token (shouldn't
        // happen — we're the only poller) or someone else used the
        // same code. Treat as expired from the user's perspective.
        emit({ phase: "expired" });
        return;
      }
      // status === "pending" → keep polling.
    }

    if (Date.now() >= deadline) {
      emit({ phase: "expired" });
    }
  } catch (err) {
    if (signal.aborted) return; // user cancelled
    emit({
      phase: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });
}
