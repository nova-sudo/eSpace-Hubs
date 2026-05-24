/**
 * Lightweight "is Docker installed" probe used by the onboarding
 * wizard.
 *
 * We deliberately DON'T try `docker ps` here — that requires the
 * Docker daemon to actually be running. The onboarding step just
 * wants to know whether the CLI is on PATH; the daemon-running case
 * is handled later when the user clicks "Start backend" and gets
 * a clear error from the existing docker.ts machinery if it isn't.
 *
 * Returns:
 *   { installed: true,  version: "Docker version 25.0.3, …" } on success
 *   { installed: false, message: "<reason>" }                  otherwise
 *
 * `spawn ENOENT` is the canonical "docker not on PATH" failure. We
 * also treat "command timed out" the same way — Docker Desktop's
 * shim sometimes blocks on first invocation for several seconds; if
 * we haven't gotten a version string in 5s, it's not in a usable
 * state for the onboarding flow.
 */

import { spawn } from "node:child_process";

const TIMEOUT_MS = 5_000;

export interface DockerCheckResult {
  installed: boolean;
  version: string | null;
  message: string;
}

export function checkDocker(): Promise<DockerCheckResult> {
  return new Promise((resolve) => {
    let resolved = false;
    let stdout = "";
    let stderr = "";

    const settle = (r: DockerCheckResult) => {
      if (resolved) return;
      resolved = true;
      resolve(r);
    };

    const child = spawn("docker", ["--version"], {
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
          err.message === "spawn docker ENOENT" ||
          (err as NodeJS.ErrnoException).code === "ENOENT"
            ? "Docker not found on PATH. Install Docker Desktop and restart the companion."
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
            out ||
            `docker --version exited with code ${code}. Check your Docker Desktop install.`,
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
        message:
          "docker --version timed out after 5s. Docker Desktop may be paused or installing.",
      });
    }, TIMEOUT_MS);
  });
}
