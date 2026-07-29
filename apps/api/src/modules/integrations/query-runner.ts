/**
 * Server-side executor for COMPOSED source fields — the security
 * envelope around "this tracker field is read from GitHub/GitLab
 * instead of typed".
 *
 * Why this file exists at all: the thing that CHOOSES a query is an AI
 * whose input includes documents users upload. If that text could pick
 * a URL, we would have built a confused deputy that makes authenticated
 * calls with the user's real token. So the AI never writes a path — it
 * names an allowlisted template id and fills declared params, and this
 * module is the only place that turns that into an outbound request.
 * Everything here is written on the assumption that `source` is
 * attacker-influenced.
 *
 * The gates, in order, and why each one is not redundant:
 *   1. Template lookup — an id that is not in the registry is a forgery,
 *      not a typo. Reject before anything else touches it.
 *   2. Placeholder substitution, then RE-validation. A param validated
 *      when the spec was written tells us nothing about the answer a
 *      user pasted into the context question afterwards.
 *   3. Method pinned to GET in this file, ignoring whatever the template
 *      says. A template that grows a POST binding must not be able to
 *      turn a read into a write by accident.
 *   4. Path shape (no scheme, no leading slash, no "..", no CR/LF) plus
 *      a final same-origin assertion. The template builds the path; the
 *      base URL comes from server-side engagement config and nothing
 *      else, so origin equality is the property that must hold.
 *
 * Token handling reuses the encrypted-token path the proxy uses
 * (`loadDecryptedTokens` in ./controller.ts) — same decrypt boundary,
 * same integration status bookkeeping, tokens never leave the process.
 * We do NOT go through `runProxy` itself: that helper is an Express
 * handler that streams an upstream body straight at a client response,
 * and this path must do the opposite — read the body, reduce it to a
 * single primitive, and never let the raw upstream shape out.
 *
 * The template registry lives in @espace-devhub/shared/goal-specs and is
 * loaded lazily through a narrow structural interface. That indirection
 * buys two things: tests can inject a hostile registry to prove the
 * gates below hold on their own, and this module keeps compiling while
 * the shared registry lands alongside it.
 */

import type { ObjectId } from "mongodb";
import { logger } from "../../lib/logger.js";
import { HttpError } from "../../middleware/error-handler.js";
import { getEngagementConfig } from "../../lib/engagement-config.js";
import type { ContextAnswer, Engagement } from "../../db/types.js";
import {
  loadDecryptedTokens,
  markIntegrationError,
  markIntegrationUsed,
} from "./controller.js";

// ─── contract ────────────────────────────────────────────────────────

export type QueryProvider = "github" | "gitlab";
export type QuerySourceProvider = QueryProvider | "ask";
export type QueryExtract = "exists" | "count" | "ratio" | "latest_date";

export interface QuerySource {
  provider: QuerySourceProvider;
  query: string;
  params: Record<string, string>;
  extract?: QueryExtract;
}

export interface ResolveQueryContext {
  userId: ObjectId;
  orgId: ObjectId;
  engagement: Engagement;
  /** The user's answers to `spec.context.questions` — user input. */
  contextAnswers: Record<string, ContextAnswer>;
}

export interface ResolvedQuery {
  value: boolean | number | string | null;
  extract: QueryExtract;
  fetchedAt: string;
  describe: string;
  provider: QueryProvider;
}

