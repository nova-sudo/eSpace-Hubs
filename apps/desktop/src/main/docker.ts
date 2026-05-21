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
  // `--profile tunnel` brings up the optional CF tunnel sidecar
  // alongside mongo + api. The companion's whole job is to expose
  // the api to a Vercel frontend through CF Tunnel, so we want the
  // tunnel container running by default.
  return ["compose", "--profile", "tunnel", ...extra];
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

function pushLog(line: string): void {
  // Keep the most-recent LOG_TAIL_MAX lines in memory so the UI's
  // "tail logs" panel can show context after the fact, without the
  // app holding onto unbounded buffers.
  const split = line.split(/\r?\n/).filter(Boolean);
  for (const s of split) {
    logTail.push(s);
    if (logTail.length > LOG_TAIL_MAX) logTail.shift();
  }
}

export async function startBackend(): Promise<{ ok: boolean; message: string }> {
  lastError = null;
  pushLog("[companion] starting docker compose --profile tunnel up -d");
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
