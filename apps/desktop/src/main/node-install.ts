/**
 * One-click Node.js install for the onboarding wizard — same shape as
 * cloudflared-install.ts, shelling out to the platform package manager:
 *
 *   Windows  winget install --id OpenJS.NodeJS.LTS
 *   macOS    brew install node
 *   Linux    apt-get install nodejs npm (best-effort — Debian/Ubuntu's
 *            default repos often carry an older Node than apps/api
 *            needs; falls back to the manual instructions shown in the
 *            wizard if that turns out to be too old)
 */

import { spawn } from "node:child_process";
import { pushLog } from "./log-buffer.js";

export interface InstallResult {
  ok: boolean;
  message: string;
}

function commandExists(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe =
      process.platform === "win32"
        ? spawn("where", [cmd], { windowsHide: true })
        : spawn("which", [cmd]);
    probe.on("error", () => resolve(false));
    probe.on("close", (code) => resolve(code === 0));
  });
}

function refreshWindowsPath(): Promise<void> {
  if (process.platform !== "win32") return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const ps = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "[System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')",
      ],
      { windowsHide: true },
    );
    let out = "";
    ps.stdout?.on("data", (d) => {
      out += d.toString();
    });
    ps.on("error", settle);
    ps.on("close", () => {
      const combined = out.trim();
      if (combined) {
        process.env.PATH = combined;
        pushLog("[node-install] refreshed PATH from registry");
      }
      settle();
    });
    setTimeout(settle, 5_000);
  });
}

// Same winget quirk as cloudflared-install.ts: installing an
// already-current package makes winget exit non-zero with this
// message instead of treating it as a no-op success.
const WINGET_ALREADY_CURRENT_RE = /already installed/i;
const WINGET_NO_UPGRADE_RE = /no (applicable|available|newer) (update|upgrade|package)/i;

function run(cmd: string, args: string[]): Promise<InstallResult> {
  return new Promise((resolve) => {
    pushLog(`[node-install] running: ${cmd} ${args.join(" ")}`);
    let stdout = "";
    let stderr = "";
    const child = spawn(cmd, args, { shell: false, windowsHide: true });
    child.stdout?.on("data", (d) => {
      const text = d.toString();
      stdout += text;
      pushLog(`[node-install] ${text.trim()}`);
    });
    child.stderr?.on("data", (d) => {
      const text = d.toString();
      stderr += text;
      pushLog(`[node-install/err] ${text.trim()}`);
    });
    child.on("error", (err) => {
      const isMissing = (err as NodeJS.ErrnoException).code === "ENOENT";
      resolve({
        ok: false,
        message: isMissing ? `${cmd} not found on PATH.` : err.message,
      });
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ ok: true, message: "Node.js installed." });
      } else {
        resolve({
          ok: false,
          message: (stderr || stdout).trim() || `${cmd} exited with code ${code}.`,
        });
      }
    });
  });
}

export async function installNode(): Promise<InstallResult> {
  switch (process.platform) {
    case "win32": {
      const hasWinget = await commandExists("winget");
      if (!hasWinget) {
        return {
          ok: false,
          message:
            "winget isn't available on this machine (needs the App Installer from the Microsoft Store). Use the manual command below.",
        };
      }
      const result = await run("winget", [
        "install",
        "--id",
        "OpenJS.NodeJS.LTS",
        "-e",
        "--accept-package-agreements",
        "--accept-source-agreements",
      ]);
      await refreshWindowsPath();
      if (result.ok) return result;
      if (
        WINGET_ALREADY_CURRENT_RE.test(result.message) &&
        WINGET_NO_UPGRADE_RE.test(result.message)
      ) {
        return { ok: true, message: "Node.js is already installed and up to date." };
      }
      return result;
    }
    case "darwin": {
      const hasBrew = await commandExists("brew");
      if (!hasBrew) {
        return {
          ok: false,
          message:
            "Homebrew isn't installed. Install it from https://brew.sh, then retry — or use the manual command below.",
        };
      }
      return run("brew", ["install", "node"]);
    }
    case "linux": {
      const hasApt = await commandExists("apt-get");
      if (!hasApt) {
        return {
          ok: false,
          message:
            "Automatic install currently only supports apt-based distros. Use the manual command below.",
        };
      }
      const hasPkexec = await commandExists("pkexec");
      if (!hasPkexec) {
        return {
          ok: false,
          message:
            "Automatic install needs pkexec (polkit) for the root prompt. Use the manual command below instead.",
        };
      }
      return run("pkexec", ["bash", "-c", "apt-get update && apt-get install -y nodejs npm"]);
    }
    default:
      return {
        ok: false,
        message: `Automatic install isn't supported on ${process.platform}.`,
      };
  }
}
