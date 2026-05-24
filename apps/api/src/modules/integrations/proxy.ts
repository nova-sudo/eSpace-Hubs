/**
 * Server-side proxy for GitHub / GitLab / Jira REST APIs.
 *
 * Why this lives on the API (not Next.js):
 *   - Tokens are encrypted at rest in `integrations` and only the
 *     server process can decrypt them. Sending tokens through the
 *     browser (the old Next.js proxy pattern) defeats the encryption.
 *   - lastUsedAt / lastErrorAt status fields update on every call;
 *     that's only sensible from a server-authoritative path.
 *
 * Auth: every proxy call requires a full session (TOTP-verified by
 * default). The proxy NEVER accepts tokens from the request — it
 * pulls them from the integrations row keyed on the session's user.
 *
 * Streaming: upstream's response body is piped through to the client
 * via Node's `Readable.fromWeb()`. No buffering — large list pages
 * (GitHub's repo lists, Jira's issue searches) pass through without
 * inflating memory.
 *
 * Header pass-through is allowlist-only. We forward content-type,
 * pagination, and rate-limit signals; we DROP set-cookie /
 * www-authenticate / server / etc. — the upstream's cookies aren't
 * ours to relay.
 *
 * IMPORTANT: We do NOT pass through `content-encoding` or
 * `content-length`. Node's fetch (undici) automatically decompresses
 * gzipped/brotli upstream responses before exposing `response.body`
 * to our code, so the bytes we stream to the client are already
 * plaintext. Forwarding the original `content-encoding: gzip` header
 * would tell the browser "decompress me" → browser tries to gunzip
 * plaintext JSON → fails. content-length is similarly stale because
 * the decompressed length differs from the on-the-wire compressed
 * length. Node sets `transfer-encoding: chunked` automatically when
 * we pipe a stream, which is the correct framing.
 *
 * Methods: GET + POST only, matching the localStorage-era Next.js
 * proxy. PUT/PATCH/DELETE aren't used by any current call site;
 * adding them later is a one-line change per route.
 */

import type { NextFunction, Request, Response } from "express";
import { Readable } from "node:stream";
import type { ObjectId } from "mongodb";
import { logger } from "../../lib/logger.js";
import { HttpError } from "../../middleware/error-handler.js";
import { getUsersCollection } from "../../db/collections.js";
import { DEFAULT_ENGAGEMENT, type Engagement } from "../../db/types.js";
import {
  loadDecryptedTokens,
  markIntegrationError,
  markIntegrationUsed,
} from "./controller.js";

/**
 * Headers we forward from upstream → client. Everything else is
 * dropped (defensive — never echo Set-Cookie, never leak Server).
 *
 * Deliberately NOT in this list:
 *   content-encoding / content-length — undici decompresses upstream
 *     gzipped responses before we see them. The bytes we stream to
 *     the client are plaintext; passing the original gzip header
 *     would tell the browser to decompress already-decompressed data
 *     and fail. Node's response sets transfer-encoding: chunked
 *     automatically when we pipe a stream.
 */
const PASSTHROUGH_RESPONSE_HEADERS = new Set([
  "content-type",
  "content-language",
  "etag",
  "last-modified",
  "link", // GitHub pagination
  "retry-after",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
  "x-ratelimit-resource",
  "x-ratelimit-used",
  "x-github-request-id",
  "x-gitlab-meta",
  "x-request-id",
  "x-runtime",
]);

interface ProxyContext {
  providerId: "github" | "gitlab" | "jira" | "jenkins";
  /**
   * Builds the upstream URL from the captured rest-of-path +
   * querystring. `engagement` lets a provider branch on the user's
   * engagement — the Jira proxy uses it to pick REST API v2 (Server
   * 8.x, espace) vs v3 (Cloud, crealogix).
   */
  buildUrl(args: {
    restPath: string;
    search: string;
    endpointUrl: string | null;
    engagement: Engagement;
  }): string;
  /** Builds the Authorization header (and any provider-specific extras). */
  buildHeaders(tokens: {
    accessToken: string | null;
    apiToken: string | null;
    email: string | null;
  }): Record<string, string>;
  /**
   * Validates that this provider has what it needs to proxy. Returns
   * an error message string if misconfigured, null if ready. The
   * `engagement` flag is passed so error wording can match the user's
   * mental model — eSpace users see "username/password," Crealogix
   * users see "email/API token."
   */
  validate(
    tokens: {
      accessToken: string | null;
      apiToken: string | null;
      email: string | null;
      endpointUrl: string | null;
    },
    engagement: Engagement,
  ): string | null;
}

