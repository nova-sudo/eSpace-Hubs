/**
 * /api/v1/auth/* router. Wiring only — no business logic. Each handler
 * lives in ./controller.ts and is plain async (req, res, next).
 *
 * Per-route auth requirements:
 *
 *   POST /login    public — that's the point
 *   POST /logout   no requireAuth — logging out a non-session is a
 *                  no-op that just clears the cookie. Avoids 401s on
 *                  stale tabs.
 *   GET  /me       requireAuth + TOTP enforced (default)
 */

import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.js";
import {
  loginHandler,
  logoutHandler,
  meHandler,
} from "./controller.js";

export const authRouter: Router = Router();

authRouter.post("/login", loginHandler);
authRouter.post("/logout", logoutHandler);
authRouter.get("/me", requireAuth(), meHandler);
