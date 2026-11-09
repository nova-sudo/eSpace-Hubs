/**
 * Session cookie helpers. Centralises the cookie name + flags so they
 * stay consistent everywhere — login, logout, the session middleware,
 * the admin "force logout" endpoint.
 *
 * Cookie shape:
 *   name: devhub_sid
 *   httpOnly: yes (blocks JS access — no XSS-readable token)
 *   sameSite: lax (allows top-level nav, blocks cross-site form posts)
 *   secure: yes in production, no in dev (we run dev over plain http)
 *   signed: yes (HMAC via the SESSION_SECRET env var)
 *   maxAge: matches session TTL — when the cookie expires, the server
 *           session would already be gone via Mongo TTL anyway
 *   path: "/" (visible to every endpoint)
 *
 * No `domain` attribute — defaults to the current host. When the hub
 * family ships (M10) and we want a session shared across
 * devhub.espace.test / leadhub.espace.test, we'll add
 * `domain: ".espace.test"` here.
 */

import type { CookieOptions, Request, Response } from "express";
import { isProd } from "../../config/env.js";
import { SESSION_TTL_MS } from "./session.js";

export const SESSION_COOKIE_NAME = "devhub_sid";

const baseOptions: CookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: isProd,
  signed: true,
  path: "/",
};

export function setSessionCookie(res: Response, sessionId: string): void {
  res.cookie(SESSION_COOKIE_NAME, sessionId, {
    ...baseOptions,
    maxAge: SESSION_TTL_MS,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, baseOptions);
}

// ─── trusted browser (skip TOTP for 30 days) ─────────────────────────

export const TRUSTED_COOKIE_NAME = "dh_trusted";
const TRUSTED_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function setTrustedCookie(res: Response, token: string): void {
  res.cookie(TRUSTED_COOKIE_NAME, token, {
    ...baseOptions,
    maxAge: TRUSTED_COOKIE_MAX_AGE_MS,
  });
}

export function clearTrustedCookie(res: Response): void {
  res.clearCookie(TRUSTED_COOKIE_NAME, baseOptions);
}

/** The signed `dh_trusted` value, or null when absent / tampered. */
export function readTrustedCookie(req: Request): string | null {
  const v = req.signedCookies?.[TRUSTED_COOKIE_NAME];
  return typeof v === "string" && v ? v : null;
}