/** Raw upstream response, seen ONLY by extractors inside this module. */
export interface RawProviderResponse {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

/**
 * The slice of @espace-devhub/shared/goal-specs this module depends on.
 * Declared structurally so a test can hand in a deliberately permissive
 * registry: every gate below has to hold without the registry's help.
 */
export interface QueryTemplateDescriptor {
  id: string;
  label?: string;
  description?: string;
  params?: Record<string, string>;
  extracts?: readonly string[];
  /** Optional per-extract override when a generic reducer can't work. */
  extractors?: Record<string, (raw: RawProviderResponse) => unknown>;
  github?: unknown;
  gitlab?: unknown;
}

export interface QueryTemplateRegistry {
  getQueryTemplate(id: string): QueryTemplateDescriptor | null;
  validateQuerySource(source: unknown, errors: string[]): QuerySource | null;
  describeQuerySource(source: unknown): string;
  buildProviderRequest(
    source: QuerySource,
    provider: QueryProvider,
    ctx: Record<string, unknown>,
  ): { method?: string; path: string };
}

export interface QueryRunnerDeps {
  registry?: QueryTemplateRegistry;
  fetchImpl?: typeof fetch;
  loadTokens?: typeof loadDecryptedTokens;
  /** Integration status bookkeeping — injected by tests so a unit run
   *  never opens a database handle. */
  markUsed?: typeof markIntegrationUsed;
  markError?: typeof markIntegrationError;
}

// ─── registry loading ────────────────────────────────────────────────

/**
 * Loaded through a dynamic import (and cached) rather than a static one
 * so a registry that is missing or half-shipped degrades to a clean 503
 * instead of crashing the process at boot — every other integrations
 * route stays up.
 */
let registryPromise: Promise<QueryTemplateRegistry> | null = null;

async function loadRegistry(): Promise<QueryTemplateRegistry> {
  if (!registryPromise) {
    registryPromise = import("@espace-devhub/shared/goal-specs").then(
      (mod) => mod as unknown as QueryTemplateRegistry,
    );
  }
  const registry = await registryPromise;
  const complete =
    typeof registry?.getQueryTemplate === "function" &&
    typeof registry?.validateQuerySource === "function" &&
    typeof registry?.buildProviderRequest === "function";
  if (!complete) {
    throw new HttpError(
      503,
      "query_templates_unavailable",
      "Auto-filled fields are not available on this deployment yet.",
    );
  }
  return registry;
}

// ─── param substitution ──────────────────────────────────────────────

/**
 * `{{ctx:<questionId>}}` — the ONLY dynamic form a param may take. It is
 * matched anchored and whole-value on purpose: a partial/interpolated
 * form ("repos/{{ctx:x}}-thing") would let a template param carry
 * structure that neither validator ever sees as one unit.
 */
// Must stay NO LOOSER than the shared registry's copy in query-templates.js.
// This is the layer that decides "this string is an indirection — go read a
// user's answer", so accepting an id the allowlist would refuse means the
// tightest validator is not the one making the decision. Kept identical to the
// registry's grammar deliberately: [A-Za-z0-9_-]{1,64}, no dot.
const CTX_PLACEHOLDER_RE = /^\{\{ctx:([A-Za-z0-9_-]{1,64})\}\}$/;

const MAX_PARAM_LENGTH = 500;

/**
 * True for anything at or below U+0020, plus DEL. Written as a code-point
 * scan rather than a regex because CR/LF are the whole point — a newline
 * that survives into a concatenated URL is a request-splitting primitive,
 * and an escaped control-character class is exactly the kind of thing that
 * gets "tidied" by a later reformat without anyone noticing.
 */
function hasControlOrSpace(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Shape checks applied to a SUBSTITUTED answer before it is handed back
 * to the registry's own paramKind validation. Deliberately duplicated
 * defence: the answer is raw user input that arrived long after the spec
 * was validated, and a permissive registry must not be the only thing
 * standing between it and a URL.
 */
function assertAnswerShape(raw: string, questionId: string): void {
  const bad =
    raw.length === 0 ||
    raw.length > MAX_PARAM_LENGTH ||
    hasControlOrSpace(raw) ||
    raw.includes("://") ||
    raw.includes("..") ||
    raw.startsWith("/") ||
    raw.startsWith("\\") ||
    raw.includes("@") ||
    /%2e%2e/i.test(raw);
  if (bad) {
    throw new HttpError(
      400,
      "context_answer_rejected",
      `The answer to "${questionId}" isn't a valid value for this field. Enter a plain name or path.`,
    );
  }
}

function coerceAnswer(value: ContextAnswer, questionId: string): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value) && value.length === 1 && typeof value[0] === "string") {
    return value[0].trim();
  }
  throw new HttpError(
    400,
    "context_answer_missing",
    `Answer the setup question "${questionId}" to fill this field.`,
  );
}

