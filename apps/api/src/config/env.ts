/**
 * Environment loader. Validates every variable at boot — if anything is
 * missing or malformed the process exits with a clear message instead
 * of failing later in a confusing place.
 *
 * Read order: .env.local → .env. Both live next to apps/api/package.json
 * and are gitignored. .env.example documents every key.
 */

import { config as loadDotenv } from "dotenv";
import { z } from "zod";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, "..", "..");

// .env.local overrides .env (matching Next.js convention so devs don't
// have to learn two patterns).
loadDotenv({ path: path.join(apiRoot, ".env"), quiet: true });
loadDotenv({
  path: path.join(apiRoot, ".env.local"),
  override: true,
  quiet: true,
});

const csv = z
  .string()
  .transform((s) =>
    s
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
  );

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(4000),

  // .default() in Zod v4 sets the OUTPUT default (post-transform) — pass
  // the array form, not the comma-separated string form.
  CORS_ALLOWED_ORIGINS: csv.default(["http://localhost:3000"]),

  MONGO_URI: z.string().min(1, "MONGO_URI is required"),
  MONGO_DB_NAME: z.string().min(1).default("devhub-dev"),

  SESSION_SECRET: z
    .string()
    .min(16, "SESSION_SECRET must be at least 16 chars (32+ in prod)"),
  INTEGRATION_TOKEN_KEY: z
    .string()
    .min(16, "INTEGRATION_TOKEN_KEY must be at least 16 chars"),

  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error(
      "[api] invalid environment — startup aborted:\n" +
        parsed.error.issues
          .map((i) => `  • ${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("\n"),
    );
    process.exit(1);
  }
  return parsed.data;
}

export const env: Env = loadEnv();

export const isProd = env.NODE_ENV === "production";
export const isDev = env.NODE_ENV === "development";
export const isTest = env.NODE_ENV === "test";
