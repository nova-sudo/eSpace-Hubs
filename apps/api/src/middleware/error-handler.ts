/**
 * Express error handler. Catches anything thrown or `next(err)`'d in a
 * route or middleware and shapes the response so callers always get a
 * predictable JSON envelope.
 *
 * Three response classes:
 *   - `HttpError` (intentional, status carried on the error)  → that status
 *   - `ZodError`  (validation failure)                        → 400
 *   - everything else                                          → 500 + log
 *
 * NEVER leaks stack traces or raw error.message to the client unless we
 * explicitly built that error as a `HttpError`. Surprises become 500s.
 */

import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { logger } from "../lib/logger.js";

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface ErrorResponse {
  error: {
    code: string;
    message: string;
    requestId: string | undefined;
    details?: unknown;
  };
}

export function notFoundHandler(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  next(new HttpError(404, "not_found", `route not found: ${req.method} ${req.path}`));
}

// Express 5 detects 4-arg signatures as error handlers. The unused
// `_next` is intentional — removing it would silently demote this to a
// regular middleware and break the chain.
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  let status = 500;
  let code = "internal_error";
  let message = "An unexpected error occurred.";
  let details: unknown;

  if (err instanceof HttpError) {
    status = err.status;
    code = err.code;
    message = err.message;
    details = err.details;
  } else if (err instanceof ZodError) {
    status = 400;
    code = "validation_error";
    message = "Request validation failed.";
    details = err.issues.map((i) => ({
      path: i.path,
      message: i.message,
      code: i.code,
    }));
  }

  const body: ErrorResponse = {
    error: {
      code,
      message,
      requestId: req.id,
      ...(details !== undefined ? { details } : {}),
    },
  };

  if (status >= 500) {
    logger.error({ err, reqId: req.id, path: req.path }, "[err] " + code);
  } else {
    logger.debug({ reqId: req.id, status, code }, "[err] handled");
  }

  res.status(status).json(body);
}
