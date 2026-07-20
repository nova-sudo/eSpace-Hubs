/**
 * "Is Node.js installed" probe used by the onboarding wizard.
 *
 * Node replaced Docker as the actual runtime dependency once the
 * companion started spawning apps/api directly (backend-process.ts)
 * instead of going through `docker compose` — the api process is a
 * plain Node/tsx child process, so Node.js on PATH is now the thing
 * that has to be true for "Start backend" to work at all.
 */

import { spawn } from "node:child_process";

const TIMEOUT_MS = 5_000;

export interface NodeCheckResult {
  installed: boolean;
  version: string | null;
  message: string;
}

export function checkNode(): Promise<NodeCheckResult> {
  return new Promise((resolve) => {
    let resolved = false;
    let stdout = "";
    let stderr = "";

    const settle = (r: NodeCheckResult) => {
      if (resolved) return;
      resolved = true;
      resolve(r);
    };

    const child = spawn("node", ["--version"], {
      shell: false,
      windowsHide: true,
    });
    child.stdout?.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      settle({
        installed: false,
        version: null,
        message:
          err.message === "spawn node ENOENT" ||
          (err as NodeJS.ErrnoException).code === "ENOENT"
            ? "Node.js not found on PATH. Install it and restart the companion."
            : err.message,
      });
    });
    child.on("close", (code) => {
      const out = stdout.trim() || stderr.trim();
      if (code === 0 && out) {
        settle({ installed: true, version: out, message: "" });
      } else {
        settle({
          installed: false,
          version: null,
          message:
            out || `node --version exited with code ${code}. Check your Node.js install.`,
        });
      }
    });

    setTimeout(() => {
      if (resolved) return;
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      settle({
        installed: false,
        version: null,
        message: "node --version timed out after 5s.",
      });
    }, TIMEOUT_MS);
  });
}
