/**
 * Allowlisted provider queries for COMPOSED fields that read themselves.
 *
 * A "build your own" tracker can now contain a field the tools already know the
 * answer to — "AGENTS.md exists in the repo", "how many PRs carry the `spec`
 * label" — instead of a number the user retypes every week. That is only safe
 * because of the rule this file exists to enforce:
 *
 *   THE AI NEVER WRITES A URL. It picks a template by id and fills declared
 *   parameters; the server owns every character of the resulting path.
 *
 * The composer's input includes documents users upload. If injectable text could
 * choose a path we would have built a confused deputy that makes authenticated
 * calls with the user's real GitHub/GitLab token — note the existing proxy
 * (apps/api integrations/proxy.ts) forwards GET *and POST* with no path
 * allowlist, safe only while hand-written code builds the paths. So a spec may
 * only ever say "template X with these params", and the untrusted surface
 * narrows from "any URL" to "a bounded string that must survive a strict
 * per-kind validator, twice".
 *
 * Twice, because a param may be the placeholder `{{ctx:<questionId>}}` resolved
 * from a user's answer at execution time. The form is validated when the spec is
 * written and the SUBSTITUTED value is validated again when the request is
 * built. A value is never trusted because it passed once, in another process,
 * possibly months ago.
 *
 * Provider-agnostic by construction: one template id binds to BOTH hosts, so
 * "must work for GitHub and GitLab" is satisfied structurally rather than by
 * branching at every call site. A template that genuinely cannot be expressed on
 * one host says so by omitting that binding, and validateQuerySource refuses a
 * source pinned to a provider its template lacks.
 *
 * What this file deliberately does NOT do: no IO, no host names, no tokens.
 * buildProviderRequest returns a RELATIVE path; the API base URL comes from
 * server-side engagement config and the token from the encrypted proxy path.
 *
 * No deps. Pure functions. Safe in any environment.
 */

/**
 * Parameter kinds. Each one owns a validator below — the kind is the whole
 * security contract for a param, so adding a kind means adding a validator that
 * rejects rather than coerces.
 */
export const QUERY_PARAM_KINDS = Object.freeze([
  "repo_slug",
  "file_path",
  "search_query",
  "label",
  "branch",
]);

/**
 * How a raw provider response collapses to a primitive the grader can read.
 *
 *   exists      — 200 vs 404
 *   count       — `total_count` (GitHub search) or array length (GitLab lists)
 *   latest_date — ISO date of the newest matching commit
 *   ratio       — numerator/denominator, where the TEMPLATE defines both
 *
 * `ratio` is part of the vocabulary because the field contract declares it, but
 * no shipped template claims it: a ratio needs two upstream calls and
 * buildProviderRequest returns exactly one request by design. The honest way to
 * express ">80% of medium stories have a spec" today is two count fields on the
 * same COMPOSED widget with the target on the derived field — the widget, not
 * the template, does the division. A future two-request template would need a
 * contract change here, not a quiet second fetch.
 */
export const QUERY_EXTRACTS = Object.freeze([
  "exists",
  "count",
  "latest_date",
  "ratio",
]);

/**
 * Providers a field source may name. "ask" means the composer collected a
 * context question and the answer decides — used when the user has both hosts
 * connected, where guessing would silently measure the wrong repo.
 */
export const QUERY_SOURCE_PROVIDERS = Object.freeze(["github", "gitlab", "ask"]);

/** Hosts a request can actually be built for. "ask" must resolve to one first. */
const CONCRETE_PROVIDERS = Object.freeze(["github", "gitlab"]);

const PROVIDER_LABELS = Object.freeze({ github: "GitHub", gitlab: "GitLab" });

/**
 * Thrown by buildProviderRequest. Carries a machine code so the API can map it
 * onto an HttpError without string-matching, and a message safe to show a user —
 * it never contains an upstream body, a token, or a host.
 */
export class QueryTemplateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "QueryTemplateError";
    this.code = code;
  }
}

// ─── param validators ────────────────────────────────────────────────
//
// Every validator is a HARD REJECT. Nothing sanitises, strips or coerces:
// a value that "almost" passes is a value someone constructed on purpose, and
// silently repairing it is how allowlists turn into suggestions.

