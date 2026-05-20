import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// API service location.
//
// When `API_ORIGIN` is set (e.g. local dev with `apps/api` running on
// :4000, or a deployment where the API is a separate host like Railway),
// requests to `/api/v1/*` get rewritten to that origin.
//
// When unset (default on Vercel deploys), the rewrite is skipped and
// the catch-all serverless function at
// `apps/web/src/pages/api/v1/[...path].ts` handles `/api/v1/*` in-
// process by forwarding to the Express app via the
// `@espace-devhub/api/serverless` barrel. This lets the entire backend
// ship inside the Next.js deploy on Vercel.
const API_ORIGIN = process.env.API_ORIGIN;

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin Turbopack's workspace root to the monorepo root so it ignores
  // any stray lockfile higher up the tree (e.g. a global one in the
  // user's home directory).
  turbopack: {
    root: path.join(__dirname, "..", ".."),
  },

  // Transpile the API workspace package — its dist/*.js is ESM with
  // `.js` import suffixes (NodeNext output). Next's default bundler
  // assumes node_modules deps are already-transpiled CommonJS or modern
  // ESM without the explicit `.js` extensions; listing it here makes
  // Turbopack/webpack run it through the standard transpile pipeline
  // so the serverless catch-all can import from it.
  transpilePackages: ["@espace-devhub/api", "@espace-devhub/shared"],

  async rewrites() {
    // Local dev / external-API mode: forward /api/v1/* to the
    // configured origin so the file-based catch-all is bypassed.
    // `beforeFiles` ensures the rewrite runs BEFORE Next's
    // file-based route matching — without that, the catch-all
    // serverless function would always win and we'd never hit the
    // standalone Express server.
    if (!API_ORIGIN) return [];
    return {
      beforeFiles: [
        {
          source: "/api/v1/:path*",
          destination: `${API_ORIGIN}/api/v1/:path*`,
        },
        {
          source: "/api/healthz",
          destination: `${API_ORIGIN}/healthz`,
        },
        {
          source: "/api/readyz",
          destination: `${API_ORIGIN}/readyz`,
        },
      ],
    };
  },
};

export default nextConfig;
