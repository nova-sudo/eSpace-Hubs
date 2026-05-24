/**
 * /api/v1/companion/* router. Pairing flow + device management.
 *
 * Public (no session — the companion has no identity yet):
 *   POST /pair/start          companion → opens a pairing
 *   GET  /pair/poll?code=...  companion → polls for approval + token
 *
 * Authenticated (browser session, TOTP enrolment NOT required so the
 * pairing flow works for users still on /totp-setup):
 *   POST /pair/approve        browser → approves a pending pairing
 *   GET  /devices             browser → lists the user's devices
 *   DELETE /devices/:id       browser → revokes a device
 *
 * The /pair/start + /pair/poll endpoints are deliberately permissive
 * on rate-limiting — companion-side retries should not lock the user
 * out of pairing. A separate per-IP limit (TBD) would gate pure-spam
 * abuse if it ever matters.
 */

import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.js";
import {
  listDevicesHandler,
  pairApproveHandler,
  pairPollHandler,
  pairStartHandler,
  revokeDeviceHandler,
} from "./controller.js";

export const companionRouter: Router = Router();

// ─── public ──────────────────────────────────────────────────────────
companionRouter.post("/pair/start", pairStartHandler);
companionRouter.get("/pair/poll", pairPollHandler);

// ─── authenticated ───────────────────────────────────────────────────
// Browser-side approval flow. We allow un-enrolled TOTP users so a
// brand-new Crealogix dev can pair their companion as part of first
// onboarding (the bundled-API gates on /totp-setup; pairing is a
// separate UI flow the user can resume after enrolment if they
// abandon it).
companionRouter.post(
  "/pair/approve",
  requireAuth({ requireTotpEnrolled: false }),
  pairApproveHandler,
);
companionRouter.get("/devices", requireAuth(), listDevicesHandler);
companionRouter.delete("/devices/:id", requireAuth(), revokeDeviceHandler);