function substituteParams(
  params: Record<string, string>,
  answers: Record<string, ContextAnswer>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(params ?? {})) {
    if (typeof value !== "string") {
      throw new HttpError(
        400,
        "query_source_invalid",
        "This field's query parameters are malformed.",
      );
    }
    const match = CTX_PLACEHOLDER_RE.exec(value);
    if (!match) {
      out[name] = value;
      continue;
    }
    const questionId = match[1] as string;
    const answer = coerceAnswer(answers?.[questionId] ?? null, questionId);
    assertAnswerShape(answer, questionId);
    out[name] = answer;
  }
  return out;
}

// ─── provider resolution ─────────────────────────────────────────────

/**
 * `provider: "ask"` means the composer collected the host from the user
 * rather than guessing. We read that answer back out of the context map
 * (any answer that is literally a provider name), and only if there is
 * no such answer do we fall back to "the user has exactly one provider
 * connected". Two connected providers and no answer is a genuine
 * ambiguity — 409 rather than a coin flip, because picking the wrong
 * host silently produces a plausible-but-wrong number.
 */
function providerFromAnswers(
  answers: Record<string, ContextAnswer>,
): QueryProvider | null {
  const found = new Set<QueryProvider>();
  for (const value of Object.values(answers ?? {})) {
    const text = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (text === "github" || text === "gitlab") found.add(text);
  }
  return found.size === 1 ? ([...found][0] as QueryProvider) : null;
}

async function connectedToken(
  provider: QueryProvider,
  ctx: ResolveQueryContext,
  loadTokens: typeof loadDecryptedTokens,
): Promise<string | null> {
  const tokens = await loadTokens({
    orgId: ctx.orgId,
    userId: ctx.userId,
    providerId: provider,
  });
  return tokens?.accessToken ?? null;
}

async function resolveProvider(
  source: QuerySource,
  ctx: ResolveQueryContext,
  loadTokens: typeof loadDecryptedTokens,
): Promise<{ provider: QueryProvider; accessToken: string }> {
  const candidates: QueryProvider[] =
    source.provider === "ask"
      ? (() => {
          const answered = providerFromAnswers(ctx.contextAnswers);
          return answered ? [answered] : ["github", "gitlab"];
        })()
      : [source.provider];

  const connected: Array<{ provider: QueryProvider; accessToken: string }> = [];
  for (const provider of candidates) {
    const accessToken = await connectedToken(provider, ctx, loadTokens);
    if (accessToken) connected.push({ provider, accessToken });
  }

  if (connected.length === 1) return connected[0]!;
  if (connected.length === 0) {
    const wanted = candidates.join(" or ");
    throw new HttpError(
      400,
      "integration_not_connected",
      `Connect ${wanted} in settings before this field can fill itself.`,
    );
  }
  throw new HttpError(
    409,
    "query_provider_ambiguous",
    "Both GitHub and GitLab are connected — answer the setup question that picks one.",
  );
}

// ─── URL construction ────────────────────────────────────────────────

/**
 * The base ALWAYS comes from server-side engagement config; nothing in
 * the spec, the params, or the integration row's own endpointUrl can
 * influence it. GitHub's REST root is a constant (the engagement only
 * contributes the org, which reaches the template as ctx), so there is
 * no env var to read for it.
 */
function resolveBaseUrl(provider: QueryProvider, engagement: Engagement): string {
  if (provider === "github") return "https://api.github.com";
  const cfg = getEngagementConfig(engagement);
  const raw = cfg.gitlabBaseUrl?.trim();
  if (!raw) {
    throw new HttpError(
      503,
      "engagement_misconfigured",
      "GitLab isn't configured for this engagement. Ask an admin to set it up.",
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new HttpError(
      503,
      "engagement_misconfigured",
      "GitLab isn't configured correctly for this engagement.",
    );
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new HttpError(
      503,
      "engagement_misconfigured",
      "GitLab isn't configured correctly for this engagement.",
    );
  }
  return `${raw.replace(/\/+$/, "")}/api/v4`;
}

const MAX_PATH_LENGTH = 2_000;

/**
 * Everything a template-built path is NOT allowed to be. A leading "/"
 * is rejected along with the rest because "//evil.example" appended to a
 * base is a protocol-relative URL — the single most dangerous shape
 * here, and the reason the same-origin assertion below exists as well.
 */
function assertSafePath(path: unknown): string {
  const invalid = (): never => {
    throw new HttpError(
      400,
      "query_path_rejected",
      "This field's query could not be built safely.",
    );
  };
  if (typeof path !== "string" || path.length === 0) invalid();
  const p = path as string;
  if (p.length > MAX_PATH_LENGTH) invalid();
  if (hasControlOrSpace(p)) invalid();
  if (p.startsWith("/") || p.startsWith("\\")) invalid();
  if (p.includes("://") || p.includes("#")) invalid();
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(p)) invalid();
  const [pathname = ""] = p.split("?", 1);
  if (pathname.includes("..") || /%2e%2e/i.test(pathname)) invalid();
  return p;
}

