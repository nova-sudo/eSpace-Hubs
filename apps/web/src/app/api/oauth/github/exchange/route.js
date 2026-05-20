/**
 * GitHub OAuth code → access-token exchange.
 *
 * Engagement-aware: the GitHub OAuth app's client_id + client_secret
 * are different per engagement (eSpace's app vs. Crealogix's app),
 * so this route resolves the user's engagement before picking the
 * env var.
 *
 * Resolution order:
 *   1. Forward the session cookie to the Express API's
 *      `/auth/me/engagement-config` to learn which engagement this
 *      user is on (and the matching public client_id).
 *   2. Read `<ENGAGEMENT>_GITHUB_CLIENT_SECRET` from this Next.js
 *      process's env vars — same process, so they're available.
 *   3. Fall back to the legacy `GITHUB_CLIENT_SECRET` env if the
 *      engagement-prefixed one isn't set (eases the cutover for
 *      deployments still on the old single-secret config).
 *
 * The Next.js process and the Express API both run on the same host
 * in the monorepo's dev setup; in prod they may be co-located or
 * sit behind a single domain. Either way the API base URL comes
 * from `INTERNAL_API_URL` (server-side env) when set, else falls
 * back to the public `NEXT_PUBLIC_API_URL` (which works in dev
 * because there's no DMZ).
 */

export const dynamic = "force-dynamic";

const DEFAULT_INTERNAL_API_URL =
  process.env.INTERNAL_API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:4000";

export async function POST(req) {
  const { code } = await req.json();
  if (!code) {
    return Response.json({ error: "Missing code" }, { status: 400 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    return Response.json(
      { error: "NEXT_PUBLIC_APP_URL not configured" },
      { status: 500 },
    );
  }

  // Resolve the user's engagement-config from the Express API. Pass
  // the cookie through so the API sees the same session this Next
  // route is running under.
  let engagement = "espace"; // default fallback
  let clientId = process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID || "";
  try {
    const r = await fetch(
      `${DEFAULT_INTERNAL_API_URL}/api/v1/auth/me/engagement-config`,
      {
        method: "GET",
        headers: {
          cookie: req.headers.get("cookie") || "",
        },
      },
    );
    if (r.ok) {
      const body = await r.json();
      if (body?.config?.engagement) {
        engagement = body.config.engagement;
      }
      if (body?.config?.githubClientId) {
        clientId = body.config.githubClientId;
      }
    }
  } catch {
    // Network issue talking to the internal API — fall through to
    // the env-baked defaults. The exchange may still succeed for
    // single-engagement deployments.
  }

  const prefix = String(engagement).toUpperCase();
  const clientSecret =
    process.env[`${prefix}_GITHUB_CLIENT_SECRET`] ||
    process.env.GITHUB_CLIENT_SECRET ||
    "";

  if (!clientId || !clientSecret) {
    return Response.json(
      {
        error:
          `GitHub OAuth not configured for engagement "${engagement}". ` +
          `Set ${prefix}_GITHUB_CLIENT_ID + ${prefix}_GITHUB_CLIENT_SECRET (or the legacy NEXT_PUBLIC_GITHUB_CLIENT_ID + GITHUB_CLIENT_SECRET).`,
      },
      { status: 500 },
    );
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: `${appUrl}/oauth/github`,
  });

  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });

  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}
