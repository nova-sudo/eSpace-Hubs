/**
 * VPN connection helpers — FortiClient (Crealogix's choice) for now.
 *
 * Two distinct things this module does:
 *
 *   1. Status detection — "is the VPN currently up?" — done by
 *      checking if a known gated hostname resolves to a private IP
 *      (or resolves at all). This is the SOURCE OF TRUTH for VPN
 *      state; whatever connect/disconnect helper we use is just a
 *      best-effort trigger.
 *
 *   2. Connect / disconnect via FortiClient — best-effort. FortiClient
 *      ships in a few shapes (standalone vs. EMS-managed) and the
 *      automation surface varies. Strategy:
 *        - Try the OpenFortiVPN CLI fork if present (best path)
 *        - Else try FortiClient.exe with a saved-profile flag
 *        - Else surface "open FortiClient manually" with clear copy
 *
 * Phase 2a (this commit): status detection + manual connect helper.
 * Phase 2b (immediate follow-up in same PR): actual auto-connect via
 * FortiClient.exe shellout.
 *
 * The gated hostname we probe is configurable so this same logic
 * works for any engagement that maps to a VPN-gated network. The
 * setting defaults to Crealogix's `git.bcn.crealogix.net`.
 */

import dns from "node:dns/promises";
import net from "node:net";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { get as kcGet } from "./keychain";
import { settings } from "./settings";

const DEFAULT_GATED_HOST = "git.bcn.crealogix.net";

// Common Windows FortiClient install paths. We check existence at
// runtime rather than hardcoding because Crealogix may have a
// repackaged install or an MSI override. If none of these exists
// we fall back to "user opens FortiClient manually."
const WINDOWS_CANDIDATES = [
  "C:\\Program Files\\Fortinet\\FortiClient\\FortiClient.exe",
  "C:\\Program Files (x86)\\Fortinet\\FortiClient\\FortiClient.exe",
  // OpenFortiVPN — better-scriptable alternative some users install:
  "C:\\Program Files\\openfortivpn\\openfortivpn.exe",
];

const MAC_CANDIDATES = [
  "/Applications/FortiClient.app/Contents/MacOS/FortiClient",
  "/usr/local/bin/openfortivpn",
];

const LINUX_CANDIDATES = [
  "/usr/bin/openfortivpn",
  "/usr/local/bin/openfortivpn",
];

function gatedHost(): string {
  return settings.get<string>("vpnGatedHost", DEFAULT_GATED_HOST);
}

/* ─────────────── status ─────────────── */

export interface VpnStatus {
  connected: boolean;
  /** "yes" / "no" / "unknown" — distinguishes a hard NXDOMAIN from a
   * temporary lookup failure so the UI can decide whether to retry. */
  resolution: "private" | "public" | "nxdomain" | "error";
  resolvedIp: string | null;
  gatedHost: string;
  message: string;
}

function isPrivateIp(ip: string): boolean {
  // RFC 1918 + 100.64.0.0/10 (carrier-grade NAT, sometimes used for VPN tunnels).
  if (ip.startsWith("10.")) return true;
  if (ip.startsWith("192.168.")) return true;
  if (ip.startsWith("172.")) {
    const second = Number(ip.split(".")[1] ?? "0");
    if (second >= 16 && second <= 31) return true;
  }
  if (ip.startsWith("100.")) {
    const second = Number(ip.split(".")[1] ?? "0");
    if (second >= 64 && second <= 127) return true;
  }
  return false;
}

