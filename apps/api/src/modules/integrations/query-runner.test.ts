/**
 * Security tests for the COMPOSED source-field executor.
 *
 * Every test injects a DELIBERATELY PERMISSIVE registry — one that
 * validates whatever it is handed and builds whatever path it is told to.
 * That is the point: the shared registry in packages/shared is one layer
 * of defence, and these assert the runner holds the line on its own. A
 * test that leaned on the shared validators would still pass with every
 * gate in query-runner.ts deleted.
 *
 * The network is stubbed throughout — a test must never spend a real
 * token or a real third-party quota. Status bookkeeping is stubbed for
 * the same reason: a unit run has no business opening a DB handle.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { ObjectId } from "mongodb";
import {
  resolveQuery,
  type QueryRunnerDeps,
  type QueryTemplateDescriptor,
  type QueryTemplateRegistry,
  type ResolveQueryContext,
} from "./query-runner.js";
import type { HttpError } from "../../middleware/error-handler.js";

// Set unconditionally: the repo's dotenv loading runs at import time and
// may leave this defined-but-empty, which `??=` would happily keep.
process.env.ESPACE_GITLAB_URL = "https://gitlab.example.com";

const template: QueryTemplateDescriptor = {
  id: "repo_file_exists",
  params: { repo: "repo_slug", path: "file_path" },
  extracts: ["exists", "latest_date", "count"],
  github: true,
  gitlab: true,
};

const source = {
  provider: "github" as const,
  query: "repo_file_exists",
  params: { repo: "espace/devhub", path: "AGENTS.md" },
  extract: "exists" as const,
};

/** A registry that says yes to everything, so the runner must say no. */
function permissiveRegistry(
  build: (source: { params: Record<string, string> }) => {
    method?: string;
    path: string;
  },
  overrides: Partial<QueryTemplateRegistry> = {},
): QueryTemplateRegistry {
  return {
    getQueryTemplate: (id) => (id === template.id ? template : null),
    validateQuerySource: (s) => s as never,
    describeQuerySource: () => "whether the file exists",
    buildProviderRequest: (s) => build(s),
    ...overrides,
  };
}

function ctx(
  contextAnswers: Record<string, string | string[]> = {},
): ResolveQueryContext {
  return {
    userId: new ObjectId(),
    orgId: new ObjectId(),
    engagement: "espace",
    contextAnswers,
  };
}

/** Records every URL + verb the runner attempted. */
function recordingFetch(response: () => Response) {
  const calls: Array<{ url: string; method: string }> = [];
  const impl = (async (url: unknown, init?: { method?: string }) => {
    calls.push({ url: String(url), method: init?.method ?? "GET" });
    return response();
  }) as unknown as typeof fetch;
  return { calls, impl };
}

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

const noop = async (): Promise<void> => {};

function deps(
  registry: QueryTemplateRegistry,
  fetchImpl: typeof fetch,
  connected: string[] = ["github"],
): QueryRunnerDeps {
  return {
    registry,
    fetchImpl,
    markUsed: noop,
    markError: noop,
    loadTokens: (async (input: { providerId: string }) =>
      connected.includes(input.providerId)
        ? {
            accessToken: "test-token",
            apiToken: null,
            refreshToken: null,
            email: null,
            endpointUrl: null,
          }
        : null) as never,
  };
}

async function expectHttpError(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await promise;
    assert.fail(`expected ${code}, resolved instead`);
  } catch (err) {
    assert.equal((err as HttpError).code, code);
  }
}

test("a template id outside the allowlist is rejected before anything runs", async () => {
  const { calls, impl } = recordingFetch(() => jsonResponse(200, {}));
  await expectHttpError(
    resolveQuery(
      { ...source, query: "arbitrary_url_fetch" },
      ctx(),
      deps(permissiveRegistry(() => ({ path: "anything" })), impl),
    ),
    "query_template_unknown",
  );
  assert.equal(calls.length, 0, "a forged template must not reach the network");
});

test("a non-GET verb from a template is refused, not honoured", async () => {
  const { calls, impl } = recordingFetch(() => jsonResponse(200, {}));
  await expectHttpError(
    resolveQuery(
      source,
      ctx(),
      deps(
        permissiveRegistry(() => ({
          method: "DELETE",
          path: "repos/espace/devhub",
        })),
        impl,
      ),
    ),
    "query_method_rejected",
  );
  assert.equal(calls.length, 0);
});

