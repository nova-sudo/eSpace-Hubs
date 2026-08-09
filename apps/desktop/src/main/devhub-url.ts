/**
 * The one place that knows where the Dev Hub lives.
 *
 * Every companion → Dev Hub call (device pairing in pair.ts, tunnel
 * registration + heartbeat in tunnel-register.ts) resolves its base URL
 * through here. Before this module the default was duplicated as a
 * `DEFAULT_API_BASE_URL` const in BOTH files — and both still pointed at
 * the retired Vercel deployment after the move to Coolify, so a
 * companion whose `apiBaseUrl` setting was blank paired and heartbeated
 * against a host that no longer serves the app.
 *
 * Resolution order (first non-empty wins):
 *
 *   1. `apiBaseUrl` in companion settings — the user's explicit
 *      override, set from the onboarding wizard or the settings panel.
 *      Use this to point at a preview deploy or localhost:3000.
 *   2. `DEVHUB_URL` in the process environment — lets a packaged build
 *      (or `DEVHUB_URL=… npm run dev`) target a different deployment
 *      without touching the source or the user's settings file.
 *   3. `DEFAULT_DEVHUB_URL` below.
 *
 * ── CHANGE THIS WHEN THE PUBLIC DOMAIN CHANGES ─────────────────────
 * Whatever this resolves to must be a PUBLICLY reachable origin that
 * serves `/api/v1/*` — never the container-internal `http://api:4000`.
 * Two origins qualify on the Coolify split deploy
 * (docs/deployment-coolify.md), and either works:
 *
 *   - the **api** app's own domain — what we default to, one less hop
 *   - the **web** app's domain, which rewrites `/api/v1/*` to the api
 *     container via `API_ORIGIN`
 *
 * The companion never needs the web origin for its own sake: it only
 * calls `/api/v1/companion/*` and `/api/v1/auth/me/companion-tunnel`,
 * and the browser-facing pairing-approval link is built SERVER-side
 * from the api's `APP_URL` and handed back in the /pair/start response
 * (see `approvalBaseUrl()` in modules/companion/controller.ts). Which
 * means: if `APP_URL` on the api service is wrong or unset, the
 * approval link the companion opens will be wrong no matter what this
 * constant says.
 */

import { settings } from "./settings.js";

/**
 * Public origin of the production Dev Hub API.
 *
 * If the deployment moves, this constant is the only thing that needs
 * editing — or ship the build with `DEVHUB_URL` set.
 */
export const DEFAULT_DEVHUB_URL = "https://espace-hubs-api.espace.ws";

function clean(value: string | undefined | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\/$/, "");
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Base URL for companion → Dev Hub HTTP calls. Never has a trailing
 * slash, so callers can append `/api/v1/...` directly.
 */
export function devhubBaseUrl(): string {
  return (
    clean(settings.get<string>("apiBaseUrl", "")) ??
    clean(process.env.DEVHUB_URL) ??
    DEFAULT_DEVHUB_URL
  );
}
