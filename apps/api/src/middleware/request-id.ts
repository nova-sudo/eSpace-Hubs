/**
 * Request ID middleware. Honours an inbound `x-request-id` if the
 * caller (load balancer, proxy, frontend) supplied one — otherwise
 * mints a fresh nanoid. Attaches it to:
 *
 *   - `req.id`            (used by pino-http for the `reqId` log field)
 *   - `res.setHeader`     (so clients can correlate)
 *
 * Cheap and useful — every log line gets a request-scoped id for free.
 */

import type { Request, Response, NextFunction } from "express";
import { nanoid } from "nanoid";

declare module "express-serve-static-core" {
  interface Request {
    id?: string;
  }
}

export function requestId(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const incoming = req.header("x-request-id");
  // Reject anything weird — IDs are echoed in headers, so don't trust
  // length or charset blindly.
  const safe =
    typeof incoming === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(incoming)
      ? incoming
      : nanoid(16);
  req.id = safe;
  res.setHeader("x-request-id", safe);
  next();
}
