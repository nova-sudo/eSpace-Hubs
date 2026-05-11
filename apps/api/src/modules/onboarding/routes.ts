/**
 * /api/v1/onboarding/* router.
 *
 *   POST /     authed — submit the M-OB form. Updates the user's
 *                       profile + resolves their hub. Returns the
 *                       new PublicUser + a `redirectTo` path.
 *
 * No GET endpoint — the user's onboarding state ships with the
 * PublicUser payload from /auth/me (`onboardingCompletedAt`,
 * `employeeId`, `department`), so the frontend reads it directly
 * from the session without a separate round-trip.
 */

import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.js";
import { submitOnboardingHandler } from "./controller.js";

export const onboardingRouter: Router = Router();

onboardingRouter.post("/", requireAuth(), submitOnboardingHandler);
