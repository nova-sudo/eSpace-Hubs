/**
 * Native backend process — spawns apps/api's Express server directly
 * (`npx tsx watch --clear-screen=false src/server.ts`, the exact
 * command `npm run dev` runs inside apps/api) instead of shelling out
 * to `docker compose`.
 *
 * Why this replaced docker.ts
 * ────────────────────────────
 * Docker Desktop on Windows runs containers inside a separate WSL2 VM.
 * A corporate VPN client pushes routes into the Windows host's own
 * network stack, not automatically into that inner VM — so a container
 * can resolve a VPN-only hostname (via extra_hosts) but still fail to
 * connect to it. Running the api as a plain Windows/macOS/Linux process
 * sidesteps the problem entirely: it's the HOST's network stack making
 * the connection, the same one that already proved it can reach the
 * VPN. No Docker, no WSL2, no local Mongo container either — MONGO_URI
 * in apps/api/.env.local just needs to point at a real MongoDB (Atlas
 * or otherwise); that's a config value, not something this module
 * manages.
 *
 * Lifecycle mirrors tunnel-spawn.ts's shape (the other long-lived
 * companion-managed subprocess): spawn, track a simple running flag,
 * pipe output into the shared log buffer, SIGTERM-then-taskkill-on-
 * Windows to stop. Unlike tunnel-spawn.ts there's no auto-restart on
 * crash — an immediately-crashing api (e.g. a MONGO_URI that fails to
 * parse and throws at import time) would just crash-loop uselessly;
 * the user needs to fix config and click Start again.
 */

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { settings } from "./settings.js";
import { pushLog } from "./log-buffer.js";

/** How long to wait for the "listening" log line before giving up and
 *  reporting "starting" anyway — the log format could change under us,
 *  and api:ping (polled separately by the renderer) is the real source
 *  of truth for "is it actually healthy." */
const BOOT_WAIT_MS = 8_000;
/** Matches server.ts's own SHUTDOWN_DEADLINE_MS — give the graceful
 *  drain (in-flight requests + Mongo pool close) the same window
 *  before we escalate to SIGKILL. */
const STOP_GRACE_MS = 10_000;

let child: ChildProcess | null = null;
let running = false;
let lastError: string | null = null;
let stopping = false;

function repoPath(): string {
  const explicit = settings.get<string>("repoPath", "");
  if (explicit && explicit.trim()) return explicit;
  return process.cwd();
}

function apiDir(): string {
  return path.join(repoPath(), "apps", "api");
}

/**
 * `apps/api` reads `.env.local` (dotenv) on boot and throws early if
 * required keys are missing entirely. A fresh clone never has this
 * file (gitignored, holds secrets) — bootstrap it from .env.example so
 * "Start backend" doesn't hard-fail on a missing file. The example's
 * dev-placeholder values (SESSION_SECRET, INTEGRATION_TOKEN_KEY, a
 * localhost MONGO_URI) are enough for the process to boot and listen;
 * MONGO_URI specifically still needs to be a real reachable Mongo for
 * /readyz to go green — see the mongo-failure log hint in
 * startBackend() below. Never touches an existing .env.local.
 */
function ensureApiEnvLocal(dir: string): { ok: boolean; message?: string } {
  const envLocal = path.join(dir, ".env.local");
  const envExample = path.join(dir, ".env.example");
  if (fs.existsSync(envLocal)) return { ok: true };
  if (!fs.existsSync(envExample)) {
    return {
      ok: false,
      message: `apps/api/.env.local is missing and there's no .env.example to copy from at ${dir} — check the repo folder set in Settings is correct.`,
    };
  }
  try {
    fs.copyFileSync(envExample, envLocal);
    pushLog("[companion] created apps/api/.env.local from .env.example (dev defaults)");
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Couldn't create apps/api/.env.local from .env.example: ${msg}` };
  }
}

