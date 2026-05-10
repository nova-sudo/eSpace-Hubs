/**
 * Pino logger. JSON in prod (so log forwarders can parse), pretty-printed
 * in dev. Vendor-agnostic — point stdout at whatever ships logs.
 */

import { pino, type Logger } from "pino";
import { env, isDev } from "../config/env.js";

export const logger: Logger = pino({
  level: env.LOG_LEVEL,
  base: { service: "espace-devhub-api" },
  // Redact common secret-bearing field names defensively. The service
  // shouldn't be logging these in the first place; this is belt-and-braces.
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      'req.headers["x-devhub-token"]',
      'req.headers["x-devhub-api-token"]',
      "*.password",
      "*.passwordHash",
      "*.token",
      "*.accessToken",
      "*.apiToken",
      "*.refreshToken",
    ],
    censor: "[redacted]",
  },
  ...(isDev
    ? {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss.l",
            ignore: "pid,hostname,service",
          },
        },
      }
    : {}),
});
