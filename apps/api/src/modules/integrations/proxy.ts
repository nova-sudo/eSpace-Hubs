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
import { logger } from "../../lib/logger.js";
import { HttpError } from "../../middleware/error-handler.js";
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
  /** Builds the upstream URL from the captured rest-of-path + querystring. */
  buildUrl(args: { restPath: string; search: string; endpointUrl: string | null }): string;
  /** Builds the Authorization header (and any provider-specific extras). */
  buildHeaders(tokens: {
    accessToken: string | null;
    apiToken: string | null;
    email: string | null;
  }): Record<string, string>;
  /**
   * Validates that this provider has what it needs to proxy. Returns
   * an error message string if misconfigured, null if ready.
   */
  validate(tokens: {
    accessToken: string | null;
    apiToken: string | null;
    email: string | null;
    endpointUrl: string | null;
  }): string | null;
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

const JIRA: ProxyContext = {
  providerId: "jira",
  buildUrl: ({ restPath, search, endpointUrl }) => {
    const base = endpointUrl?.replace(/\/$/, "") ?? "";
    return `${base}/rest/api/3/${restPath}${search}`;
  },
  buildHeaders: ({ apiToken, email }) => {
    const basic = Buffer.from(`${email}:${apiToken}`).toString("base64");
    return {
      Authorization: `Basic ${basic}`,
      Accept: "application/json",
    };
  },
  validate: (t) => {
    if (!t.apiToken) return "Jira API token missing — reconnect required.";
    if (!t.email) return "Jira email missing on the integration.";
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

    const configError = ctx.validate(tokens);
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
      const msg = err instanceof Error ? err.message : String(err);
      void markIntegrationError({
        orgId: session.orgId,
        userId: session.userId,
        providerId: ctx.providerId,
        message: `Network: ${msg}`,
      });
      throw new HttpError(
        502,
        "integration_unreachable",
        `Network error reaching ${ctx.providerId}: ${msg}`,
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
