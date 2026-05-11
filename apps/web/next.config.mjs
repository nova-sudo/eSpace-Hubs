import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// API service location. Defaults to localhost:4000 in dev. In prod the
// API is reverse-proxied at the same origin (no rewrite needed) — set
// NEXT_PUBLIC_API_URL only when frontend and API live on different
// origins.
const API_ORIGIN = process.env.API_ORIGIN || "http://localhost:4000";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin Turbopack's workspace root to the monorepo root so it ignores
  // any stray lockfile higher up the tree (e.g. a global one in the
  // user's home directory).
  turbopack: {
    root: path.join(__dirname, "..", ".."),
  },

  // Same-origin proxy so the browser sees /api/v1/* on :3000 alongside
  // its own pages. Keeps cookies SameSite-clean in dev and avoids any
  // CORS preflight on the happy path.
  //
  // The only Next.js route handler left is /api/oauth/github/exchange
  // (still server-side because it consumes GITHUB_CLIENT_SECRET). All
  // other legacy /api/* proxies (chat, classify-goals, grade-pr,
  // github/gitlab/jira) were retired in M7.9c — those flows now hit
  // the API service via /api/v1/* under this rewrite.
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: `${API_ORIGIN}/api/v1/:path*`,
      },
      // Health endpoints are unversioned — useful for hitting from the
      // dashboard during development.
      {
        source: "/api/healthz",
        destination: `${API_ORIGIN}/healthz`,
      },
      {
        source: "/api/readyz",
        destination: `${API_ORIGIN}/readyz`,
      },
    ];
  },
};

export default nextConfig;
