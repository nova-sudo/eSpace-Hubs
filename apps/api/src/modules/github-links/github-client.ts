/**
 * The ONE place the API writes to GitHub. The integrations proxy
 * (modules/integrations/proxy.ts) stays a read-only bridge; every
 * create/label/comment call for published issues goes through this client, with
 * the token decrypted server-side by the caller and never leaving the
 * process.
 *
 * Fixed, hand-written paths only. `repo` and issue numbers are validated
 * here again (defence in depth over schemas.ts) and every path segment is
 * URL-encoded, so nothing unvalidated is ever interpolated.
 *
 * Error contract (never echoes an upstream body, header set, or token):
 *   rate limit (detectUpstreamRateLimit) → 429 rate_limited + retryAfterMs
 *   401 / 403                            → 401 integration_needs_reconnect
 *   404 / 410                            → 404 github_target_missing
 *   anything else ≥ 400, network, size   → 502 github_upstream_error
 */

import { HttpError } from "../../middleware/error-handler.js";
import { detectUpstreamRateLimit } from "../integrations/query-runner.js";
import { REPO_RE } from "./schemas.js";

export const GITHUB_API_BASE = "https://api.github.com";
const FETCH_TIMEOUT_MS = 20_000;
const MAX_BODY_BYTES = 2_000_000;
const PER_PAGE = 100;
const MAX_LIST_ITEMS = 300;

// ─── upstream shapes (the slice we read) ─────────────────────────────

export interface GithubIssue {
  id: number;
  node_id: string;
  number: number;
  html_url: string;
  title: string;
  body: string | null;
  state: "open" | "closed";
  state_reason?: string | null;
  closed_at?: string | null;
  updated_at?: string | null;
  labels?: Array<{ name?: string } | string>;
  assignees?: Array<{ login?: string }>;
  comments?: number;
  /** Present when the "issue" is actually a pull request. */
  pull_request?: unknown;
}

export interface GithubClient {
  /**
   * Make sure a label exists. Resolves true when it exists or was created,
   * false when GitHub refused (no push access, repo missing, name rejected)
   * — a missing label is cosmetic, never a reason to abort a publish.
   * Still throws on rate limits and genuine token rejections.
   */
  ensureLabel(
    repo: string,
    label: { name: string; color: string; description?: string },
  ): Promise<boolean>;
  /**
   * Create an issue. When GitHub rejects the request with a 422 and labels
   * were sent, retries ONCE without labels and reports `labelsApplied:false`.
   */
  createIssue(
    repo: string,
    input: { title: string; body: string; labels: string[] },
  ): Promise<{ issue: GithubIssue; labelsApplied: boolean }>;
  getIssue(repo: string, number: number): Promise<GithubIssue>;
  /** Issues carrying ALL of `labels`, any state, ≤ 300 (pull requests dropped). */
  listIssuesByLabels(
    repo: string,
    labels: string[],
    opts?: { state?: "all" | "open" | "closed" },
  ): Promise<GithubIssue[]>;
  /** One page (≤ 100) of the issue timeline, oldest first. */
  listTimeline(repo: string, number: number): Promise<unknown[]>;
  /**
   * One page (≤ 100) of issue comments, oldest first. GitHub's per-issue
   * comments endpoint has no sort/direction, so a caller that wants the
   * NEWEST comments asks for the last page (`page`, derived from the
   * issue's comment count) and keeps its tail.
   */
  listComments(repo: string, number: number, opts?: { page?: number }): Promise<unknown[]>;
  getPull(repo: string, number: number): Promise<unknown>;
  /** Post a comment on an issue. Resolves the created comment's id + url. */
  createComment(
    repo: string,
    number: number,
    body: string,
  ): Promise<{ id: number; html_url: string }>;
}

export interface GithubClientOptions {
  token: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

// ─── validation ──────────────────────────────────────────────────────

function repoSegments(repo: string): [string, string] {
  if (typeof repo !== "string" || !REPO_RE.test(repo) || repo.includes("..")) {
    throw new HttpError(400, "github_repo_invalid", "Repository must be owner/name.");
  }
  const [owner, name] = repo.split("/") as [string, string];
  if (owner === "." || name === ".") {
    throw new HttpError(400, "github_repo_invalid", "Repository must be owner/name.");
  }
  return [encodeURIComponent(owner), encodeURIComponent(name)];
}

function issueNumber(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 999_999_999) {
    throw new HttpError(400, "github_issue_invalid", "Issue number is invalid.");
  }
  return String(n);
}

function labelName(name: string): string {
  // GitHub labels: ≤ 50 chars, no control characters.
  const s = typeof name === "string" ? name.trim() : "";
  if (!s || s.length > 50 || /[\u0000-\u001f\u007f]/.test(s)) {
    throw new HttpError(400, "github_label_invalid", "Label name is invalid.");
  }
  return s;
}

