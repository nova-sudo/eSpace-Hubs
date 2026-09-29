/**
 * User-facing copy for AI failures (pure).
 *
 * The API answers a missing AI key with code `ai_provider_unconfigured`
 * and a plain sentence. Older deployments (and a few in-band stream
 * failures) still carry the operator message, which names env vars — never
 * show those to a user; they can't act on them. Anything that looks like
 * config talk maps to the one sentence below.
 */

export const AI_UNCONFIGURED_COPY =
  "AI isn't configured for this workspace — ask your admin. You can still set this goal up by hand.";

const CONFIG_TALK = /_API_KEY|\bAPI env\b|\.env\b|env\.local|no API key|has no credentials|and restart/i;

/** Friendly message for an AI error `{ code?, message? }` or a string. */
export function aiErrorMessage(err, fallback = "The AI couldn't finish. Try again.") {
  const code = typeof err === "object" && err ? err.code : null;
  const message =
    typeof err === "string" ? err : typeof err?.message === "string" ? err.message : "";
  if (code === "ai_provider_unconfigured" || CONFIG_TALK.test(message)) {
    return AI_UNCONFIGURED_COPY;
  }
  return message || fallback;
}