const GITHUB: ProxyContext = {
  providerId: "github",
  buildUrl: ({ restPath, search }) =>
    `https://api.github.com/${restPath}${search}`,
  buildHeaders: ({ accessToken }) => ({
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "espace-devhub",
  }),
  validate: (t) =>
    t.accessToken ? null : "GitHub access token missing — reconnect required.",
};

const GITLAB: ProxyContext = {
  providerId: "gitlab",
  buildUrl: ({ restPath, search, endpointUrl }) => {
    const base = endpointUrl?.replace(/\/$/, "") ?? "";
    return `${base}/api/v4/${restPath}${search}`;
  },
  buildHeaders: ({ accessToken }) => ({
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
  }),
  validate: (t) => {
    if (!t.accessToken) return "GitLab access token missing — reconnect required.";
    if (!t.endpointUrl) return "GitLab endpoint URL not set on the integration.";
    return null;
  },
};

/**
 * Per-engagement path translation for Jira endpoints that have
 * different names between Server (v2) and Cloud (v3).
 *
 * The frontend uses Cloud-style paths uniformly (the active path
 * forward — Atlassian deprecated several v2-style names). For the
 * eSpace engagement (Jira Server 8.x), we map those back to the
 * names Server actually exposes.
 *
 * Add a row here whenever you discover a new Server-vs-Cloud
 * endpoint-name divergence. Common ones already covered below.
 *
 * Response shape differences are the caller's problem — for the
 * search endpoints used today, both shapes have an `issues` array
 * at the top level so the dashboard widgets work uniformly.
 */
function translateJiraPathForServer(restPath: string): string {
  // "search/jql" → "search" — Cloud's new endpoint vs Server's classic
  if (restPath === "search/jql") return "search";
  if (restPath.startsWith("search/jql?")) {
    return "search?" + restPath.slice("search/jql?".length);
  }
  // Future mappings live here. Keep them exact-match or
  // prefix-with-? to avoid catching unrelated subpaths.
  return restPath;
}

const JIRA: ProxyContext = {
  providerId: "jira",
  /**
   * Path version + endpoint-name both branch on engagement:
   *   - "espace"     → on-prem Jira Server 8.x: /rest/api/2/* + Server
   *                    endpoint names (e.g. `search`, not `search/jql`)
   *   - everything else → Jira Cloud-style /rest/api/3/*
   *
   * Field semantics on the integration row also differ:
   *   - eSpace      stores Server username (in `email`) + Server password (in `apiToken`)
   *   - Crealogix   stores Atlassian email (in `email`) + Atlassian API token (in `apiToken`)
   *
   * The Basic-auth wire format is identical (`<id>:<secret>` base64);
   * only the URL path + the user-facing labels differ.
   */
  buildUrl: ({ restPath, search, endpointUrl, engagement }) => {
    const base = endpointUrl?.replace(/\/$/, "") ?? "";
    const version = engagement === "espace" ? "2" : "3";
    const path =
      engagement === "espace"
        ? translateJiraPathForServer(restPath)
        : restPath;
    return `${base}/rest/api/${version}/${path}${search}`;
  },
  buildHeaders: ({ apiToken, email }) => {
    const basic = Buffer.from(`${email}:${apiToken}`).toString("base64");
    return {
      Authorization: `Basic ${basic}`,
      Accept: "application/json",
    };
  },
  validate: (t, engagement) => {
    const espace = engagement === "espace";
    if (!t.apiToken) {
      return espace
        ? "Jira password missing — reconnect required."
        : "Jira API token missing — reconnect required.";
    }
    if (!t.email) {
      return espace
        ? "Jira username missing on the integration."
        : "Jira email missing on the integration.";
    }
    if (!t.endpointUrl) return "Jira endpoint URL not set on the integration.";
    return null;
  },
};