test("the outbound request is a GET at the engagement's origin", async () => {
  const { calls, impl } = recordingFetch(() => jsonResponse(200, {}));
  await resolveQuery(
    source,
    ctx(),
    deps(
      permissiveRegistry(() => ({
        path: "repos/espace/devhub/contents/AGENTS.md",
      })),
      impl,
    ),
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.method, "GET");
  assert.equal(
    calls[0]?.url,
    "https://api.github.com/repos/espace/devhub/contents/AGENTS.md",
  );
});

test("a path that escapes the engagement origin is rejected", async () => {
  const escapes = [
    "//evil.example/x", // protocol-relative — the dangerous one
    "/absolute",
    "https://evil.example/x",
    "repos/../../admin",
    "repos/%2e%2e/admin",
    "repos/espace/devhub\r\nX-Injected: 1",
  ];
  for (const path of escapes) {
    const { calls, impl } = recordingFetch(() => jsonResponse(200, {}));
    await expectHttpError(
      resolveQuery(source, ctx(), deps(permissiveRegistry(() => ({ path })), impl)),
      "query_path_rejected",
    );
    assert.equal(calls.length, 0, `must not fetch for path: ${path}`);
  }
});

test("a traversal or scheme smuggled through a context answer is rejected", async () => {
  const hostile = [
    "../../etc/passwd",
    "https://evil.example/repo",
    "espace/devhub\nX-Injected: 1",
    "user@evil.example",
  ];
  for (const answer of hostile) {
    const { calls, impl } = recordingFetch(() => jsonResponse(200, {}));
    await expectHttpError(
      resolveQuery(
        { ...source, params: { repo: "{{ctx:q_repo}}", path: "AGENTS.md" } },
        ctx({ q_repo: answer }),
        deps(
          permissiveRegistry((s) => ({
            path: `repos/${s.params.repo}/contents/AGENTS.md`,
          })),
          impl,
        ),
      ),
      "context_answer_rejected",
    );
    assert.equal(calls.length, 0, `must not fetch for answer: ${answer}`);
  }
});

test("a clean context answer substitutes into the path", async () => {
  const { calls, impl } = recordingFetch(() => jsonResponse(200, {}));
  await resolveQuery(
    { ...source, params: { repo: "{{ctx:q_repo}}", path: "AGENTS.md" } },
    ctx({ q_repo: "espace/devhub" }),
    deps(
      permissiveRegistry((s) => ({
        path: `repos/${s.params.repo}/contents/AGENTS.md`,
      })),
      impl,
    ),
  );
  assert.equal(
    calls[0]?.url,
    "https://api.github.com/repos/espace/devhub/contents/AGENTS.md",
  );
});

test("an unanswered context question is a clear error, not an empty path", async () => {
  const { calls, impl } = recordingFetch(() => jsonResponse(200, {}));
  await expectHttpError(
    resolveQuery(
      { ...source, params: { repo: "{{ctx:q_repo}}", path: "AGENTS.md" } },
      ctx({}),
      deps(
        permissiveRegistry((s) => ({ path: `repos/${s.params.repo}` })),
        impl,
      ),
    ),
    "context_answer_missing",
  );
  assert.equal(calls.length, 0);
});

test("a provider the user has not connected is refused", async () => {
  const { calls, impl } = recordingFetch(() => jsonResponse(200, {}));
  await expectHttpError(
    resolveQuery(
      { ...source, provider: "gitlab" },
      ctx(),
      deps(permissiveRegistry(() => ({ path: "projects/1" })), impl, ["github"]),
    ),
    "integration_not_connected",
  );
  assert.equal(calls.length, 0, "no token, no call");
});

