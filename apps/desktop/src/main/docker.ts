/**
 * Docker compose control — wraps `docker compose` shellouts so the
 * renderer can talk to them via IPC.
 *
 * Strategy: each operation spawns `docker compose` against the repo's
 * docker-compose.yml. We resolve the repo path from the settings store
 * (`repoPath`) so the companion app can be installed in `Program Files`
 * while pointing at the user's checkout anywhere on disk.
 *
 * Why shell out instead of using a Docker SDK
 * ────────────────────────────────────────────
 *   - Docker Desktop ships with the `docker` CLI; the SDK doesn't
 *     ship a default. Shelling out is the most-portable way.
 *   - The compose stack is defined declaratively in
 *     docker-compose.yml — we don't need fine-grained container
 *     control here; we just want "up" and "down."
 *
 * Status detection
 * ────────────────
 * We track an in-process boolean for "we kicked off a start." This
 * lets the tray menu reflect "starting" between the click and the
 * first successful healthcheck. The healthcheck (in `health.ts`) is
 * the real source of truth for "the API is reachable"; this flag
 * just smooths the UI.
 */

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { settings } from "./settings.js";

interface RunResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
}

let running = false;
let lastError: string | null = null;
let logTail: string[] = [];

const LOG_TAIL_MAX = 500;

function repoPath(): string {
  const explicit = settings.get<string>("repoPath", "");
  if (explicit && explicit.trim()) return explicit;
  // Best-guess default: run from wherever Electron was launched. This
  // works in dev (we cwd to repo root) but in a packaged app the user
  // MUST set repoPath via the settings UI before Start works.
  return process.cwd();
}

function dockerComposeArgs(...extra: string[]): string[] {
  // TEMP (TryCloudflare path): the `--profile tunnel` flag was
  // dropped so docker compose doesn't try to start the cloudflared
  // sidecar that requires TUNNEL_TOKEN. Run
  // `cloudflared tunnel --url http://localhost:4000` on the host
  // instead and paste the printed *.trycloudflare.com hostname into
  // the companion's tunnel-hostname field.
  // TODO: make the flag conditional on TUNNEL_TOKEN presence so a
  // named-tunnel user gets the sidecar back automatically.
  return ["compose", ...extra];
}

function run(args: string[]): Promise<RunResult> {
  return new Promise((resolve) => {
    const cwd = repoPath();
    const child: ChildProcess = spawn("docker", args, {
      cwd,
      shell: false,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => {
      const chunk = d.toString();
      stdout += chunk;
      pushLog(chunk);
    });
    child.stderr?.on("data", (d) => {
      const chunk = d.toString();
      stderr += chunk;
      pushLog(chunk);
    });
    child.on("error", (err) => {
      // `docker` not on PATH → most common cause of `spawn ENOENT` on
      // a machine where Docker Desktop isn't installed yet.
      lastError = err.message;
      resolve({ ok: false, code: null, stdout, stderr: err.message });
    });
    child.on("close", (code) => {
      resolve({ ok: code === 0, code, stdout, stderr });
    });
  });
}

// Exported so tunnel-spawn (and any future sibling subprocess module)
// can pipe its own output into the same shared log buffer the renderer
// reads via the `backend:logs` IPC. Centralising the buffer keeps the
// Logs panel showing the complete picture: docker output + cloudflared
// output + any other companion subprocess.
export function pushLog(line: string): void {
  // Keep the most-recent LOG_TAIL_MAX lines in memory so the UI's
  // "tail logs" panel can show context after the fact, without the
  // app holding onto unbounded buffers.
  const split = line.split(/\r?\n/).filter(Boolean);
  for (const s of split) {
    logTail.push(s);
    if (logTail.length > LOG_TAIL_MAX) logTail.shift();
  }
}

/**
 * `docker compose up` hard-fails before starting anything if
 * apps/api/.env.local is missing (docker-compose.yml's `env_file:`
 * entry) — a fresh clone never has one, since it holds
 * (dev-placeholder) secrets and is gitignored. The raw failure is a
 * Windows/Docker internals error ("GetFileAttributesEx ... The system
 * cannot find the file specified") that means nothing to a user who's
 * never heard of env_file. apps/api/.env.example's defaults work
 * as-is for local dev (dev SESSION_SECRET/INTEGRATION_TOKEN_KEY, Mongo
 * URI matching this compose file) — no values need filling in just to
 * get the backend running — so bootstrap it automatically instead of
 * making the user do it by hand. Never touches an existing .env.local.
 */
function ensureApiEnvLocal(repo: string): { ok: boolean; message?: string } {
  const envLocal = path.join(repo, "apps", "api", ".env.local");
  const envExample = path.join(repo, "apps", "api", ".env.example");
  if (fs.existsSync(envLocal)) return { ok: true };
  if (!fs.existsSync(envExample)) {
    return {
      ok: false,
      message: `apps/api/.env.local is missing and there's no .env.example to copy from at ${repo} — check the repo folder set in Settings is correct.`,
    };
  }
  try {
    fs.copyFileSync(envExample, envLocal);
    pushLog(`[companion] created apps/api/.env.local from .env.example (dev defaults)`);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      message: `Couldn't create apps/api/.env.local from .env.example: ${msg}`,
    };
  }
}

export async function startBackend(): Promise<{ ok: boolean; message: string }> {
  lastError = null;
  const envCheck = ensureApiEnvLocal(repoPath());
  if (!envCheck.ok) {
    lastError = envCheck.message ?? "apps/api/.env.local is missing.";
    return { ok: false, message: lastError };
  }
  pushLog("[companion] starting docker compose up -d");
  const res = await run(dockerComposeArgs("up", "-d"));
  if (!res.ok) {
    running = false;
    lastError = res.stderr || `docker exited with code ${res.code}`;
    return { ok: false, message: lastError };
  }
  running = true;
  pushLog("[companion] docker compose up -d returned 0");
  return { ok: true, message: "Backend started" };
}

export async function stopBackend(
  options: { silent?: boolean } = {},
): Promise<{ ok: boolean; message: string }> {
  if (!options.silent) {
    pushLog("[companion] stopping docker compose stack");
  }
  const res = await run(dockerComposeArgs("down"));
  if (!res.ok) {
    lastError = res.stderr || `docker exited with code ${res.code}`;
    return { ok: false, message: lastError };
  }
  running = false;
  if (!options.silent) {
    pushLog("[companion] docker compose down returned 0");
  }
  return { ok: true, message: "Backend stopped" };
}

export function backendStatus(): {
  running: boolean;
  lastError: string | null;
  repoPath: string;
} {
  return {
    running,
    lastError,
    repoPath: repoPath(),
  };
}

export function tailLogs(lines: number = 100): string[] {
  return logTail.slice(-Math.max(1, Math.min(lines, LOG_TAIL_MAX)));
}
