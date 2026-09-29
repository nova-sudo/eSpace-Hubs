/**
 * "No AI credentials" — one error for every AI entry point.
 *
 * The detailed operator message names env vars (ANTHROPIC_API_KEY,
 * LITELLM_API_KEY, …). That belongs in the API log for whoever deploys the
 * app, never in the browser: an engineer clicking "Build my own" can't act
 * on an env var and shouldn't learn the deployment's config. The user sees
 * one plain sentence; the log keeps the detail.
 */

import { HttpError } from "../../middleware/error-handler.js";
import { logger } from "../../lib/logger.js";

export const AI_UNCONFIGURED_CODE = "ai_provider_unconfigured";
export const AI_UNCONFIGURED_MESSAGE =
  "AI isn't configured for this workspace — ask your admin. You can still set this goal up by hand.";

/** Log the operator detail, return the user-safe 503. */
export function aiUnconfigured(detail: string): HttpError {
  logger.warn({ detail }, "[ai] provider has no credentials");
  return new HttpError(503, AI_UNCONFIGURED_CODE, AI_UNCONFIGURED_MESSAGE);
}
