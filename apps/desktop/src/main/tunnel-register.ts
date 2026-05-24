/**
 * Per-user CF tunnel registration + heartbeat.
 *
 * The Vercel catch-all (apps/web/src/pages/api/v1/[...path].ts) looks
 * up `user.companionTunnel` on every authenticated request. If it's
 * fresh (lastSeenAt within COMPANION_STALE_AFTER_MS = 5 minutes), the
 * request gets proxied to that hostname instead of the bundled
 * Express app.
 *
 * This module keeps that row fresh — but ONLY when the local tunnel is
 * actually reachable. The pre-rewrite version re-POSTed the last-known
 * hostname every 60s with no verification, which produced a real bug:
 * if cloudflared crashed or the trycloudflare DNS went stale, the
 * server believed we were healthy and the Vercel catch-all proxied
 * requests to a hostname that returned CF Tunnel Error 1033.
 *
 * Every heartbeat tick now does three things:
 *
 *   1. Read `tunnelSpawn.getState()`. The spawn module is the source
 *      of truth for what cloudflared is actually doing.
 *        - "running" + hostname  → continue to step 2
 *        - "starting"            → skip this tick (transient)
 *        - "crashed" / "stopped" → clear server-side registration,
 *                                  halt our heartbeat loop
 *
 *   2. Probe the hostname locally with HEAD https://<host>/healthz
 *      (4s timeout). The request flows laptop → public DNS → CF edge
 *      → tunnel → local Express, so a 200 verifies the entire path
 *      including CF's view of the tunnel. Three consecutive probe
 *      failures escalate to a server-side stop so the catch-all
 *      falls back to bundled cleanly instead of 502'ing.
 *
 *   3. POST /me/companion-tunnel with the spawn's CURRENT hostname
 *      (not a cached value). If spawn rotated to a new hostname
 *      after a crash + auto-restart, this tick re-registers the new
 *      one within a heartbeat window.
 *
 * Auth: every request carries `Authorization: Bearer <token>` where
 * `<token>` came out of the Phase 3c device-pairing flow (see
 * apps/desktop/src/main/pair.ts). Without a paired token, start()
 * returns `{ ok: false, reason: "not_paired" }` and never touches
 * the network.
 */

import { getToken } from "./pair.js";
import { settings } from "./settings.js";
import * as tunnelSpawn from "./tunnel-spawn.js";

const DEFAULT_API_BASE_URL = "https://espace-hubs.vercel.app";
const HEARTBEAT_INTERVAL_MS = 60_000;
const PROBE_TIMEOUT_MS = 4_000;
const PROBE_FAIL_THRESHOLD = 3;

export interface TunnelState {
  /** Whether the heartbeat loop is currently running. */
  active: boolean;
  /** Last hostname we successfully registered with the server. Null
   *  when inactive. May lag the spawn's current hostname by up to
   *  one heartbeat tick during rotation. */
  hostname: string | null;
  /** ISO ts of the most recent successful POST/heartbeat. Null when
   *  inactive OR when the first POST has not yet returned. */
  lastSeenAt: string | null;
  /** Last error from a register, heartbeat, or probe call. Surfaced
   *  to the renderer so the user can see why routing dropped. Null
   *  on success. */
  lastError: string | null;
  /** Consecutive failed probes since the last success. Resets on
   *  any successful probe. Escalates to a server-side stop at
   *  PROBE_FAIL_THRESHOLD. */
  probeFailures: number;
}

type StartResult =
  | { ok: true; hostname: string }
  | {
      ok: false;
      reason:
        | "not_paired"
        | "missing_hostname"
        | "network_error"
        | "server_error"
        | "spawn_not_running";
      message: string;
    };

const INITIAL_STATE: TunnelState = {
  active: false,
  hostname: null,
  lastSeenAt: null,
  lastError: null,
  probeFailures: 0,
};

let state: TunnelState = { ...INITIAL_STATE };
let heartbeatTimer: NodeJS.Timeout | null = null;
let spawnSubscriptionInstalled = false;

/**
 * Subscribe once to spawn-state changes so a hostname rotation OR a
 * cloudflared crash drives an immediate heartbeat tick instead of
 * waiting up to 60s for the next interval. Idempotent — wired on the
 * first start() and stays alive for the process lifetime; the
 * heartbeat function's `state.active` guard makes the callback a
 * no-op when the registration loop isn't running.
 */
function ensureSpawnSubscription(): void {
  if (spawnSubscriptionInstalled) return;
  spawnSubscriptionInstalled = true;
  tunnelSpawn.subscribe(() => {
    if (!state.active) return;
    void heartbeat();
  });
}

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
 * Kick off the registration loop. Reads the current spawn state to
 * decide whether to register right now or wait for the next tick.
 *
 * The hostname argument is accepted for back-compat with the
 * pre-rewrite call site but is IGNORED — the heartbeat always reads
 * the live spawn state. Pass anything (or nothing).
 *
 * Idempotent: calling while already active just re-fires an immediate
 * heartbeat so a hostname rotation propagates fast.
 */
