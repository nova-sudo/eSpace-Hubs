/**
 * Per-user CF tunnel registration + heartbeat.
 *
 * The Vercel catch-all (apps/web/src/pages/api/v1/[...path].ts) looks
 * up `user.companionTunnel` on every authenticated request. If it's
 * fresh (lastSeenAt within COMPANION_STALE_AFTER_MS = 5 minutes), the
 * request gets proxied to that hostname instead of the bundled
 * Express app.
 *
 * This module is what keeps that row fresh while the companion is
 * running:
 *
 *   start()    POSTs /me/companion-tunnel once (sets registeredAt
 *              + lastSeenAt), then schedules heartbeat() on a 60s
 *              interval.
 *
 *   heartbeat() re-POSTs (the server preserves registeredAt and just
 *              bumps lastSeenAt). Each tick re-asserts our hostname so
 *              if the user's tunnel hostname changed, the server
 *              learns about it within a heartbeat window.
 *
 *   stop()     DELETE /me/companion-tunnel. Best-effort — we don't
 *              block app quit on the network call succeeding.
 *
 * Auth: every request carries `Authorization: Bearer <token>` where
 * `<token>` came out of the Phase 3c device-pairing flow (see
 * apps/desktop/src/main/pair.ts). Without a paired token, start()
 * returns `{ ok: false, reason: "not_paired" }` and never touches
 * the network.
 *
 * Why the heartbeat at all
 * ────────────────────────
 * The catch-all decides "fresh enough to proxy?" by comparing
 * `lastSeenAt` to a 5-minute stale threshold. If the companion
 * crashed or the laptop sleeps, the row goes stale and the catch-all
 * falls back to the bundled API — which is the right behaviour. The
 * heartbeat is what keeps a healthy companion's row green; without
 * it, requests would start failing after exactly 5 minutes of normal
 * operation.
 */

import { getToken } from "./pair.js";
import { settings } from "./settings.js";

const DEFAULT_API_BASE_URL = "https://espace-hubs.vercel.app";
const HEARTBEAT_INTERVAL_MS = 60_000;

export interface TunnelState {
  /** Whether the heartbeat loop is currently running. */
  active: boolean;
  /** The hostname we're keeping registered. Null when inactive. */
  hostname: string | null;
  /** ISO ts of the most recent successful POST/heartbeat. Null when
   *  inactive OR when the first POST has not yet returned. */
  lastSeenAt: string | null;
  /** Last error from a register or heartbeat call, surfaced to the
   *  renderer so the user can fix configuration. Null on success. */
  lastError: string | null;
}

type StartResult =
  | { ok: true; hostname: string }
  | {
      ok: false;
      reason:
        | "not_paired"
        | "missing_hostname"
        | "network_error"
        | "server_error";
      message: string;
    };

let state: TunnelState = {
  active: false,
  hostname: null,
  lastSeenAt: null,
  lastError: null,
};
let heartbeatTimer: NodeJS.Timeout | null = null;

function apiBaseUrl(): string {
  const explicit = settings.get<string>("apiBaseUrl", "");
  return (explicit && explicit.trim() ? explicit : DEFAULT_API_BASE_URL).replace(
    /\/$/,
    "",
  );
}

export function getState(): TunnelState {
  return { ...state };
}

/**
 * Register the configured tunnel hostname with the Dev Hub and start
 * the heartbeat. Idempotent — calling while already active replaces
 * the heartbeat schedule and re-fires an immediate POST so a hostname
 * change propagates immediately.
 */
export async function start(): Promise<StartResult> {
  const token = getToken();
  if (!token) {
    state = {
      active: false,
      hostname: null,
      lastSeenAt: null,
      lastError:
        "Companion is not paired. Pair it in the companion settings before starting the backend.",
    };
    return {
      ok: false,
      reason: "not_paired",
      message: state.lastError!,
    };
  }
  const hostname = settings.get<string>("tunnelHostname", "").trim();
  if (!hostname) {
    state = {
      active: false,
      hostname: null,
      lastSeenAt: null,
      lastError:
        "Tunnel hostname is empty. Set the public CF tunnel hostname in settings.",
    };
    return {
      ok: false,
      reason: "missing_hostname",
      message: state.lastError!,
    };
  }

  const post = await postRegister(token, hostname);
  if (!post.ok) {
    state = {
      active: false,
      hostname,
      lastSeenAt: null,
      lastError: post.message,
    };
    return post;
  }

  state = {
    active: true,
    hostname,
    lastSeenAt: new Date().toISOString(),
    lastError: null,
  };
  scheduleHeartbeat();
  return { ok: true, hostname };
}

/** Stop the heartbeat and clear the server-side registration. */
export async function stop(): Promise<void> {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  const wasActive = state.active;
  state = {
    active: false,
    hostname: null,
    lastSeenAt: null,
    lastError: null,
  };
  if (!wasActive) return;

  const token = getToken();
  if (!token) return; // nothing to do server-side without auth

  try {
    const res = await fetch(
      `${apiBaseUrl()}/api/v1/auth/me/companion-tunnel`,
      {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}` },
      },
    );
    if (!res.ok && res.status !== 401) {
      // 401 just means our token was revoked — there's nothing to
      // unregister anyway. Other failures are best-effort; log and
      // move on so we don't block shutdown.
      console.warn(
        "[tunnel-register] DELETE failed",
        res.status,
        await res.text().catch(() => ""),
      );
    }
  } catch (err) {
    console.warn(
      "[tunnel-register] DELETE threw:",
      err instanceof Error ? err.message : String(err),
    );
  }
}

function scheduleHeartbeat(): void {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    void heartbeat();
  }, HEARTBEAT_INTERVAL_MS);
}

async function heartbeat(): Promise<void> {
  if (!state.active || !state.hostname) return;
  const token = getToken();
  if (!token) {
    // Token was revoked while we were running. Stop trying.
    state = {
      active: false,
      hostname: state.hostname,
      lastSeenAt: state.lastSeenAt,
      lastError: "Companion token was revoked — re-pair to reconnect.",
    };
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    return;
  }
  const post = await postRegister(token, state.hostname);
  if (post.ok) {
    state = {
      ...state,
      lastSeenAt: new Date().toISOString(),
      lastError: null,
    };
  } else {
    // Keep the loop alive — a transient blip shouldn't unregister us
    // (the server will fall back to the bundled API once lastSeenAt
    // ages past 5 minutes, which gives us multiple recovery
    // heartbeats). Surface the latest error to the UI.
    state = { ...state, lastError: post.message };
    // BUT: if the token's been revoked server-side, stop trying.
    if (post.reason === "server_error" && post.message.includes("401")) {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      state = { ...state, active: false };
    }
  }
}

async function postRegister(
  token: string,
  hostname: string,
): Promise<StartResult> {
  try {
    const res = await fetch(
      `${apiBaseUrl()}/api/v1/auth/me/companion-tunnel`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ hostname }),
      },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        reason: "server_error",
        message: `companion-tunnel register returned ${res.status}: ${
          text || res.statusText
        }`,
      };
    }
    return { ok: true, hostname };
  } catch (err) {
    return {
      ok: false,
      reason: "network_error",
      message:
        err instanceof Error
          ? `Couldn't reach the Dev Hub: ${err.message}`
          : "Couldn't reach the Dev Hub.",
    };
  }
}
