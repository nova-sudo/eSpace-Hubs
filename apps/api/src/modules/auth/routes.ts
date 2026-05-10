/**
 * /api/v1/auth/* router. Wiring only — no business logic.
 *
 * Public surface (no requireAuth):
 *   POST /login                    log in with email + password — when the
 *                                  user has TOTP enrolled, returns a partial
 *                                  session and `needsTotp: true`
 *   POST /logout                   no-op if no cookie; clears cookie if set
 *   POST /accept-invite            redeem one-time invite token, set password
 *   POST /password/reset-request   begin password reset (always 200 — no enumeration)
 *   POST /password/reset           redeem one-time reset token, set new password
 *
 * Authenticated, partial session OK (requireTotp: false):
 *   POST /totp/verify              step 2 of two-step login; flips
 *                                  session.totpVerified=true on a valid code
 *
 * Authenticated, full session (requireTotp: true is the default):
 *   GET  /me                       returns the current user
 *   POST /totp/enrol               start a new enrolment (rejects if already enrolled)
 *   POST /totp/verify-enrolment    confirm enrolment with a fresh code
 *   POST /totp/disable             turn TOTP off, requires current code
 *
 * Admin-only:
 *   POST /invite                   creates an invited user, sends accept link
 */

import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireRole } from "../../middleware/require-role.js";
import {
  acceptInviteHandler,
  inviteHandler,
  loginHandler,
  logoutHandler,
  meHandler,
  passwordResetHandler,
  passwordResetRequestHandler,
  totpDisableHandler,
  totpEnrolHandler,
  totpVerifyEnrolmentHandler,
  totpVerifyLoginHandler,
} from "./controller.js";

export const authRouter: Router = Router();

// ─── public ──────────────────────────────────────────────────────────
authRouter.post("/login", loginHandler);
authRouter.post("/logout", logoutHandler);
authRouter.post("/accept-invite", acceptInviteHandler);
authRouter.post("/password/reset-request", passwordResetRequestHandler);
authRouter.post("/password/reset", passwordResetHandler);

// ─── partial session OK ──────────────────────────────────────────────
// requireTotp:false lets a totpVerified:false session reach this route
// (the entire purpose of the route is to flip that bit to true).
authRouter.post(
  "/totp/verify",
  requireAuth({ requireTotp: false }),
  totpVerifyLoginHandler,
);

// ─── authenticated (full session) ────────────────────────────────────
authRouter.get("/me", requireAuth(), meHandler);
authRouter.post("/totp/enrol", requireAuth(), totpEnrolHandler);
authRouter.post(
  "/totp/verify-enrolment",
  requireAuth(),
  totpVerifyEnrolmentHandler,
);
authRouter.post("/totp/disable", requireAuth(), totpDisableHandler);

// ─── admin-only ──────────────────────────────────────────────────────
authRouter.post(
  "/invite",
  requireAuth(),
  requireRole("admin"),
  inviteHandler,
);
