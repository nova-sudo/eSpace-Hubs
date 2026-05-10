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

import type { CookieOptions, Response } from "express";
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