// ─── transport ───────────────────────────────────────────────────────

interface UpstreamResult {
  status: number;
  body: unknown;
  rateLimit: { retryAfterMs: number } | null;
}

function upstreamError(status: number): HttpError {
  if (status === 401 || status === 403) {
    return new HttpError(
      401,
      "integration_needs_reconnect",
      "GitHub rejected the request. Reconnect GitHub in settings and check your access to the repository.",
    );
  }
  if (status === 404 || status === 410) {
    return new HttpError(
      404,
      "github_target_missing",
      "That repository or issue wasn't found on GitHub (or issues are disabled for it).",
    );
  }
  return new HttpError(
    502,
    "github_upstream_error",
    "GitHub returned an error. Try again shortly.",
  );
}

function rateLimitError(retryAfterMs: number): HttpError {
  return new HttpError(
    429,
    "rate_limited",
    "GitHub is rate-limiting requests right now. Try again once the limit resets.",
    { provider: "github", upstream: true },
    retryAfterMs,
  );
}

export function createGithubClient(opts: GithubClientOptions): GithubClient {
  const token = typeof opts.token === "string" ? opts.token.trim() : "";
  if (!token) {
    throw new HttpError(
      400,
      "integration_not_connected",
      "Connect GitHub in settings before publishing.",
    );
  }
  const doFetch = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;

  const headers = (): Record<string, string> => ({
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "espace-devhub",
  });

  /**
   * One request. Resolves for every HTTP status (the caller decides what
   * a 422 or 404 means for ITS operation); throws only for transport
   * failures, which are laundered into a constant-message 502 so no
   * header (and so no token) can ride along in an error.
   */
  async function request(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<UpstreamResult> {
    const url = `${GITHUB_API_BASE}/${path}`;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await doFetch(url, {
        method,
        headers: {
          ...headers(),
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: abort.signal,
      });
    } catch {
      throw new HttpError(
        502,
        "github_upstream_error",
        "Couldn't reach GitHub. Try again shortly.",
      );
    } finally {
      clearTimeout(timer);
    }

    const rateLimit = await detectUpstreamRateLimit(response, now());
    let parsed: unknown = null;
    try {
      const text = await response.text();
      if (text.length > MAX_BODY_BYTES) {
        throw new HttpError(
          502,
          "github_upstream_error",
          "GitHub returned more data than expected.",
        );
      }
      parsed = text.length ? JSON.parse(text) : null;
    } catch (err) {
      if (err instanceof HttpError) throw err;
      parsed = null;
    }
    return { status: response.status, body: parsed, rateLimit };
  }

  /** Throw the mapped error for a non-2xx result. */
  function assertOk(r: UpstreamResult): void {
    if (r.rateLimit) throw rateLimitError(r.rateLimit.retryAfterMs);
    if (r.status >= 200 && r.status < 300) return;
    throw upstreamError(r.status);
  }

  function hasErrorCode(body: unknown, code: string): boolean {
    const errors = (body as { errors?: unknown } | null)?.errors;
    return (
      Array.isArray(errors) &&
      errors.some((e) => (e as { code?: unknown })?.code === code)
    );
  }

  async function ensureLabel(
    repo: string,
    label: { name: string; color: string; description?: string },
  ): Promise<boolean> {
    const [o, r] = repoSegments(repo);
    const name = labelName(label.name);
    const color = /^[0-9a-fA-F]{6}$/.test(label.color) ? label.color : "ededed";
    const res = await request("POST", `repos/${o}/${r}/labels`, {
      name,
      color,
      ...(label.description ? { description: label.description.slice(0, 100) } : {}),
    });
    if (res.rateLimit) throw rateLimitError(res.rateLimit.retryAfterMs);
    if (res.status === 201) return true;
    if (res.status === 422 && hasErrorCode(res.body, "already_exists")) return true;
    if (res.status === 401) throw upstreamError(401);
    // 403 (no push access), 404 (no repo / no access), other 422 (name
    // rejected): the issue can still be created — just without labels.
    if (res.status === 403 || res.status === 404 || res.status === 422) return false;
    throw upstreamError(res.status);
  }

  function asIssue(body: unknown): GithubIssue {
    const b = body as GithubIssue | null;
    if (
      !b ||
      typeof b !== "object" ||
      !Number.isInteger(b.number) ||
      typeof b.html_url !== "string"
    ) {
      throw new HttpError(
        502,
        "github_upstream_error",
        "GitHub returned an unexpected response.",
      );
    }
    return b;
  }

  async function createIssue(
    repo: string,
    input: { title: string; body: string; labels: string[] },
  ): Promise<{ issue: GithubIssue; labelsApplied: boolean }> {
    const [o, r] = repoSegments(repo);
    const labels = input.labels.map(labelName);
    const payload = {
      title: input.title.slice(0, 256),
      body: input.body.slice(0, 65_000),
      ...(labels.length ? { labels } : {}),
    };
    let res = await request("POST", `repos/${o}/${r}/issues`, payload);
    let labelsApplied = labels.length > 0;
    if (res.status === 422 && labels.length > 0 && !res.rateLimit) {
      // Labels refused (no push access reports as a validation failure on
      // the label field). The issue itself is still wanted.
      const { labels: _dropped, ...withoutLabels } = payload;
      void _dropped;
      res = await request("POST", `repos/${o}/${r}/issues`, withoutLabels);
      labelsApplied = false;
    }
    assertOk(res);
    return { issue: asIssue(res.body), labelsApplied };
  }

  async function getIssue(repo: string, number: number): Promise<GithubIssue> {
    const [o, r] = repoSegments(repo);
    const n = issueNumber(number);
    const res = await request("GET", `repos/${o}/${r}/issues/${n}`);
    assertOk(res);
    return asIssue(res.body);
  }

  async function listIssuesByLabels(
    repo: string,
    labels: string[],
    listOpts: { state?: "all" | "open" | "closed" } = {},
  ): Promise<GithubIssue[]> {
    const [o, r] = repoSegments(repo);
    const names = labels.map(labelName);
    if (names.length === 0) return [];
    const state = listOpts.state ?? "all";
    const out: GithubIssue[] = [];
    for (let page = 1; page <= Math.ceil(MAX_LIST_ITEMS / PER_PAGE); page += 1) {
      const qs =
        `labels=${encodeURIComponent(names.join(","))}` +
        `&state=${state}&per_page=${PER_PAGE}&page=${page}`;
      const res = await request("GET", `repos/${o}/${r}/issues?${qs}`);
      assertOk(res);
      const items = Array.isArray(res.body) ? (res.body as GithubIssue[]) : [];
      for (const item of items) {
        if (item && typeof item === "object" && !item.pull_request) out.push(item);
      }
      if (items.length < PER_PAGE || out.length >= MAX_LIST_ITEMS) break;
    }
    return out.slice(0, MAX_LIST_ITEMS);
  }

  async function listTimeline(repo: string, number: number): Promise<unknown[]> {
    const [o, r] = repoSegments(repo);
    const n = issueNumber(number);
    const res = await request(
      "GET",
      `repos/${o}/${r}/issues/${n}/timeline?per_page=${PER_PAGE}`,
    );
    assertOk(res);
    return Array.isArray(res.body) ? res.body : [];
  }

  async function listComments(
    repo: string,
    number: number,
    listOpts: { page?: number } = {},
  ): Promise<unknown[]> {
    const [o, r] = repoSegments(repo);
    const n = issueNumber(number);
    const page =
      Number.isInteger(listOpts.page) && (listOpts.page as number) > 1
        ? Math.min(listOpts.page as number, 10_000)
        : 1;
    const res = await request(
      "GET",
      `repos/${o}/${r}/issues/${n}/comments?per_page=${PER_PAGE}${page > 1 ? `&page=${page}` : ""}`,
    );
    assertOk(res);
    return Array.isArray(res.body) ? res.body : [];
  }

  async function createComment(
    repo: string,
    number: number,
    body: string,
  ): Promise<{ id: number; html_url: string }> {
    const [o, r] = repoSegments(repo);
    const n = issueNumber(number);
    const text = typeof body === "string" ? body.slice(0, 65_000) : "";
    if (!text.trim()) {
      throw new HttpError(400, "github_comment_empty", "There's nothing to post.");
    }
    const res = await request("POST", `repos/${o}/${r}/issues/${n}/comments`, { body: text });
    assertOk(res);
    const b = res.body as { id?: unknown; html_url?: unknown } | null;
    if (!b || !Number.isInteger(b.id) || typeof b.html_url !== "string") {
      throw new HttpError(
        502,
        "github_upstream_error",
        "GitHub returned an unexpected response.",
      );
    }
    return { id: b.id as number, html_url: b.html_url };
  }

  async function getPull(repo: string, number: number): Promise<unknown> {
    const [o, r] = repoSegments(repo);
    const n = issueNumber(number);
    const res = await request("GET", `repos/${o}/${r}/pulls/${n}`);
    assertOk(res);
    return res.body;
  }

  return {
    ensureLabel,
    createIssue,
    getIssue,
    listIssuesByLabels,
    listTimeline,
    listComments,
    getPull,
    createComment,
  };
}
