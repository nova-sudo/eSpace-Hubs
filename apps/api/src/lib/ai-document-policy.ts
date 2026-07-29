/**
 * May this user's DOCUMENT content leave for a third-party AI provider?
 *
 * The repo already encodes a data-residency split — every engagement
 * resolves its own integration endpoints (`engagement-config.ts`), and
 * one engagement is served entirely by the desktop app inside the
 * client's VPN rather than by this cloud backend. `modules/ai/*` has
 * had zero engagement-awareness so far, which was survivable while the
 * only thing crossing the boundary was a sentence the user typed
 * themselves. Uploading a whole planning document is a different
 * proposition: the user isn't authoring the payload any more, they're
 * forwarding one, and `selectProvider()` will happily post it to
 * Anthropic / Mistral / OpenRouter.
 *
 * So the guard is deliberately GENERIC. It is not "block client X" —
 * that would rot the moment a second restricted engagement appears and
 * would bake one customer's legal position into application code.
 * It's an allow-list read from the environment, exactly like
 * `getEngagementConfig()` reads its per-engagement env block:
 *
 *   AI_DOCUMENT_UPLOAD_ENGAGEMENTS=espace,acme   → those two may upload
 *   AI_DOCUMENT_UPLOAD_ENGAGEMENTS=*             → everyone may
 *   (unset)                                       → DEFAULT_ENGAGEMENT only
 *
 * Default-deny is the point: a new engagement added to `ALL_ENGAGEMENTS`
 * cannot start shipping documents to a third party just by existing —
 * someone has to name it in the env first, which is the moment the
 * question actually gets asked. Unrecognised tokens are ignored rather
 * than throwing at import time; a typo in the env must fail CLOSED (one
 * engagement quietly loses the upload button) instead of taking the
 * whole API down at boot.
 */

import {
  ALL_ENGAGEMENTS,
  DEFAULT_ENGAGEMENT,
  type Engagement,
} from "../db/types.js";
import { HttpError } from "../middleware/error-handler.js";

const ENV_KEY = "AI_DOCUMENT_UPLOAD_ENGAGEMENTS";

export interface DocumentUploadPolicy {
  /** Engagements cleared to send document content to an AI provider. */
  engagements: readonly Engagement[];
  /** `*` / `all` escape hatch — set once the question is settled globally. */
  allowAll: boolean;
}

/**
 * Resolve the policy from the env on every call. Cheap (one split of a
 * short string) and matches `getEngagementConfig()`'s no-cache shape, so
 * scripts and tests can set the var and see it take effect without a
 * module-registry reset.
 */
export function getDocumentUploadPolicy(): DocumentUploadPolicy {
  const raw = process.env[ENV_KEY]?.trim();
  if (!raw) {
    return { engagements: [DEFAULT_ENGAGEMENT], allowAll: false };
  }
  const tokens = raw
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.includes("*") || tokens.includes("all")) {
    return { engagements: ALL_ENGAGEMENTS, allowAll: true };
  }
  return {
    engagements: ALL_ENGAGEMENTS.filter((e) => tokens.includes(e)),
    allowAll: false,
  };
}

export function isDocumentUploadAllowed(engagement: Engagement): boolean {
  const policy = getDocumentUploadPolicy();
  return policy.allowAll || policy.engagements.includes(engagement);
}

/**
 * Gate for the upload route. The message names no engagement, no env
 * var and no provider — a 403 here is a policy statement, not a hint
 * about how the deployment is configured — and it points the user at
 * the typed-description path that still works for them.
 */
export function assertDocumentUploadAllowed(engagement: Engagement): void {
  if (isDocumentUploadAllowed(engagement)) return;
  throw new HttpError(
    403,
    "document_upload_not_permitted",
    "Attaching documents isn't available for your account. Describe how you want to track this goal instead.",
  );
}