export async function start(_hostname?: string): Promise<StartResult> {
  ensureSpawnSubscription();
  const token = getToken();
  if (!token) {
    state = {
      ...INITIAL_STATE,
      lastError:
        "Companion is not paired. Pair it in the companion settings before starting the backend.",
    };
    return {
      ok: false,
      reason: "not_paired",
      message: state.lastError!,
    };
  }

  const spawn = tunnelSpawn.getState();
  if (spawn.status !== "running" || !spawn.hostname) {
    // Spawn isn't ready yet — schedule the heartbeat anyway so the
    // next tick picks up the hostname once cloudflared finishes
    // starting. This avoids a deadlock where start() returned
    // "missing_hostname" and nothing ever kicked the loop.
    state = {
      ...INITIAL_STATE,
      active: true, // loop is running, just waiting for spawn
      lastError:
        spawn.status === "starting"
          ? "Waiting for cloudflared to allocate a hostname…"
          : "cloudflared isn't running. Will register when it comes up.",
    };
    scheduleHeartbeat();
    return {
      ok: false,
      reason: "spawn_not_running",
      message: state.lastError!,
    };
  }

  // Run one immediate tick — registers right away on the happy path
  // so the user doesn't wait 60s for the first heartbeat.
  state = { ...INITIAL_STATE, active: true };
  scheduleHeartbeat();
  await heartbeat();
  if (state.hostname) {
    return { ok: true, hostname: state.hostname };
  }
  return {
    ok: false,
    reason: "network_error",
    message: state.lastError ?? "Initial register failed.",
  };
}

/** Stop the heartbeat and clear the server-side registration. Safe
 *  to call from anywhere — idempotent, doesn't throw on network
 *  failure. */
export async function stop(): Promise<void> {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  const wasActive = state.active && state.hostname !== null;
  state = { ...INITIAL_STATE };
  if (!wasActive) return;

  const token = getToken();
  if (!token) return;

  try {
    const res = await fetch(
      `${apiBaseUrl()}/api/v1/auth/me/companion-tunnel`,
      {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}` },
      },
    );
    if (!res.ok && res.status !== 401) {
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

/**
 * Single heartbeat tick. Returns no value; mutates `state` and may
 * issue a stop() side-effect on terminal spawn states.
 */
async function heartbeat(): Promise<void> {
  if (!state.active) return;

  const token = getToken();
  if (!token) {
    // Token was revoked while we were running. Halt cleanly.
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    state = {
      ...INITIAL_STATE,
      lastError: "Companion token was revoked — re-pair to reconnect.",
    };
    return;
  }

  const spawn = tunnelSpawn.getState();

  // Spawn-state branching is the heart of this rewrite. Each branch
  // resolves the "what's actually happening?" question before we
  // touch the network — no more re-POSTing a hostname that doesn't
  // resolve.
  if (spawn.status === "starting") {
    state = {
      ...state,
      lastError: "Waiting for cloudflared to allocate a hostname…",
    };
    return;
  }
  if (spawn.status !== "running" || !spawn.hostname) {
    // Spawn is crashed / stopped / idle. The local tunnel isn't
    // serving anything. Clear the server registration so the
    // catch-all falls back to bundled cleanly. Halts the heartbeat
    // loop — main/index.ts is responsible for calling start() again
    // when the backend comes back up.
    await stop();
    state = {
      ...INITIAL_STATE,
      lastError:
        spawn.lastError ||
        "Local cloudflared exited — server registration cleared.",
    };
    return;
  }

  // Step 2 — probe. Verifies the hostname is actually routable end-
  // to-end (laptop → public DNS → CF edge → tunnel → local Express).
  const probeOk = await probeHostname(spawn.hostname);
  if (!probeOk) {
    const nextFailures = state.probeFailures + 1;
    state = {
      ...state,
      probeFailures: nextFailures,
      lastError: `Tunnel hostname ${spawn.hostname} didn't respond (probe failure ${nextFailures}/${PROBE_FAIL_THRESHOLD}).`,
    };
    if (nextFailures >= PROBE_FAIL_THRESHOLD) {
      // Three strikes — assume the tunnel is genuinely broken even
      // though cloudflared claims to be running. Clear the server
      // registration so the catch-all stops proxying to a dead
      // hostname. The next heartbeat will retry the probe; if it
      // succeeds we re-register.
      const lastError = state.lastError;
      await stop();
      // stop() resets state — preserve our error message + leave the
      // loop running so a recovered tunnel re-registers itself.
      state = {
        ...INITIAL_STATE,
        active: true,
        lastError: `${lastError} Cleared server registration; falling back to bundled until the tunnel recovers.`,
      };
      scheduleHeartbeat();
    }
    return;
  }

  // Step 3 — actually register. Uses the spawn's current hostname,
  // not whatever we registered last tick. A rotated hostname (CF
  // edge rotation, cloudflared respawn) propagates within one tick.
  const post = await postRegister(token, spawn.hostname);
  if (post.ok) {
    state = {
      ...state,
      hostname: spawn.hostname,
      lastSeenAt: new Date().toISOString(),
      lastError: null,
      probeFailures: 0,
    };
  } else {
    state = { ...state, lastError: post.message };
    // Server says our token's been revoked (401). Stop trying — the
    // user needs to re-pair.
    if (post.reason === "server_error" && post.message.includes("401")) {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      state = {
        ...INITIAL_STATE,
        lastError: "Server rejected our token — re-pair to reconnect.",
      };
    }
  }
}

/**
 * HEAD https://<hostname>/healthz with a hard timeout. Verifies the
 * entire request path (DNS → CF edge → tunnel → local Express)
 * actually works — cheaper + more honest than re-POSTing blindly.
 *
 * Treats any non-2xx as a failure, including the 502 / 530 envelope
 * CF returns when its edge can't reach the tunnel.
 */
async function probeHostname(hostname: string): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`https://${hostname}/healthz`, {
      method: "HEAD",
      signal: ctrl.signal,
      // Avoid sending random cookies / referrers from the Electron
      // main process. This call is purely a liveness probe.
      headers: { "user-agent": "espace-devhub-companion/probe" },
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
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
