/**
 * Type declarations for the allowlisted provider-query registry.
 *
 * Mirrors query-templates.js: the .js owns the templates, the validators and
 * the path builders; this file gives the API (TypeScript) the literal types.
 *
 * The template objects are deliberately typed WITHOUT their `github`/`gitlab`
 * binding functions on the public shape returned by `listQueryTemplates`.
 * Nothing outside the registry should be able to build a path — that is the
 * whole security posture of this module expressed in the type system.
 */

export const QUERY_PARAM_KINDS: readonly [
  "repo_slug",
  "file_path",
  "search_query",
  "label",
  "branch",
];
export type QueryParamKind = (typeof QUERY_PARAM_KINDS)[number];

export const QUERY_EXTRACTS: readonly ["exists", "count", "latest_date", "ratio"];
export type QueryExtract = (typeof QUERY_EXTRACTS)[number];

export const QUERY_SOURCE_PROVIDERS: readonly ["github", "gitlab", "ask"];
export type QuerySourceProvider = (typeof QUERY_SOURCE_PROVIDERS)[number];

/** A host a request can actually be built for. "ask" must resolve to one first. */
export type ConcreteQueryProvider = "github" | "gitlab";

/** The `source` block on a COMPOSED SpecField. */
export interface QuerySource {
  provider: QuerySourceProvider;
  /** Must be a key of QUERY_TEMPLATES. */
  query: string;
  /** Literal values, or the placeholder form `{{ctx:<questionId>}}`. */
  params: Record<string, string>;
  extract?: QueryExtract;
}

/** Same shape, after validateQuerySource — `extract` is always resolved. */
export interface NormalizedQuerySource extends QuerySource {
  extract: QueryExtract;
}

/** Resolution context: context answers for placeholders, plus an optional ref. */
export interface QueryBuildContext {
  answers?: Record<string, string>;
  /** GitLab file lookups default to HEAD (the project's default branch). */
  ref?: string;
}

export interface ProviderRequest {
  method: "GET";
  /** Relative to the provider's API root. Never a host, never leading "/". */
  path: string;
}

/** Registry entry as data — what prompts and pickers render. */
export interface QueryTemplateSummary {
  id: string;
  label: string;
  description: string;
  params: Record<string, QueryParamKind>;
  extracts: QueryExtract[];
  providers: ConcreteQueryProvider[];
}

export interface QueryTemplate extends QueryTemplateSummary {
  github?: (
    params: Record<string, string>,
    ctx?: QueryBuildContext,
  ) => { path: string };
  gitlab?: (
    params: Record<string, string>,
    ctx?: QueryBuildContext,
  ) => { path: string };
  describe: (params: Record<string, string>) => string;
}

export const QUERY_TEMPLATES: Readonly<Record<string, QueryTemplate>>;

export function getQueryTemplate(id: unknown): QueryTemplate | null;

export function listQueryTemplates(): QueryTemplateSummary[];

/**
 * Validate a field's `source`. Returns the normalised source, or null with the
 * reasons pushed onto `errors`. `path` prefixes those messages (e.g.
 * "fields[2].source").
 */
export function validateQuerySource(
  source: unknown,
  errors: string[],
  path?: string,
): NormalizedQuerySource | null;

/** One plain-English sentence for approval screens and field help. Never throws. */
export function describeQuerySource(source: unknown): string;

/**
 * Build the single relative request for a source against a resolved provider.
 * Throws QueryTemplateError on an unknown template, an unbound or mismatched
 * provider, a missing/invalid param (including a substituted context answer),
 * or an unsafe path.
 */
export function buildProviderRequest(
  source: QuerySource,
  provider: ConcreteQueryProvider,
  ctx?: QueryBuildContext,
): ProviderRequest;

/** Collapse a raw provider response into the primitive the field stores. */
export function extractQueryValue(
  extract: QueryExtract,
  provider: ConcreteQueryProvider,
  response: { status?: number; body?: unknown },
): boolean | number | string | null;

export function isContextPlaceholder(value: unknown): boolean;
export function contextPlaceholderId(value: unknown): string | null;
export function isValidQueryParam(kind: string, value: unknown): boolean;

export class QueryTemplateError extends Error {
  constructor(code: string, message: string);
  code: string;
}
