/**
 * Tunnel-registration heartbeat — keeps the server's record of
 * `user.companionTunnel` fresh so the Vercel catch-all routes /api/v1/*
 * for this user to OUR Cloudflare Tunnel.
 *
 * Why a heartbeat (vs. one-shot register)
 * ────────────────────────────────────────
 * The catch-all treats a registration as STALE if `lastSeenAt` is older
 * than COMPANION_STALE_AFTER_MS (5 min, in
 * apps/api/src/modules/auth/controller.ts). A laptop in standby, a
 * crashed companion, or a closed lid all stop the heartbeat — within
 * 5 min the server falls back to the bundled API automatically.
 *
 * Cadence
 * ───────
 *   - First register fires immediately when conditions are met (token
 *     + hostname + tunnel container running).
 *   - Subsequent heartbeats every HEARTBEAT_INTERVAL_MS.
 *   - On Stop backend / app quit, we send DELETE /me/companion-tunnel
 *     so the server doesn't leave a routing pointer dangling.
 *
 * Failure handling
 * ────────────────
 * A failed POST is logged-and-retried at the next tick. We DON'T
 * surface every transient network error to the UI — only persistent
 * failures (e.g. 401 = token revoked, 403 = role lost, 4xx schema
 * rejections). The renderer reads getStatus() to show a banner.
 */

import * as pairing from "./pairing";
import { settings } from "./settings";

const DEFAULT_API_BASE_URL = "https://espace-hubs.vercel.app";
const HEARTBEAT_INTERVAL_MS = 60_000;
const REGISTER_RETRY_AFTER_MS = 5_000;

export type RegistrationStatus =
  | { phase: "idle"; reason: string }
  | { phase: "registering" }
  | { phase: "registered"; hostname: string; lastSeenAt: string }
  | { phase: "error"; message: string };

type Listener = (s: RegistrationStatus) => void;
const listeners = new Set<Listener>();
let cached: RegistrationStatus = { phase: "idle", reason: "not started" };

function emit(s: RegistrationStatus): void {
  cached = s;
  for (const l of listeners) {
    try {
      l(s);
    } catch {
      // ignore
    }
  }
}

export function getStatus(): RegistrationStatus {
  return cached;
}

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

function apiBase(): string {
  const v = settings.get<string>("apiBaseUrl", "");
  return (v && v.trim()) || DEFAULT_API_BASE_URL;
}

function tunnelHostname(): string | null {
  const v = settings.get<string>("tunnelHostname", "");
  const trimmed = (v || "").trim();
  return trimmed || null;
}

let timer: NodeJS.Timeout | null = null;
let stopping = false;

/**
 * Begin the heartbeat loop. Idempotent — calling twice is a no-op.
 * The loop checks gating conditions on each tick (token? hostname?)
 * so the user can pair / set the hostname AFTER the loop started and
 * registration will Just Start.
 */
export function startHeartbeat(): void {
  if (timer) return;
  stopping = false;
  void tick();
  timer = setInterval(() => void tick(), HEARTBEAT_INTERVAL_MS);
}

/**
 * Stop the heartbeat AND send DELETE /me/companion-tunnel so the server
 * clears the routing pointer. Use this on Stop backend / app quit so
 * the catch-all falls back to the bundled API cleanly. Returns once
 * the DELETE round-trips (or fails — we don't block quit on it).
 */
export async function stopHeartbeatAndUnregister(opts: { silent?: boolean } = {}): Promise<void> {
  stopping = true;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  const token = pairing.getToken();
  if (!token) {
    emit({ phase: "idle", reason: "no token" });
    return;
  }
  try {
    const res = await fetch(`${apiBase()}/api/v1/me/companion-tunnel`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    if (!opts.silent && !res.ok) {
      // eslint-disable-next-line no-console
      console.warn("[tunnel-reg] DELETE returned", res.status);
    }
  } catch (err) {
    if (!opts.silent) {
      // eslint-disable-next-line no-console
      console.warn(
        "[tunnel-reg] DELETE failed:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  emit({ phase: "idle", reason: "unregistered" });
}

async function tick(): Promise<void> {
  if (stopping) return;
  const token = pairing.getToken();
  if (!token) {
    emit({ phase: "idle", reason: "not paired" });
    return;
  }
  const hostname = tunnelHostname();
  if (!hostname) {
    emit({ phase: "idle", reason: "no tunnel hostname configured" });
    return;
  }
  // We don't check Docker / cloudflared container state here — the
  // server's freshness gate handles "companion claims X but X is
  // unreachable" by returning 502 on the catch-all proxy. Adding a
  // tunnel-side healthcheck before registering would be redundant.

  if (cached.phase !== "registered") emit({ phase: "registering" });

  try {
    const res = await fetch(`${apiBase()}/api/v1/me/companion-tunnel`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ hostname }),
    });
    if (res.status === 401) {
      // Token revoked or invalid. Stop the loop — re-pair is the
      // only path forward, the user has to act.
      stopping = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      emit({
        phase: "error",
        message:
          "Bearer token rejected (401). Re-pair the companion from the Devices section.",
      });
      return;
    }
    if (!res.ok) {
      emit({
        phase: "error",
        message: `Register failed (${res.status})`,
      });
      // Don't tear down the loop — interval keeps trying so a
      // transient failure self-heals.
      return;
    }
    const body = (await res.json()) as {
      companionTunnel?: {
        hostname: string;
        lastSeenAt: string;
      };
    };
    if (body.companionTunnel) {
      emit({
        phase: "registered",
        hostname: body.companionTunnel.hostname,
        lastSeenAt: body.companionTunnel.lastSeenAt,
      });
    }
  } catch (err) {
    emit({
      phase: "error",
      message: err instanceof Error ? err.message : String(err),
    });
    // Schedule a faster retry once — transient DNS / TCP failures
    // shouldn't wait a full minute. The loop interval still ticks
    // on top of this; we just nudge sooner.
    setTimeout(() => {
      if (!stopping) void tick();
    }, REGISTER_RETRY_AFTER_MS);
  }
}

/**
 * Trigger an immediate heartbeat without waiting for the next interval.
 * Called when the user enters their tunnel hostname for the first time,
 * after pairing succeeds, etc.
 */
export function poke(): void {
  if (stopping) return;
  void tick();
}