function joinUrl(base: string, path: string): string {
  const url = `${base.replace(/\/+$/, "")}/${path}`;
  // Final assertion: whatever the template produced, the request must
  // still be aimed at the origin engagement config chose.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new HttpError(
      400,
      "query_path_rejected",
      "This field's query could not be built safely.",
    );
  }
  if (parsed.origin !== new URL(base).origin) {
    throw new HttpError(
      400,
      "query_path_rejected",
      "This field's query could not be built safely.",
    );
  }
  return parsed.toString();
}

// ─── extraction ──────────────────────────────────────────────────────

const DATE_FIELDS = [
  "committed_date",
  "authored_date",
  "created_at",
  "updated_at",
  "pushed_at",
];

function firstRecord(body: unknown): Record<string, unknown> | null {
  if (Array.isArray(body)) {
    const head = body[0];
    return head && typeof head === "object" ? (head as Record<string, unknown>) : null;
  }
  return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
}

function extractLatestDate(body: unknown): string | null {
  const rec = firstRecord(body);
  if (!rec) return null;
  // GitHub's commits payload nests the timestamp; GitLab's is flat.
  const commit = rec["commit"] as Record<string, unknown> | undefined;
  const nested = (commit?.["committer"] ?? commit?.["author"]) as
    | Record<string, unknown>
    | undefined;
  const candidates = [nested?.["date"], ...DATE_FIELDS.map((f) => rec[f])];
  for (const c of candidates) {
    if (typeof c === "string" && !Number.isNaN(Date.parse(c))) {
      return new Date(c).toISOString();
    }
  }
  return null;
}

function extractCount(raw: RawProviderResponse): number | null {
  const { body, headers } = raw;
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const rec = body as Record<string, unknown>;
    for (const key of ["total_count", "count", "total"]) {
      if (typeof rec[key] === "number") return rec[key] as number;
    }
  }
  if (Array.isArray(body)) {
    // GitLab reports the true total in a header; the body is one page.
    const header = headers["x-total"];
    const total = header ? Number.parseInt(header, 10) : Number.NaN;
    return Number.isFinite(total) ? total : body.length;
  }
  return null;
}

function extractRatio(body: unknown): number | null {
  const rec = firstRecord(body);
  if (!rec) return null;
  const num = rec["numerator"] ?? rec["matching"];
  const den = rec["denominator"] ?? rec["total"] ?? rec["total_count"];
  if (typeof num !== "number" || typeof den !== "number" || den <= 0) return null;
  return num / den;
}

/**
 * Reduce an upstream response to ONE primitive. The raw body stops here
 * — it is never returned, logged, or echoed. A template may override a
 * single extract kind when the generic reducer can't express its shape.
 */
function applyExtract(
  extract: QueryExtract,
  raw: RawProviderResponse,
  template: QueryTemplateDescriptor,
): boolean | number | string | null {
  const custom = template.extractors?.[extract];
  if (typeof custom === "function") {
    const value = custom(raw);
    if (
      value === null ||
      typeof value === "boolean" ||
      typeof value === "number" ||
      typeof value === "string"
    ) {
      return value;
    }
    return null;
  }
  switch (extract) {
    case "exists":
      return raw.status < 400;
    case "count":
      return extractCount(raw);
    case "ratio":
      return extractRatio(raw.body);
    case "latest_date":
      return extractLatestDate(raw.body);
    default:
      return null;
  }
}

