/**
 * Rate-limit middleware factories for the auth routes.
 *
 * Goal: protect the public auth endpoints from credential-stuffing,
 * email-enumeration spam, and brute-force attacks. Complements the
 * existing per-account lockout (5 failed logins → 15 min lockout in
 * the user document) — that handles account-level abuse; this layer
 * handles per-source (IP) abuse so an attacker sweeping many accounts
 * from a single host gets throttled before lockout even triggers.
 *
 * Storage: in-process memory store (the express-rate-limit default).
 * Trade-offs:
 *   - Cheap: zero infra, restart-safe (a restart wipes counters but
 *     a horizon of minutes is fine for the threat model).
 *   - Single-instance: counters don't share across processes. The
 *     API runs as one Node process today; when we go multi-instance
 *     we swap in a Redis store (`rate-limit-redis`) — that's a
 *     one-file change because the limiters all read from a single
 *     factory below.
 *
 * Error shape: when the limit triggers, the middleware throws an
 * HttpError(429, "rate_limited", …). That goes through the existing
 * error handler so the response matches the standard envelope. The
 * client gets RateLimit-* headers (RFC 9728 draft) so it can back
 * off gracefully.
 */

import rateLimit, { type Options } from "express-rate-limit";
import type { Request, Response, NextFunction } from "express";
import { HttpError } from "./error-handler.js";

interface LimiterConfig {
  /** Window length in ms. */
  windowMs: number;
  /** Max requests per window per key. */
  max: number;
  /** Identifier used in the error message ("login", "totp-verify", …). */
  label: string;
}

/**
 * Build a per-IP limiter that fits the rest of the API's error shape.
 * The handler synthesises an HttpError so the response envelope is
 * the standard `{ok:false, error:{code, message}}` — never the
 * default plain-text "Too many requests" from express-rate-limit.
 */
function buildLimiter(cfg: LimiterConfig) {
  const opts: Partial<Options> = {
    windowMs: cfg.windowMs,
    max: cfg.max,
    standardHeaders: "draft-7", // RateLimit-Policy, RateLimit, RateLimit-Reset
    legacyHeaders: false, // suppress X-RateLimit-* (redundant)
    skipSuccessfulRequests: false,
    // Express handles trust-proxy globally; use whatever it resolves
    // to as the rate-limit key. For the public auth endpoints that's
    // the client's IP — the only thing we have before authentication.
    keyGenerator: (req: Request) => req.ip ?? "unknown",
    handler: (_req: Request, _res: Response, next: NextFunction) => {
      next(
        new HttpError(
          429,
          "rate_limited",
          `Too many ${cfg.label} attempts. Wait a moment and try again.`,
        ),
      );
    },
  };
  return rateLimit(opts);
}

// ─── per-endpoint limiters ────────────────────────────────────────────
//
// Window + max values picked to be generous enough that a real user
// fat-fingering a password 4-5 times doesn't hit the limit, but tight
// enough that automated credential-stuffing burns out fast. Per-account
// lockout (in the user document) is the second layer; this is the
// per-IP layer.

/**
 * /login — 10 attempts per 5 minutes per IP. A user mistyping a few
 * times is fine; a stuffing tool gets 10 tries before a 5-minute pause.
 */
export const loginLimiter = buildLimiter({
  windowMs: 5 * 60 * 1000,
  max: 10,
  label: "login",
});

/**
 * /totp/verify — 10 attempts per 5 minutes per IP. Step 2 of two-step
 * login. TOTP codes are 6 digits → 10^6 space; 10/5min means a brute
 * force on a single 30s window is bounded to a tiny success probability.
 */
export const totpLimiter = buildLimiter({
  windowMs: 5 * 60 * 1000,
  max: 10,
  label: "TOTP-verify",
});

/**
 * /password/reset-request — 5 per hour per IP. The endpoint always
 * returns 200 regardless of whether the email is registered (no
 * enumeration), so the limit's job is to prevent email-spam abuse:
 * an attacker can't trigger 1000 reset emails per hour against a
 * victim's address.
 */
export const passwordResetRequestLimiter = buildLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  label: "password-reset-request",
});

/**
 * /password/reset — 10 per hour per IP. Token redemption. Tokens are
 * single-use and time-bounded; the limit just slows brute-force of
 * the token space (tokens are random 32-byte → cryptographically
 * infeasible to guess; the limiter is belt-and-suspenders).
 */
export const passwordResetLimiter = buildLimiter({
  windowMs: 60 * 60 * 1000,
  max: 10,
  label: "password-reset",
});

/**
 * /accept-invite — 20 per hour per IP. Same shape as password-reset
 * (token redemption). Window is more generous because legitimate
 * users sometimes click the link twice.
 */
export const inviteAcceptLimiter = buildLimiter({
  windowMs: 60 * 60 * 1000,
  max: 20,
  label: "invite-accept",
});