/**
 * Jenkins proxy context.
 *
 * Jenkins exposes a REST API under the same host:port as its web UI.
 * Almost every resource has a `/api/json` suffix that returns the
 * machine-readable representation — e.g. `/job/foo/api/json`,
 * `/job/foo/lastBuild/api/json`, `/api/json` at the root for instance
 * metadata.
 *
 * Auth: Basic with `username:apiToken`. The API token is generated
 * per-user at `<jenkins>/me/configure → API Token → Add new Token`
 * and is revocable independently of the account password.
 *
 * Path shape unlike GitHub/GitLab/Jira there is no fixed REST
 * prefix — callers ship the full path including `api/json` (or
 * `wfapi/runs` for the Pipeline Stage View plugin, etc.). The
 * `buildUrl` here just joins endpointUrl + restPath verbatim so we
 * can target any Jenkins resource the user's plugins expose.
 *
 * We DO normalise `endpointUrl` by stripping any trailing slash so
 * `https://jenkins.example.com/` + `api/json` doesn't double-slash.
 *
 * `email` field on the integrations row is reused as the Jenkins
 * username (see JenkinsTokenForm) — the schema's `email` validator
 * was relaxed for non-Jira providers in M6.2.
 *
 * Tree parameter: many Jenkins responses are huge (recursive job
 * listings, build history with all parameters). The api-client passes
 * `?tree=...` selectors to keep responses focused. The proxy doesn't
 * inject these — it just relays whatever the client requested.
 */
const JENKINS: ProxyContext = {
  providerId: "jenkins",
  buildUrl: ({ restPath, search, endpointUrl }) => {
    const base = endpointUrl?.replace(/\/$/, "") ?? "";
    return `${base}/${restPath}${search}`;
  },
  buildHeaders: ({ apiToken, email }) => {
    const basic = Buffer.from(`${email}:${apiToken}`).toString("base64");
    return {
      Authorization: `Basic ${basic}`,
      Accept: "application/json",
    };
  },
  validate: (t) => {
    if (!t.apiToken) return "Jenkins API token missing — reconnect required.";
    if (!t.email) return "Jenkins username missing on the integration.";
    if (!t.endpointUrl) return "Jenkins URL not set on the integration.";
    return null;
  },
};

// ─── shared proxy core ───────────────────────────────────────────────