// ─── execution ───────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 20_000;
const MAX_BODY_BYTES = 2_000_000;

function providerHeaders(
  provider: QueryProvider,
  accessToken: string,
): Record<string, string> {
  if (provider === "github") {
    return {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "espace-devhub",
    };
  }
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
  };
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length > MAX_BODY_BYTES || text.length === 0) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Resolve ONE source field to a primitive.
 *
 * Throws HttpError for every failure mode the user can act on
 * (reconnect, answer a question, fix the engagement config) and never
 * surfaces an upstream body, header set, or token.
 */
export async function resolveQuery(
  source: unknown,
  ctx: ResolveQueryContext,
  deps: QueryRunnerDeps = {},
): Promise<ResolvedQuery> {
  const registry = deps.registry ?? (await loadRegistry());
  const doFetch = deps.fetchImpl ?? fetch;
  const loadTokens = deps.loadTokens ?? loadDecryptedTokens;
  const markUsed = deps.markUsed ?? markIntegrationUsed;
  const markError = deps.markError ?? markIntegrationError;
  const startedAt = Date.now();

  // Gate 1 — the allowlist. An unknown id is a forgery; nothing about
  // it gets validated, substituted, or logged as a path.
  const requestedId =
    source && typeof source === "object"
      ? (source as { query?: unknown }).query
      : undefined;
  if (typeof requestedId !== "string" || !registry.getQueryTemplate(requestedId)) {
    throw new HttpError(
      400,
      "query_template_unknown",
      "This field points at a data source that no longer exists.",
    );
  }
  const template = registry.getQueryTemplate(requestedId)!;

  const specErrors: string[] = [];
  const normalized = registry.validateQuerySource(source, specErrors);
  if (!normalized) {
    throw new HttpError(
      400,
      "query_source_invalid",
      "This field's data source is not valid.",
    );
  }

  // Gate 2 — substitute, then re-validate the SUBSTITUTED source. A
  // param that passed validation when the spec was written says nothing
  // about the answer typed into the context question afterwards.
  const substituted: QuerySource = {
    ...normalized,
    params: substituteParams(normalized.params, ctx.contextAnswers),
  };
  const runtimeErrors: string[] = [];
  const revalidated = registry.validateQuerySource(substituted, runtimeErrors);
  if (!revalidated) {
    throw new HttpError(
      400,
      "context_answer_rejected",
      "Your answer to this tracker's setup question isn't usable here.",
    );
  }

  const { provider, accessToken } = await resolveProvider(
    revalidated,
    ctx,
    loadTokens,
  );
  if (!template[provider]) {
    throw new HttpError(
      400,
      "query_provider_unsupported",
      `This check can't be run against ${provider}.`,
    );
  }

  const extract = (revalidated.extract ?? "exists") as QueryExtract;
  if (template.extracts && !template.extracts.includes(extract)) {
    throw new HttpError(
      400,
      "query_extract_unsupported",
      "This field asks for a reading this check can't produce.",
    );
  }

  // The registry throws QueryTemplateError — a plain Error, not an HttpError —
  // so left uncaught it reaches errorHandler as an unexpected exception and
  // becomes a 500 with a stack in the logs. Every one of those throws is
  // actually a user-fixable input: a repo slug the template can't express
  // (validateRepoSlug allows the 2-3 segments GitLab nested groups need, while
  // the GitHub binding requires exactly owner/name), a param that didn't
  // resolve, a path that failed its shape check. They are 400s with the
  // sentence the registry already wrote, and any authenticated user can trigger
  // one on demand — so leaking a 500 for it is both wrong and noisy.
  let built: { method?: string; path?: string };
  try {
    built = registry.buildProviderRequest(revalidated, provider, {
      engagement: ctx.engagement,
      githubOrg: getEngagementConfig(ctx.engagement).githubOrg ?? null,
    });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    const code =
      typeof (err as { code?: unknown })?.code === "string"
        ? (err as { code: string }).code
        : "query_unbuildable";
    throw new HttpError(
      400,
      code,
      err instanceof Error && err.message
        ? err.message
        : "This field's data source can't be resolved as written.",
    );
  }

  // Gate 3 — GET, always. A template that grows a write binding must not
  // be able to turn a read into a write by returning a different verb.
  if (built?.method && built.method.toUpperCase() !== "GET") {
    throw new HttpError(
      400,
      "query_method_rejected",
      "This field's data source is not valid.",
    );
  }
  // Gate 4 — path shape, then same-origin against the engagement base.
  const path = assertSafePath(built?.path);
  const url = joinUrl(resolveBaseUrl(provider, ctx.engagement), path);

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await doFetch(url, {
      method: "GET",
      headers: providerHeaders(provider, accessToken),
      signal: abort.signal,
    });
  } catch (err) {
    logOutcome(template.id, provider, startedAt, "network_error");
    void markError({
      orgId: ctx.orgId,
      userId: ctx.userId,
      providerId: provider,
      message: `query-field: ${err instanceof Error ? err.name : "network"}`,
    });
    throw new HttpError(
      502,
      "integration_unreachable",
      `Couldn't reach ${provider} to fill this field. Try again shortly.`,
    );
  } finally {
    clearTimeout(timer);
  }

  const status = response.status;

  if (status === 401 || status === 403) {
    logOutcome(template.id, provider, startedAt, "auth_failed");
    void markError({
      orgId: ctx.orgId,
      userId: ctx.userId,
      providerId: provider,
      message: `query-field ${provider} ${status}`,
    });
    throw new HttpError(
      401,
      "integration_needs_reconnect",
      `Your ${provider} connection was rejected. Reconnect it in settings.`,
    );
  }

  // A 404 is an ANSWER for existence-shaped checks: "the file isn't
  // there" is exactly what the field is asking. Only counting/ratio
  // checks treat it as a broken target.
  if (status === 404) {
    if (extract === "exists" || extract === "latest_date") {
      logOutcome(template.id, provider, startedAt, "not_found_as_value");
      return {
        value: extract === "exists" ? false : null,
        extract,
        fetchedAt: new Date().toISOString(),
        describe: safeDescribe(registry, revalidated),
        provider,
      };
    }
    logOutcome(template.id, provider, startedAt, "target_missing");
    throw new HttpError(
      404,
      "query_target_missing",
      "The repository this field points at wasn't found. Check the setup answer.",
    );
  }

  if (status >= 400) {
    logOutcome(template.id, provider, startedAt, `upstream_${status}`);
    void markError({
      orgId: ctx.orgId,
      userId: ctx.userId,
      providerId: provider,
      message: `query-field ${provider} ${status}`,
    });
    throw new HttpError(
      502,
      "query_upstream_error",
      `${provider} returned an error while filling this field. Try again shortly.`,
    );
  }

  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  const body = extract === "exists" ? null : await readJson(response);
  const value = applyExtract(extract, { status, body, headers }, template);

  void markUsed({
    orgId: ctx.orgId,
    userId: ctx.userId,
    providerId: provider,
  });
  logOutcome(template.id, provider, startedAt, "ok");

  return {
    value,
    extract,
    fetchedAt: new Date().toISOString(),
    describe: safeDescribe(registry, revalidated),
    provider,
  };
}

/**
 * The sentence shown next to an auto-filled value ("whether AGENTS.md
 * exists in …"). A registry that throws here must not fail the whole
 * resolution — the number is the point, the caption is decoration.
 */
function safeDescribe(
  registry: QueryTemplateRegistry,
  source: QuerySource,
): string {
  try {
    const text = registry.describeQuerySource?.(source);
    return typeof text === "string" && text.trim() ? text.trim() : "";
  } catch {
    return "";
  }
}

/**
 * Metadata only. A repo slug is customer data and a response body may be
 * source code, so neither ever reaches the log — template id, provider,
 * duration and outcome are enough to debug quota and latency.
 */
function logOutcome(
  templateId: string,
  provider: QueryProvider,
  startedAt: number,
  outcome: string,
): void {
  logger.info(
    { templateId, provider, durationMs: Date.now() - startedAt, outcome },
    "[query-runner] field resolved",
  );
}
