/**
 * Tiny JSON-file store.
 *
 * Schema (intentionally flat — easier to extend without migrations):
 *   repoPath          string   absolute path to the user's espace-devhub checkout
 *   tunnelToken       string   Cloudflare Tunnel token (used by docker compose's tunnel sidecar)
 *   autoStartAtLogin  boolean  whether the companion launches at OS sign-in
 *
 * Storage location (electron's app.getPath("userData")):
 *   Windows: %APPDATA%/eSpace Dev Hub Companion/config.json
 *   macOS:   ~/Library/Application Support/eSpace Dev Hub Companion/config.json
 *   Linux:   ~/.config/eSpace Dev Hub Companion/config.json
 *
 * We rolled our own instead of using electron-store because v10 of
 * that library is pure ESM — pulling it into a CommonJS Electron main
 * process triggers the "Cannot use import statement outside a module"
 * dance Electron 33 still has rough edges around. ~40 LOC of JSON I/O
 * is the smaller cost.
 *
 * SECURITY NOTE: the tunnel token is stored in plaintext. Phase 1
 * accepts that — the token only lets someone with filesystem access
 * route traffic to YOUR tunnel; they'd still need the api's own auth
 * to do anything useful with it. Phase 2/4 moves this into the OS
 * keychain via electron's safeStorage.
 */

import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

interface CompanionSchema {
  repoPath?: string;
  tunnelToken?: string;
  autoStartAtLogin?: boolean;
  // ── VPN (Phase 2) ────────────────────────────────────────────────
  // Non-secret VPN config. The PASSWORD lives in keychain.ts, never
  // here. Kept flat so future engagement-specific tweaks don't need
  // a migration step.
  /** Username for FortiClient / openfortivpn auth. */
  vpnUsername?: string;
  /** Gateway hostname (used by openfortivpn). Most users with the
   * GUI FortiClient won't need this — FortiClient stores the gateway
   * in its own saved profile. */
  vpnGateway?: string;
  /** FortiClient saved-profile name (used when shelling out via
   * `FortiClient.exe -p <profile>`). Defaults to "Crealogix". */
  vpnProfile?: string;
  /** Hostname we probe to detect "is the VPN up." Defaults to
   * git.bcn.crealogix.net. Parameterised so other engagements can
   * reuse the same machinery without code changes. */
  vpnGatedHost?: string;
  /** When true, clicking "Start backend" pre-flights the VPN — brings
   * it up first if it's down. */
  vpnAutoConnectOnStart?: boolean;
  // ── Phase 3d: companion-tunnel routing ──────────────────────────
  /** Public URL of the eSpace Dev Hub frontend the companion talks
   *  to (for /api/v1/companion/* and /me/companion-tunnel). Defaults
   *  to the production deployment; can be pointed at a preview /
   *  localhost while developing. */
  apiBaseUrl?: string;
  /** The PUBLIC hostname the user's CF Tunnel exposes the local
   *  backend at. Mirrors the tunnel's --hostname or the auto-assigned
   *  trycloudflare.com value. The companion POSTs this to the
   *  Vercel app on backend start so the catch-all knows where to
   *  proxy this user's requests. */
  tunnelHostname?: string;
  /** When true, backend:start auto-registers tunnelHostname via the
   *  paired bearer token AND backend:stop clears it. Defaults to true
   *  on a fresh install. */
  tunnelAutoRegister?: boolean;
}

const FILE_NAME = "config.json";

function configPath(): string {
  return path.join(app.getPath("userData"), FILE_NAME);
}

function read(): CompanionSchema {
  try {
    const raw = fs.readFileSync(configPath(), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as CompanionSchema;
    }
    return {};
  } catch {
    // File missing or unreadable → start fresh. We never throw from
    // this path so the companion can render even on a corrupted
    // settings file (user can re-enter their values).
    return {};
  }
}

function write(data: CompanionSchema): void {
  const p = configPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
}

export const settings = {
  all(): CompanionSchema {
    return read();
  },
  get<T>(key: keyof CompanionSchema, fallback: T): T {
    const v = read()[key];
    return v === undefined ? fallback : (v as unknown as T);
  },
  set<K extends keyof CompanionSchema>(key: K, value: CompanionSchema[K]): void {
    const cur = read();
    cur[key] = value;
    write(cur);
  },
  patch(p: Partial<CompanionSchema>): void {
    const cur = read();
    write({ ...cur, ...p });
  },
};