async function runProxy(
  ctx: ProxyContext,
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }

    const tokens = await loadDecryptedTokens({
      orgId: session.orgId,
      userId: session.userId,
      providerId: ctx.providerId,
    });
    if (!tokens) {
      throw new HttpError(
        401,
        "integration_not_connected",
        `Not connected to ${ctx.providerId}. Connect this provider in settings.`,
      );
    }

    // Resolve the user's engagement once per proxy call. Jira uses it
    // to pick REST v2 (Server 8.x) vs v3 (Cloud); other providers
    // accept the arg + ignore it. Falls back to DEFAULT_ENGAGEMENT
    // for legacy users that pre-date the engagement field.
    const engagement = await getUserEngagement(session.userId);

    const configError = ctx.validate(tokens, engagement);
    if (configError) {
      throw new HttpError(401, "integration_misconfigured", configError);
    }

    // req.params[0] holds the captured rest-of-path from /github/*
    // (Express 4 splat-param convention).
    const restPath = (req.params as Record<string, string>)["0"] ?? "";
    const search = req.originalUrl.includes("?")
      ? `?${req.originalUrl.split("?", 2)[1] ?? ""}`
      : "";

    const targetUrl = ctx.buildUrl({
      restPath,
      search,
      endpointUrl: tokens.endpointUrl,
      engagement,
    });

    const upstreamHeaders: Record<string, string> = {
      ...ctx.buildHeaders({
        accessToken: tokens.accessToken,
        apiToken: tokens.apiToken,
        email: tokens.email,
      }),
    };

    // Forward request content-type when the caller is POSTing JSON.
    // We DON'T forward the raw req body — Express already parsed it
    // via the JSON middleware. Re-serialise for upstream.
    let body: string | undefined;
    if (req.method === "POST") {
      upstreamHeaders["Content-Type"] = "application/json";
      body = JSON.stringify(req.body ?? {});
    }

    let upstream;
    try {
      upstream = await fetch(targetUrl, {
        method: req.method,
        headers: upstreamHeaders,
        ...(body !== undefined ? { body } : {}),
      });
    } catch (err) {
      // Node's undici-backed fetch throws a generic `TypeError: fetch
      // failed` for every network-layer failure — the actual cause
      // (ENOTFOUND, ECONNREFUSED, UND_ERR_CONNECT_TIMEOUT, TLS chain
      // errors, etc.) lives on `err.cause`. We pull it out so the
      // error envelope and the integration's `lastError` field show
      // something operators can act on instead of the useless
      // "fetch failed" string.
      const baseMsg = err instanceof Error ? err.message : String(err);
      const cause = (err as { cause?: unknown }).cause;
      const causeMsg =
        cause instanceof Error
          ? cause.message
          : cause && typeof cause === "object"
          ? // Undici causes are typically `{ code, message }` shaped.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ((cause as any).code ?? (cause as any).message ?? "")
          : "";
      const detail = causeMsg ? `${baseMsg} (${causeMsg})` : baseMsg;
      // Log the FULL exception for ops — the response message keeps
      // it concise but Pino captures the structured error.
      logger.warn(
        {
          err,
          providerId: ctx.providerId,
          targetUrl,
          reqId: req.id,
        },
        "[proxy] upstream fetch failed",
      );
      void markIntegrationError({
        orgId: session.orgId,
        userId: session.userId,
        providerId: ctx.providerId,
        message: `Network: ${detail}`,
      });
      throw new HttpError(
        502,
        "integration_unreachable",
        `Network error reaching ${ctx.providerId}: ${detail}`,
      );
    }

    // Allowlist response headers — drop everything else.
    upstream.headers.forEach((value, key) => {
      if (PASSTHROUGH_RESPONSE_HEADERS.has(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });
    res.status(upstream.status);

    // Update integration status — fire-and-forget. If upstream returned
    // a 4xx/5xx, record the status so the UI can decide whether to
    // prompt for reconnect (401/403) or just retry.
    if (upstream.status >= 400) {
      void markIntegrationError({
        orgId: session.orgId,
        userId: session.userId,
        providerId: ctx.providerId,
        message: `${ctx.providerId} ${upstream.status}`,
      });
    } else {
      void markIntegrationUsed({
        orgId: session.orgId,
        userId: session.userId,
        providerId: ctx.providerId,
      });
    }

    // Stream the body. WHATWG ReadableStream → Node Readable. Once
    // headers flush we OWN the response and shouldn't call next(err);
    // stream errors set res.errored which the pino-http access log
    // captures.
    if (upstream.body) {
      Readable.fromWeb(upstream.body).pipe(res);
    } else {
      res.end();
    }
  } catch (err) {
    if (!res.headersSent) {
      next(err);
    } else {
      // Mid-stream — already wrote headers, log and end.
      logger.error(
        {
          err: err instanceof Error ? err.message : String(err),
          reqId: req.id,
        },
        "[proxy] mid-stream error",
      );
      if (!res.writableEnded) res.end();
    }
  }
}

// ─── helpers ─────────────────────────────────────────────────────────

/**
 * Resolve the user's engagement for a proxy call. Read-only, single
 * lookup — every proxy route already does a Mongo round-trip for the
 * tokens, one more is acceptable per request.
 *
 * Falls back to DEFAULT_ENGAGEMENT for users created before the field
 * existed.
 */
async function getUserEngagement(userId: ObjectId): Promise<Engagement> {
  try {
    const users = await getUsersCollection();
    const u = await users.findOne(
      { _id: userId },
      { projection: { engagement: 1 } },
    );
    return (u?.engagement ?? DEFAULT_ENGAGEMENT) as Engagement;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "[proxy] engagement lookup failed — defaulting",
    );
    return DEFAULT_ENGAGEMENT;
  }
}

// ─── route handlers (one per provider) ───────────────────────────────

export function githubProxyHandler(req: Request, res: Response, next: NextFunction) {
  return runProxy(GITHUB, req, res, next);
}

export function gitlabProxyHandler(req: Request, res: Response, next: NextFunction) {
  return runProxy(GITLAB, req, res, next);
}

export function jiraProxyHandler(req: Request, res: Response, next: NextFunction) {
  return runProxy(JIRA, req, res, next);
}

export function jenkinsProxyHandler(req: Request, res: Response, next: NextFunction) {
  return runProxy(JENKINS, req, res, next);
}
