/**
 * Route guard: requires an authenticated session whose role grants ALL
 * of the given capabilities. 403 otherwise.
 *
 * Always pair with `requireAuth` (which establishes the session and
 * 401s when it's absent) — this guard only checks authorisation, so the
 * 401-vs-403 split stays correct.
 *
 * Resolution note: the session carries a single PRIMARY role
 * (`session.role`), not the full multi-role list — the same snapshot
 * `requireRole` reads. Capabilities are resolved from that primary role
 * via `resolveCapabilities([role])`. The capability-model migration
 * keeps the most operational role first (admin > manager > qa > dev >
 * …), so a manager's primary role is `manager` and this gate passes for
 * them. The one gap is a user whose primary role isn't the granting one
 * (e.g. an admin who is ALSO a manager); threading the full
 * `roles`/`capabilities` onto the session closes it and is tracked with
 * the M-CAP follow-up. Preferred over `requireRole` for new surfaces
 * because it gates on WHAT the user can do, not which role label they
 * happen to carry.
 */

import type { NextFunction, Request, Response } from "express";
import {
  resolveCapabilities,
  type Capability,
} from "@espace-devhub/shared/capabilities";
import { HttpError } from "./error-handler.js";

export function requireCapability(...required: Capability[]) {
  if (required.length === 0) {
    throw new Error(
      "requireCapability: at least one capability must be specified",
    );
  }
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.session) {
      // Defensive — `requireAuth` should run first. Treat as auth failure
      // to keep the 401-vs-403 contract simple.
      return next(new HttpError(401, "unauthenticated", "Login required."));
    }
    const held = resolveCapabilities([req.session.role]);
    const missing = required.filter((cap) => !held.has(cap));
    if (missing.length > 0) {
      return next(
        new HttpError(
          403,
          "forbidden",
          `Requires capability: ${required.join(", ")}.`,
        ),
      );
    }
    next();
  };
}