export async function status(): Promise<VpnStatus> {
  const host = gatedHost();
  try {
    const result = await dns.lookup(host, { family: 4 });
    const ip = result.address;
    if (isPrivateIp(ip)) {
      // Resolves to a private IP — strong signal the VPN is up
      // (the gated host's name only resolves via the corp DNS that
      // VPN provides).
      return {
        connected: true,
        resolution: "private",
        resolvedIp: ip,
        gatedHost: host,
        message: `Resolved ${host} → ${ip} (private — VPN appears up)`,
      };
    }
    // Resolves to a public IP — could be a split-horizon setup
    // where the host is also publicly addressable. Try a TCP probe
    // to be sure.
    const reachable = await tcpProbe(ip, 443, 2000);
    return {
      connected: reachable,
      resolution: "public",
      resolvedIp: ip,
      gatedHost: host,
      message: reachable
        ? `Resolved ${host} → ${ip} (public, reachable)`
        : `Resolved ${host} → ${ip} (public, unreachable — VPN likely down)`,
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
      return {
        connected: false,
        resolution: "nxdomain",
        resolvedIp: null,
        gatedHost: host,
        message: `${host} doesn't resolve — VPN appears down (NXDOMAIN). Connect FortiClient to fix.`,
      };
    }
    return {
      connected: false,
      resolution: "error",
      resolvedIp: null,
      gatedHost: host,
      message: `DNS lookup failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function tcpProbe(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(false);
    }, timeoutMs);
    socket.once("connect", () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.end();
      resolve(true);
    });
    socket.once("error", () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(false);
    });
  });
}

/* ─────────────── client discovery ─────────────── */

export interface ClientInfo {
  kind: "forticlient" | "openfortivpn" | "none";
  path: string | null;
}

export function discoverClient(): ClientInfo {
  const candidates =
    process.platform === "win32"
      ? WINDOWS_CANDIDATES
      : process.platform === "darwin"
        ? MAC_CANDIDATES
        : LINUX_CANDIDATES;

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const name = path.basename(candidate).toLowerCase();
      if (name.includes("openfortivpn")) {
        return { kind: "openfortivpn", path: candidate };
      }
      if (name.includes("forticlient")) {
        return { kind: "forticlient", path: candidate };
      }
    }
  }
  return { kind: "none", path: null };
}

/* ─────────────── connect / disconnect (best-effort) ─────────────── */

export interface ConnectResult {
  ok: boolean;
  attempted: "openfortivpn" | "forticlient-launch" | "manual";
  message: string;
}

/**
 * Try to connect the VPN. Behavior depends on which client we find:
 *
 *   - openfortivpn → spawn with --username + --password (stored in
 *     keychain). Provides exit code + stderr we can act on.
 *   - FortiClient.exe → launch the GUI with a saved-profile arg
 *     (`-p <profileName>`). Connection actually happens via the
 *     user clicking "Connect" in the GUI — we just bring it
 *     forward. Better than nothing; phase-2b improves on this.
 *   - none → return a clear "open FortiClient yourself" message
 */
export async function connect(): Promise<ConnectResult> {
  const client = discoverClient();
  const profile = settings.get<string>("vpnProfile", "Crealogix");

  if (client.kind === "openfortivpn") {
    return runOpenFortiVPN(client.path!);
  }

  if (client.kind === "forticlient") {
    return launchFortiClientGui(client.path!, profile);
  }

  return {
    ok: false,
    attempted: "manual",
    message:
      "FortiClient wasn't found at the expected install paths. Open FortiClient manually and connect using your saved profile, then click 'Refresh status' here.",
  };
}

async function runOpenFortiVPN(binPath: string): Promise<ConnectResult> {
  const username = settings.get<string>("vpnUsername", "");
  const password = kcGet("vpnPassword");
  const gateway = settings.get<string>("vpnGateway", "");

  if (!username || !password || !gateway) {
    return {
      ok: false,
      attempted: "openfortivpn",
      message:
        "openfortivpn needs the gateway URL + username + password configured in the companion's VPN settings.",
    };
  }

  return new Promise((resolve) => {
    // openfortivpn writes to stderr even on success; we wait briefly
    // for either a successful tunnel-up line or a hard failure.
    const child = spawn(binPath, [gateway, "--username", username], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdin.write(`${password}\n`);
    child.stdin.end();

    let stderr = "";
    const timer = setTimeout(() => {
      // Tunnel established within 15s or we move on. openfortivpn
      // stays in foreground; we keep the child alive — disconnect
      // tears it down.
      resolve({
        ok: true,
        attempted: "openfortivpn",
        message: "openfortivpn started — verify with 'Refresh status' in a moment.",
      });
    }, 15_000);

    child.stderr?.on("data", (d) => {
      stderr += d.toString();
      // Bail early on auth failures so the user sees the error.
      if (/login failed|authentication/i.test(stderr)) {
        clearTimeout(timer);
        child.kill();
        resolve({
          ok: false,
          attempted: "openfortivpn",
          message: `openfortivpn login failed: ${stderr.split("\n").slice(-3).join(" ")}`,
        });
      }
    });

    child.once("error", (err) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        attempted: "openfortivpn",
        message: `openfortivpn failed to start: ${err.message}`,
      });
    });
  });
}

function launchFortiClientGui(binPath: string, profile: string): Promise<ConnectResult> {
  // FortiClient.exe on Windows can be invoked with `-p <profile>` to
  // bring up the GUI focused on a specific saved profile. From there
  // the user (or auto-connect-on-launch in the saved profile) takes
  // it to connected. Real headless automation is blocked by
  // EMS-managed deployments — this is the most reliable best-effort.
  return new Promise((resolve) => {
    const child = spawn(binPath, ["-p", profile], {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });
    child.once("error", (err) => {
      resolve({
        ok: false,
        attempted: "forticlient-launch",
        message: `Could not launch FortiClient: ${err.message}. Open it manually.`,
      });
    });
    // Detach so it survives this process. Resolve immediately —
    // the actual connection happens in FortiClient's UI flow.
    child.unref();
    resolve({
      ok: true,
      attempted: "forticlient-launch",
      message:
        "Opened FortiClient. If you didn't configure auto-connect on the saved profile, click 'Connect' in its window now.",
    });
  });
}

export async function disconnect(): Promise<ConnectResult> {
  // Honest about the limitation: we can't reliably disconnect a
  // FortiClient session from outside. On Windows, you'd `taskkill`
  // the FortiClient process — but the user may have other VPN
  // profiles in the same client. Phase 2b can wire openfortivpn's
  // graceful shutdown when that's the active client.
  return {
    ok: false,
    attempted: "manual",
    message:
      "Disconnect via the FortiClient tray icon for now. Auto-disconnect lands in a follow-up.",
  };
}