export async function startBackend(): Promise<{ ok: boolean; message: string }> {
  lastError = null;
  if (child) {
    return { ok: true, message: "Backend already running." };
  }

  const dir = apiDir();
  const envCheck = ensureApiEnvLocal(dir);
  if (!envCheck.ok) {
    lastError = envCheck.message ?? "apps/api/.env.local is missing.";
    return { ok: false, message: lastError };
  }

  stopping = false;
  pushLog(`[companion] starting apps/api natively (cwd=${dir})`);

  return new Promise((resolve) => {
    let resolved = false;
    const settle = (result: { ok: boolean; message: string }) => {
      if (resolved) return;
      resolved = true;
      resolve(result);
    };

    // npx (like npm) is a .cmd shim on Windows — needs shell:true to
    // resolve, unlike a real .exe. See repo-clone.ts's git-vs-npm split
    // for the same distinction (and the bug that came from getting it
    // backwards).
    const proc = spawn(
      "npx",
      ["tsx", "watch", "--clear-screen=false", "src/server.ts"],
      { cwd: dir, shell: process.platform === "win32", windowsHide: true },
    );
    child = proc;

    const handleLine = (line: string) => {
      if (line.includes('"msg":"[boot] api listening on')) {
        running = true;
        settle({ ok: true, message: "Backend started." });
      }
      if (line.includes('"msg":"[db] mongo connection failed"')) {
        pushLog(
          "[companion] can't reach MongoDB — MONGO_URI in apps/api/.env.local needs to point at a real database now that the backend runs natively (no local Mongo container).",
        );
      }
    };

    const consume = (label: string) => (d: Buffer) => {
      const text = d.toString();
      for (const line of text.split(/\r?\n/)) {
        if (!line) continue;
        pushLog(`[api${label}] ${line}`);
        handleLine(line);
      }
    };
    proc.stdout?.on("data", consume(""));
    proc.stderr?.on("data", consume("/err"));

    proc.on("error", (err) => {
      const isMissing = (err as NodeJS.ErrnoException).code === "ENOENT";
      const msg = isMissing ? "npx not found on PATH. Install Node.js, then retry." : err.message;
      lastError = msg;
      running = false;
      child = null;
      settle({ ok: false, message: msg });
    });

    proc.on("close", (code) => {
      const wasRunning = running;
      running = false;
      child = null;
      if (stopping) {
        pushLog(`[companion] api process stopped (code=${code})`);
        return;
      }
      const msg = wasRunning
        ? `api process exited unexpectedly (code=${code}). Check the logs above and click Start again.`
        : `api process exited before it started listening (code=${code}).`;
      pushLog(`[companion] ${msg}`);
      lastError = msg;
      settle({ ok: false, message: msg });
    });

    setTimeout(() => {
      if (resolved) return;
      if (child === proc) running = true;
      settle({ ok: true, message: "Backend starting…" });
    }, BOOT_WAIT_MS);
  });
}

export async function stopBackend(
  options: { silent?: boolean } = {},
): Promise<{ ok: boolean; message: string }> {
  if (!child) {
    running = false;
    return { ok: true, message: "Backend already stopped." };
  }
  stopping = true;
  const proc = child;
  if (!options.silent) pushLog("[companion] stopping api process");

  await new Promise<void>((resolve) => {
    const cleanup = () => resolve();
    proc.once("close", cleanup);
    try {
      if (process.platform === "win32") {
        // SIGTERM doesn't propagate reliably to the tsx-watch → node
        // child tree on Windows — taskkill /T reaps the whole tree,
        // same fix tunnel-spawn.ts uses for cloudflared's helpers.
        spawn("taskkill", ["/F", "/T", "/PID", String(proc.pid)], {
          shell: false,
          windowsHide: true,
        }).on("close", () => {
          /* close event on `proc` settles the promise */
        });
      } else {
        proc.kill("SIGTERM");
        setTimeout(() => {
          try {
            proc.kill("SIGKILL");
          } catch {
            /* already dead */
          }
        }, STOP_GRACE_MS);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        "[backend-process] kill failed:",
        err instanceof Error ? err.message : String(err),
      );
      cleanup();
    }
  });

  child = null;
  running = false;
  if (!options.silent) pushLog("[companion] api process stopped");
  return { ok: true, message: "Backend stopped" };
}

export function backendStatus(): {
  running: boolean;
  lastError: string | null;
  repoPath: string;
} {
  return { running, lastError, repoPath: repoPath() };
}
