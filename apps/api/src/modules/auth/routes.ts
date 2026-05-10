/**
 * /api/v1/auth/* router. Wiring only — no business logic.
 *
 * Public surface (no requireAuth):
 *   POST /login                    log in with email + password
 *   POST /logout                   no-op if no cookie; clears cookie if set
 *   POST /accept-invite            redeem one-time invite token, set password
 *   POST /password/reset-request   begin password reset (always 200 — no enumeration)
 *   POST /password/reset           redeem one-time reset token, set new password
 *
 * Authenticated:
 *   GET  /me                       requireAuth (TOTP-gated by default)
 *
 * Admin-only:
 *   POST /invite                   requireAuth + requireRole("admin")
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
} from "./controller.js";

export const authRouter: Router = Router();

// public
authRouter.post("/login", loginHandler);
authRouter.post("/logout", logoutHandler);
authRouter.post("/accept-invite", acceptInviteHandler);
authRouter.post("/password/reset-request", passwordResetRequestHandler);
authRouter.post("/password/reset", passwordResetHandler);

// authenticated
authRouter.get("/me", requireAuth(), meHandler);

// admin
authRouter.post("/invite", requireAuth(), requireRole("admin"), inviteHandler);