test('provider "ask" reads the user\'s answer instead of guessing', async () => {
  const { calls, impl } = recordingFetch(() => jsonResponse(200, [{ id: 1 }]));
  const result = await resolveQuery(
    { ...source, provider: "ask", extract: "count" },
    ctx({ q_provider: "gitlab" }),
    deps(
      permissiveRegistry(() => ({
        path: "projects/espace%2Fdevhub/merge_requests",
      })),
      impl,
      ["github", "gitlab"],
    ),
  );
  assert.equal(result.provider, "gitlab");
  assert.match(calls[0]?.url ?? "", /^https:\/\/gitlab\.example\.com\/api\/v4\//);
});

test('provider "ask" with both connected and no answer is an explicit conflict', async () => {
  const { calls, impl } = recordingFetch(() => jsonResponse(200, {}));
  await expectHttpError(
    resolveQuery(
      { ...source, provider: "ask" },
      ctx(),
      deps(
        permissiveRegistry(() => ({ path: "repos/espace/devhub" })),
        impl,
        ["github", "gitlab"],
      ),
    ),
    "query_provider_ambiguous",
  );
  assert.equal(calls.length, 0);
});

test("a 404 means exists:false — it is an answer, not a failure", async () => {
  const { impl } = recordingFetch(() => jsonResponse(404, { message: "Not Found" }));
  const result = await resolveQuery(
    source,
    ctx(),
    deps(
      permissiveRegistry(() => ({
        path: "repos/espace/devhub/contents/AGENTS.md",
      })),
      impl,
    ),
  );
  assert.equal(result.value, false);
  assert.equal(result.extract, "exists");
  assert.equal(result.describe, "whether the file exists");
  assert.ok(Date.parse(result.fetchedAt) > 0);
});

test("a 200 means exists:true and nothing of the upstream body escapes", async () => {
  const { impl } = recordingFetch(() =>
    jsonResponse(200, { content: "c2VjcmV0", download_url: "https://x/y" }),
  );
  const result = await resolveQuery(
    source,
    ctx(),
    deps(
      permissiveRegistry(() => ({
        path: "repos/espace/devhub/contents/AGENTS.md",
      })),
      impl,
    ),
  );
  assert.deepEqual(Object.keys(result).sort(), [
    "describe",
    "extract",
    "fetchedAt",
    "provider",
    "value",
  ]);
  assert.equal(result.value, true);
});

test("a 401 tells the user to reconnect and leaks nothing", async () => {
  const { impl } = recordingFetch(() =>
    jsonResponse(401, { message: "Bad credentials", token: "ghp_leak" }),
  );
  try {
    await resolveQuery(
      source,
      ctx(),
      deps(permissiveRegistry(() => ({ path: "repos/espace/devhub" })), impl),
    );
    assert.fail("expected integration_needs_reconnect");
  } catch (err) {
    const httpErr = err as HttpError;
    assert.equal(httpErr.code, "integration_needs_reconnect");
    assert.match(httpErr.message, /Reconnect it in settings/);
    assert.doesNotMatch(httpErr.message, /ghp_leak|Bad credentials/);
  }
});

test("count prefers GitLab's x-total header over the page length", async () => {
  const { impl } = recordingFetch(() =>
    jsonResponse(200, [{ id: 1 }, { id: 2 }], { "x-total": "37" }),
  );
  const result = await resolveQuery(
    { ...source, provider: "gitlab", extract: "count" },
    ctx(),
    deps(
      permissiveRegistry(() => ({ path: "projects/1/merge_requests" })),
      impl,
      ["gitlab"],
    ),
  );
  assert.equal(result.value, 37);
});

test("an extract the template does not support is refused", async () => {
  const { calls, impl } = recordingFetch(() => jsonResponse(200, {}));
  await expectHttpError(
    resolveQuery(
      { ...source, extract: "ratio" },
      ctx(),
      deps(permissiveRegistry(() => ({ path: "repos/espace/devhub" })), impl),
    ),
    "query_extract_unsupported",
  );
  assert.equal(calls.length, 0);
});

// ─── multi-repo fan-out ──────────────────────────────────────────────

test("a multi-repo answer fans out sequentially and sums counts", async () => {
  const calls: Array<{ url: string; method: string }> = [];
  const totals = ["3", "5", "0"];
  const impl = (async (url: unknown, init?: { method?: string }) => {
    calls.push({ url: String(url), method: init?.method ?? "GET" });
    return jsonResponse(200, [{ id: 1 }], { "x-total": totals[calls.length - 1]! });
  }) as unknown as typeof fetch;

  const result = await resolveQuery(
    { ...source, extract: "count", params: { repo: "{{ctx:q_repo}}", path: "AGENTS.md" } },
    ctx({ q_repo: ["espace/one", "espace/two", "espace/three"] }),
    deps(
      permissiveRegistry((s) => ({ path: `repos/${s.params.repo}/pulls` })),
      impl,
    ),
  );

  assert.equal(calls.length, 3);
  assert.deepEqual(
    calls.map((c) => c.url),
    [
      "https://api.github.com/repos/espace/one/pulls",
      "https://api.github.com/repos/espace/two/pulls",
      "https://api.github.com/repos/espace/three/pulls",
    ],
  );
  assert.equal(result.value, 8);
  assert.match(result.describe, /\(\+2 more repos\)$/);
});

test("multi-repo exists is an OR — a 404 in one repo doesn't sink a hit in another", async () => {
  let n = 0;
  const impl = (async () => {
    n += 1;
    return n === 1
      ? jsonResponse(404, { message: "Not Found" })
      : jsonResponse(200, {});
  }) as unknown as typeof fetch;

  const result = await resolveQuery(
    { ...source, params: { repo: "{{ctx:q_repo}}", path: "AGENTS.md" } },
    ctx({ q_repo: ["espace/one", "espace/two"] }),
    deps(
      permissiveRegistry((s) => ({
        path: `repos/${s.params.repo}/contents/AGENTS.md`,
      })),
      impl,
    ),
  );
  assert.equal(result.value, true);
});

test("multi-repo exists with every repo 404ing is false", async () => {
  const { impl } = recordingFetch(() => jsonResponse(404, { message: "Not Found" }));
  const result = await resolveQuery(
    { ...source, params: { repo: "{{ctx:q_repo}}", path: "AGENTS.md" } },
    ctx({ q_repo: ["espace/one", "espace/two"] }),
    deps(
      permissiveRegistry((s) => ({
        path: `repos/${s.params.repo}/contents/AGENTS.md`,
      })),
      impl,
    ),
  );
  assert.equal(result.value, false);
});

test("more than 10 repos in one answer is a clear 400, not a request storm", async () => {
  const { calls, impl } = recordingFetch(() => jsonResponse(200, {}));
  const repos = Array.from({ length: 11 }, (_, i) => `espace/repo-${i}`);
  await expectHttpError(
    resolveQuery(
      { ...source, params: { repo: "{{ctx:q_repo}}", path: "AGENTS.md" } },
      ctx({ q_repo: repos }),
      deps(
        permissiveRegistry((s) => ({ path: `repos/${s.params.repo}` })),
        impl,
      ),
    ),
    "context_answer_too_many",
  );
  assert.equal(calls.length, 0);
});

test("two multi-valued params are refused — no cartesian fan-out", async () => {
  const { calls, impl } = recordingFetch(() => jsonResponse(200, {}));
  await expectHttpError(
    resolveQuery(
      { ...source, params: { repo: "{{ctx:q_repo}}", path: "{{ctx:q_path}}" } },
      ctx({ q_repo: ["espace/one", "espace/two"], q_path: ["a.md", "b.md"] }),
      deps(
        permissiveRegistry((s) => ({ path: `repos/${s.params.repo}/${s.params.path}` })),
        impl,
      ),
    ),
    "query_source_invalid",
  );
  assert.equal(calls.length, 0);
});

test("a single-element array answer behaves exactly like a scalar", async () => {
  const { calls, impl } = recordingFetch(() => jsonResponse(200, {}));
  const result = await resolveQuery(
    { ...source, params: { repo: "{{ctx:q_repo}}", path: "AGENTS.md" } },
    ctx({ q_repo: ["espace/devhub"] }),
    deps(
      permissiveRegistry((s) => ({
        path: `repos/${s.params.repo}/contents/AGENTS.md`,
      })),
      impl,
    ),
  );
  assert.equal(calls.length, 1);
  assert.equal(result.value, true);
  assert.equal(result.describe, "whether the file exists");
});

test("every fanned-out answer passes the shape gate — one hostile repo kills the field", async () => {
  const { calls, impl } = recordingFetch(() => jsonResponse(200, {}));
  await expectHttpError(
    resolveQuery(
      { ...source, params: { repo: "{{ctx:q_repo}}", path: "AGENTS.md" } },
      ctx({ q_repo: ["espace/clean", "../../etc/passwd"] }),
      deps(
        permissiveRegistry((s) => ({ path: `repos/${s.params.repo}` })),
        impl,
      ),
    ),
    "context_answer_rejected",
  );
  assert.equal(calls.length, 0, "hostile element must be caught before ANY fetch");
});

test("a template with no binding for the resolved provider is refused", async () => {
  const githubOnly: QueryTemplateDescriptor = { ...template, gitlab: undefined };
  const { calls, impl } = recordingFetch(() => jsonResponse(200, {}));
  await expectHttpError(
    resolveQuery(
      { ...source, provider: "gitlab" },
      ctx(),
      deps(
        permissiveRegistry(() => ({ path: "projects/1" }), {
          getQueryTemplate: (id) => (id === template.id ? githubOnly : null),
        }),
        impl,
        ["gitlab"],
      ),
    ),
    "query_provider_unsupported",
  );
  assert.equal(calls.length, 0);
});