const MAX_REPO_SLUG = 120;
const MAX_FILE_PATH = 200;
const MAX_FILE_SEGMENTS = 12;
const MAX_SEARCH_QUERY = 120;
const MAX_LABEL = 60;
const MAX_BRANCH = 120;

/** `{{ctx:questionId}}` — the only indirection a param may carry. */
const CTX_PLACEHOLDER_RE = /^\{\{ctx:([A-Za-z0-9_-]{1,64})\}\}$/;

/**
 * Null byte, newlines, and every other C0/C1 control character.
 *
 * A code-point scan rather than a regex character class: the class needs
 * control escapes, and an escape that survives every editor and transport in
 * this repo is not something worth betting a security check on.
 */
function hasControlChars(value) {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

function isPlainString(v) {
  return typeof v === "string" && v.length > 0;
}

/**
 * Checks that hold for EVERY kind, so no individual validator can forget one.
 *
 * The `//` rule is what kills "https://evil.example" and the protocol-relative
 * "//evil.example" for all five kinds at once — including `search_query`, whose
 * charset has to keep ":" because that IS GitHub's search syntax (`is:pr`,
 * `label:spec`) and so cannot exclude schemes by charset alone.
 */
function passesUniversalChecks(value) {
  if (!isPlainString(value)) return false;
  if (hasControlChars(value)) return false;
  if (value.includes("//")) return false;
  return true;
}

/** One path/slug segment: no traversal, no emptiness, bounded charset. */
function isSafeSegment(segment, { allowSpace = false } = {}) {
  if (segment.length === 0 || segment.length > 100) return false;
  if (segment === "." || segment === "..") return false;
  const re = allowSpace
    ? /^[A-Za-z0-9._][A-Za-z0-9._\- ]*$/
    : /^[A-Za-z0-9._][A-Za-z0-9._-]*$/;
  return re.test(segment);
}

/**
 * "owner/name" — or "group/subgroup/project", because self-hosted GitLab
 * nests groups and refusing that would make half of eSpace's repos
 * unrepresentable. Depth is capped at three and every segment still has to
 * survive isSafeSegment, so the extra level buys expressiveness without
 * loosening the charset. GitHub's binding narrows this back to exactly two —
 * a nested slug is not a GitHub repo.
 */
function validateRepoSlug(value) {
  if (!passesUniversalChecks(value)) return false;
  if (value.length > MAX_REPO_SLUG) return false;
  if (value.startsWith("/") || value.endsWith("/")) return false;
  const segments = value.split("/");
  if (segments.length < 2 || segments.length > 3) return false;
  return segments.every((s) => isSafeSegment(s));
}

/**
 * A repo-relative file path. Leading "/" is refused rather than trimmed: an
 * absolute path means the caller was thinking about a filesystem, and we would
 * rather fail loudly than guess what they meant.
 */
function validateFilePath(value) {
  if (!passesUniversalChecks(value)) return false;
  if (value.length > MAX_FILE_PATH) return false;
  if (value.startsWith("/") || value.endsWith("/")) return false;
  if (value.includes("\\")) return false;
  const segments = value.split("/");
  if (segments.length > MAX_FILE_SEGMENTS) return false;
  return segments.every((s) => isSafeSegment(s, { allowSpace: true }));
}

/**
 * A search fragment we drop into a provider's `q`/`search` parameter. It is
 * URL-encoded before it reaches a URL, so the charset is about keeping the
 * query legible and auditable rather than about escaping: no separators
 * (`&`, `?`, `%`, `;`) that would read as URL structure if an encoding step
 * were ever removed, and no newlines that would make a logged query lie about
 * how many lines it is.
 */
function validateSearchQuery(value) {
  if (!passesUniversalChecks(value)) return false;
  if (value.length > MAX_SEARCH_QUERY) return false;
  return /^[A-Za-z0-9 ._\-:/+#@'"=<>*,()]+$/.test(value);
}

function validateLabel(value) {
  if (!passesUniversalChecks(value)) return false;
  if (value.length > MAX_LABEL) return false;
  // "type::bug", "needs review", "area/api" are all real label shapes.
  return /^[A-Za-z0-9][A-Za-z0-9 ._\-:/]*$/.test(value);
}

function validateBranch(value) {
  if (!passesUniversalChecks(value)) return false;
  if (value.length > MAX_BRANCH) return false;
  if (value.startsWith("/") || value.endsWith("/") || value.startsWith("-")) {
    return false;
  }
  const segments = value.split("/");
  return segments.every((s) => isSafeSegment(s));
}

const PARAM_VALIDATORS = Object.freeze({
  repo_slug: validateRepoSlug,
  file_path: validateFilePath,
  search_query: validateSearchQuery,
  label: validateLabel,
  branch: validateBranch,
});

/** True when a param defers to a context answer instead of carrying a literal. */
export function isContextPlaceholder(value) {
  return typeof value === "string" && CTX_PLACEHOLDER_RE.test(value);
}

/** The questionId a placeholder points at, or null. */
export function contextPlaceholderId(value) {
  const m = typeof value === "string" ? CTX_PLACEHOLDER_RE.exec(value) : null;
  return m ? m[1] : null;
}

/**
 * Validate one param value against its kind. The placeholder form is accepted
 * here and re-checked — as a literal — after substitution in
 * buildProviderRequest. Passing this once is explicitly NOT a licence to skip
 * the second check.
 */
export function isValidQueryParam(kind, value) {
  const validator = PARAM_VALIDATORS[kind];
  if (!validator) return false;
  if (isContextPlaceholder(value)) return true;
  return validator(value);
}

// ─── path helpers ────────────────────────────────────────────────────

const enc = encodeURIComponent;

/** GitHub keeps slashes structural, so segments are encoded individually. */
function githubRepo(repo) {
  const segments = repo.split("/");
  if (segments.length !== 2) {
    throw new QueryTemplateError(
      "unsupported_repo",
      "GitHub repositories are owner/name — a nested group path only exists on GitLab.",
    );
  }
  return segments.map(enc).join("/");
}

function githubPath(path) {
  return path.split("/").map(enc).join("/");
}

/** GitLab takes the project and the file path as single encoded segments. */
function gitlabProject(repo) {
  return enc(repo);
}

/**
 * Last line of defence, applied to whatever a template produced. If a template
 * is ever edited into emitting an absolute path, a scheme or a traversal, the
 * request dies here rather than at a provider's front door.
 */
function assertSafePath(path) {
  if (typeof path !== "string" || path.length === 0) {
    throw new QueryTemplateError("bad_path", "Query template produced no path.");
  }
  if (path.startsWith("/") || path.startsWith("\\")) {
    throw new QueryTemplateError("bad_path", "Query path must be relative.");
  }
  if (path.includes("//")) {
    throw new QueryTemplateError("bad_path", "Query path must not contain a host.");
  }
  if (hasControlChars(path) || /\s/.test(path)) {
    throw new QueryTemplateError(
      "bad_path",
      "Query path must not contain whitespace or control characters.",
    );
  }
  // Traversal is only meaningful in the path itself. The query string is
  // allowed ".." because GitHub's own date-range syntax uses it
  // ("created:2026-01-01..2026-02-01"), and a range in a `q=` value cannot
  // climb anything.
  const [route] = path.split("?", 1);
  if (route.includes("..") || route.includes(":")) {
    throw new QueryTemplateError(
      "bad_path",
      "Query path must not traverse or name a scheme.",
    );
  }
  return path;
}

// ─── the registry ────────────────────────────────────────────────────
//
// Keep this list SHORT. Every entry is permanent attack surface: once a
// template ships, any spec in Mongo may name it. Add one only when a real goal
// cannot be measured without it, and only when both bindings are obviously
// correct.

/**
 * GitLab's REST list endpoints answer with a page of records, not a body-level
 * total (the count lives in an `X-Total` header the proxy does not forward), so
 * "count" on GitLab means "records on one max-size page". 100 is GitLab's
 * ceiling. A goal whose honest answer exceeds 100 open MRs is not a goal being
 * tracked, so the cap is a bound, not a bug — but it IS a lie above 100 and
 * should be surfaced as "100+" wherever it is rendered.
 */
const GITLAB_COUNT_PAGE = 100;

export const QUERY_TEMPLATES = Object.freeze({
  repo_file_exists: Object.freeze({
    id: "repo_file_exists",
    label: "File exists in repo",
    description:
      "Checks whether a file is present at a path in a repository — the honest form of “we have a stable AGENTS.md”.",
    params: Object.freeze({ repo: "repo_slug", path: "file_path" }),
    extracts: Object.freeze(["exists"]),
    github: ({ repo, path }) => ({
      path: `repos/${githubRepo(repo)}/contents/${githubPath(path)}`,
    }),
    // ref=HEAD asks GitLab for the project's default branch without us having
    // to know its name; a spec may pin one via ctx.ref when it matters.
    gitlab: ({ repo, path }, ctx) => ({
      path: `projects/${gitlabProject(repo)}/repository/files/${enc(path)}?ref=${enc(
        ctx?.ref || "HEAD",
      )}`,
    }),
    describe: ({ repo, path }) => `Checks that ${path} exists in ${repo}`,
  }),

  repo_file_updated: Object.freeze({
    id: "repo_file_updated",
    label: "File last updated",
    description:
      "Date of the most recent commit touching a path — “stable” means maintained, not merely present.",
    params: Object.freeze({ repo: "repo_slug", path: "file_path" }),
    extracts: Object.freeze(["latest_date"]),
    github: ({ repo, path }) => ({
      path: `repos/${githubRepo(repo)}/commits?path=${enc(path)}&per_page=1`,
    }),
    gitlab: ({ repo, path }) => ({
      path: `projects/${gitlabProject(repo)}/repository/commits?path=${enc(
        path,
      )}&per_page=1`,
    }),
    describe: ({ repo, path }) =>
      `Reads when ${path} was last changed in ${repo}`,
  }),

  pr_search_count: Object.freeze({
    id: "pr_search_count",
    label: "Matching pull requests",
    description:
      "How many pull/merge requests in one repository match a bounded search phrase.",
    params: Object.freeze({ repo: "repo_slug", search_query: "search_query" }),
    extracts: Object.freeze(["count"]),
    github: ({ repo, search_query: q }) => ({
      path: `search/issues?q=${enc(`repo:${repo} is:pr ${q}`)}&per_page=1`,
    }),
    gitlab: ({ repo, search_query: q }) => ({
      path: `projects/${gitlabProject(
        repo,
      )}/merge_requests?scope=all&state=all&search=${enc(q)}&per_page=${GITLAB_COUNT_PAGE}`,
    }),
    describe: ({ repo, search_query: q }) =>
      `Counts pull requests in ${repo} matching “${q}”`,
  }),

  pr_label_count: Object.freeze({
    id: "pr_label_count",
    label: "Labelled pull requests",
    description:
      "How many pull/merge requests in one repository carry a given label.",
    params: Object.freeze({ repo: "repo_slug", label: "label" }),
    extracts: Object.freeze(["count"]),
    github: ({ repo, label }) => ({
      path: `search/issues?q=${enc(`repo:${repo} is:pr label:"${label}"`)}&per_page=1`,
    }),
    gitlab: ({ repo, label }) => ({
      path: `projects/${gitlabProject(
        repo,
      )}/merge_requests?scope=all&state=all&labels=${enc(label)}&per_page=${GITLAB_COUNT_PAGE}`,
    }),
    describe: ({ repo, label }) =>
      `Counts pull requests in ${repo} labelled “${label}”`,
  }),

  open_pr_count: Object.freeze({
    id: "open_pr_count",
    label: "Open pull requests",
    description: "How many pull/merge requests are currently open in a repository.",
    params: Object.freeze({ repo: "repo_slug" }),
    extracts: Object.freeze(["count"]),
    github: ({ repo }) => ({
      path: `search/issues?q=${enc(`repo:${repo} is:pr is:open`)}&per_page=1`,
    }),
    gitlab: ({ repo }) => ({
      path: `projects/${gitlabProject(
        repo,
      )}/merge_requests?scope=all&state=opened&per_page=${GITLAB_COUNT_PAGE}`,
    }),
    describe: ({ repo }) => `Counts the open pull requests in ${repo}`,
  }),
});

export function getQueryTemplate(id) {
  if (typeof id !== "string") return null;
  return Object.prototype.hasOwnProperty.call(QUERY_TEMPLATES, id)
    ? QUERY_TEMPLATES[id]
    : null;
}

/**
 * The registry as data — what the classifier prompt lists as its menu and what
 * the composer UI renders as a picker. Deliberately excludes the binding
 * functions: nothing outside this module should be able to build a path.
 */
export function listQueryTemplates() {
  return Object.values(QUERY_TEMPLATES).map((t) => ({
    id: t.id,
    label: t.label,
    description: t.description,
    params: { ...t.params },
    extracts: [...t.extracts],
    providers: CONCRETE_PROVIDERS.filter((p) => typeof t[p] === "function"),
  }));
}

// ─── source validation ───────────────────────────────────────────────

/**
 * Validate a field's `source` block and return the normalised form, or null
 * (with reasons pushed onto `errors`).
 *
 * Normalisation always fills `extract`. A source that omits it takes the
 * template's first supported extract, so the executor never has to infer what
 * the spec meant — an inference that would have to be duplicated in the grader
 * and would drift.
 *
 * `path` lets callers report against `fields[3].source` instead of a bare
 * "source", which is the difference between a fixable error and a puzzle.
 */
export function validateQuerySource(source, errors, path = "source") {
  const fail = (msg) => {
    errors.push(`${path}${msg}`);
    return null;
  };

  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return fail(": must be an object");
  }
  if (!QUERY_SOURCE_PROVIDERS.includes(source.provider)) {
    return fail(
      `.provider: must be one of ${QUERY_SOURCE_PROVIDERS.join(", ")}`,
    );
  }
  const template = getQueryTemplate(source.query);
  if (!template) {
    return fail(
      `.query: unknown query template "${String(source.query)}" — must be one of ${Object.keys(QUERY_TEMPLATES).join(", ")}`,
    );
  }

  // A provider the template cannot express is a spec that would never measure
  // anything; "ask" needs both bindings or the question has one answer.
  const bound = CONCRETE_PROVIDERS.filter((p) => typeof template[p] === "function");
  if (source.provider === "ask") {
    if (bound.length < 2) {
      return fail(
        `.provider: "${template.id}" only supports ${bound.join(", ")}, so there is nothing to ask`,
      );
    }
  } else if (!bound.includes(source.provider)) {
    return fail(
      `.provider: "${template.id}" does not support ${source.provider}`,
    );
  }

  const raw =
    source.params && typeof source.params === "object" && !Array.isArray(source.params)
      ? source.params
      : null;
  if (!raw) return fail(".params: must be an object");

  const params = {};
  for (const [name, kind] of Object.entries(template.params)) {
    const value = raw[name];
    if (typeof value !== "string" || value.length === 0) {
      return fail(`.params.${name}: required ${kind}`);
    }
    if (!isValidQueryParam(kind, value)) {
      // The value is NOT echoed back: it may be attacker-authored text from an
      // uploaded document, and error strings end up in logs and UIs.
      return fail(`.params.${name}: not a valid ${kind}`);
    }
    params[name] = value;
  }
  // Undeclared params are a reject, not a silent drop: they mean the spec was
  // written against a template it does not actually understand.
  const extra = Object.keys(raw).filter(
    (k) => !Object.prototype.hasOwnProperty.call(template.params, k),
  );
  if (extra.length > 0) {
    return fail(`.params: unknown parameter(s) ${extra.join(", ")}`);
  }

  let extract = template.extracts[0];
  if (source.extract != null) {
    if (!template.extracts.includes(source.extract)) {
      return fail(
        `.extract: "${template.id}" supports ${template.extracts.join(", ")}`,
      );
    }
    extract = source.extract;
  }

  return { provider: source.provider, query: template.id, params, extract };
}

/**
 * One plain-English sentence a manager can judge without knowing the schema —
 * this is what the approval screen shows, so it has to be true and readable
 * rather than clever. Never throws: the composer calls it on half-built specs.
 */
export function describeQuerySource(source) {
  const template = getQueryTemplate(source?.query);
  if (!template) return "Reads an unrecognised query.";

  const display = {};
  for (const name of Object.keys(template.params)) {
    const value = source?.params?.[name];
    display[name] = isContextPlaceholder(value)
      ? `the ${name.replace(/_/g, " ")} you provide`
      : typeof value === "string" && value.length > 0
        ? value
        : `an unset ${name.replace(/_/g, " ")}`;
  }

  let sentence;
  try {
    sentence = template.describe(display);
  } catch {
    sentence = template.description;
  }
  const where =
    source?.provider === "ask"
      ? " (GitHub or GitLab — you choose)"
      : PROVIDER_LABELS[source?.provider]
        ? ` (${PROVIDER_LABELS[source.provider]})`
        : "";
  return `${sentence}${where}.`;
}

// ─── request building ────────────────────────────────────────────────

/**
 * Turn a validated source into the ONE request the proxy should make.
 *
 * Returns a relative path only — never a host. The base URL comes from
 * server-side engagement config and the token from the encrypted proxy path;
 * nothing in a spec, a param or a context answer can influence either.
 *
 * `ctx.answers` supplies context-question answers for `{{ctx:id}}` params, and
 * every substituted value is validated AGAIN against its kind here. That second
 * pass is the point of the whole design: the first validation happened when the
 * spec was written, against a value that is not this one.
 *
 * Throws QueryTemplateError for an unknown template, an unbound provider, a
 * missing or invalid param, or a path that somehow came out unsafe.
 */
export function buildProviderRequest(source, provider, ctx = {}) {
  const template = getQueryTemplate(source?.query);
  if (!template) {
    throw new QueryTemplateError(
      "unknown_template",
      `Unknown query template "${String(source?.query)}".`,
    );
  }
  if (!CONCRETE_PROVIDERS.includes(provider)) {
    throw new QueryTemplateError(
      "unsupported_provider",
      `Cannot build a request for provider "${String(provider)}".`,
    );
  }
  if (typeof template[provider] !== "function") {
    throw new QueryTemplateError(
      "unsupported_provider",
      `"${template.id}" cannot be answered by ${PROVIDER_LABELS[provider]}.`,
    );
  }
  // "ask" is the only source provider allowed to become something else, and
  // only because the composer asked the user which host to read.
  if (source.provider !== "ask" && source.provider !== provider) {
    throw new QueryTemplateError(
      "unsupported_provider",
      `This query is pinned to ${String(source.provider)}, not ${provider}.`,
    );
  }

  const answers = ctx.answers && typeof ctx.answers === "object" ? ctx.answers : {};
  const params = {};
  for (const [name, kind] of Object.entries(template.params)) {
    const declared = source?.params?.[name];
    if (typeof declared !== "string" || declared.length === 0) {
      throw new QueryTemplateError(
        "missing_param",
        `Query "${template.id}" needs a ${name}.`,
      );
    }
    const questionId = contextPlaceholderId(declared);
    const value = questionId == null ? declared : answers[questionId];
    if (typeof value !== "string" || value.length === 0) {
      throw new QueryTemplateError(
        "missing_param",
        `Query "${template.id}" needs an answer for ${name}.`,
      );
    }
    // Re-validate as a LITERAL — a placeholder that resolves to another
    // placeholder, or to a traversal, dies here.
    if (!PARAM_VALIDATORS[kind](value)) {
      throw new QueryTemplateError(
        "invalid_param",
        `The ${name} for "${template.id}" is not a valid ${kind}.`,
      );
    }
    params[name] = value;
  }

  const built = template[provider](params, ctx);
  return { method: "GET", path: assertSafePath(built?.path) };
}

// ─── extraction ──────────────────────────────────────────────────────

/**
 * Collapse a raw provider response into the primitive a COMPOSED field stores.
 *
 * Lives here rather than in the API because the shape knowledge is the
 * template's: whoever decided GitHub answers `search/issues` with `total_count`
 * and GitLab answers a list endpoint with an array is the same decision that
 * chose the paths above. Splitting them is how a registry drifts from its
 * reader.
 *
 * Returns null when the response cannot answer the question — never a guess,
 * because a wrong zero grades a goal as failed.
 */
export function extractQueryValue(extract, provider, { status, body } = {}) {
  switch (extract) {
    case "exists":
      if (status === 200) return true;
      if (status === 404) return false;
      return null;
    case "count": {
      if (body && typeof body.total_count === "number") return body.total_count;
      if (Array.isArray(body)) return body.length;
      return null;
    }
    case "latest_date": {
      const first = Array.isArray(body) ? body[0] : null;
      if (!first) return null;
      const iso =
        provider === "github"
          ? first?.commit?.committer?.date ?? first?.commit?.author?.date
          : first?.committed_date ?? first?.created_at;
      return typeof iso === "string" && iso.length > 0 ? iso : null;
    }
    default:
      // "ratio" lands here: no shipped template declares it, and inventing a
      // denominator would be the exact silent-wrongness this file exists to
      // prevent.
      return null;
  }
}
