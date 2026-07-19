/**
 * One-click cloudflared install for the onboarding wizard.
 *
 * cloudflared is a single static binary with no admin-elevated GUI
 * installer, so — unlike Docker Desktop — we can actually automate
 * this end to end by shelling out to the platform's package manager:
 *
 *   Windows  winget install --id Cloudflare.cloudflared
 *   macOS    brew install cloudflared
 *   Linux    add Cloudflare's apt repo + apt-get install (via pkexec,
 *            since apt needs root and we don't want to prompt for a
 *            sudo password inside an Electron renderer)
 *
 * Every branch checks its prerequisite tool exists first and returns
 * an actionable message instead of a raw ENOENT — the wizard falls
 * back to the manual copy-paste command already shown in the UI.
 */

import { spawn } from "node:child_process";
import { pushLog } from "./docker.js";

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

function run(cmd: string, args: string[]): Promise<InstallResult> {
  return new Promise((resolve) => {
    pushLog(`[cloudflared-install] running: ${cmd} ${args.join(" ")}`);
    let stdout = "";
    let stderr = "";
    const child = spawn(cmd, args, { shell: false, windowsHide: true });
    child.stdout?.on("data", (d) => {
      const text = d.toString();
      stdout += text;
      pushLog(`[cloudflared-install] ${text.trim()}`);
    });
    child.stderr?.on("data", (d) => {
      const text = d.toString();
      stderr += text;
      pushLog(`[cloudflared-install/err] ${text.trim()}`);
    });
    child.on("error", (err) => {
      const isMissing = (err as NodeJS.ErrnoException).code === "ENOENT";
      resolve({
        ok: false,
        message: isMissing
          ? `${cmd} not found on PATH.`
          : err.message,
      });
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ ok: true, message: "cloudflared installed." });
      } else {
        resolve({
          ok: false,
          message:
            (stderr || stdout).trim() ||
            `${cmd} exited with code ${code}.`,
        });
      }
    });
  });
}

export async function installCloudflared(): Promise<InstallResult> {
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
      return run("winget", [
        "install",
        "--id",
        "Cloudflare.cloudflared",
        "-e",
        "--accept-package-agreements",
        "--accept-source-agreements",
      ]);
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
      return run("brew", ["install", "cloudflared"]);
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
      // Cloudflare's official apt setup: add the signing key + repo,
      // then install. All static — no user input reaches this string.
      const script = [
        "set -e",
        "mkdir -p --mode=0755 /usr/share/keyrings",
        "curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /usr/share/keyrings/cloudflare-main.gpg",
        "echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' > /etc/apt/sources.list.d/cloudflared.list",
        "apt-get update",
        "apt-get install -y cloudflared",
      ].join(" && ");
      return run("pkexec", ["bash", "-c", script]);
    }
    default:
      return {
        ok: false,
        message: `Automatic install isn't supported on ${process.platform}.`,
      };
  }
}
