/**
 * The GitHub write client with an injected fetch: only the hand-written
 * path shapes are requested, the token rides in the Authorization header
 * and nowhere else (never in an error), label races are tolerated, and
 * an upstream rate limit becomes a 429 HttpError with retryAfterMs.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../../middleware/error-handler.js";
import { createGithubClient, GITHUB_API_BASE } from "./github-client.js";

const TOKEN = "ghp_SECRET_TOKEN_VALUE_123";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function recorder(script: (call: Call, n: number) => Response) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    const call: Call = {
      url: String(url),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    };
    calls.push(call);
    return script(call, calls.length);
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const issue = (number: number) => ({
  id: number * 10,
  node_id: `I_${number}`,
  number,
  html_url: `https://github.com/espace/devhub/issues/${number}`,
  title: "t",
  body: "",
  state: "open",
});

const ALLOWED = [
  /^repos\/[^/?]+\/[^/?]+\/labels$/,
  /^repos\/[^/?]+\/[^/?]+\/issues$/,
  /^repos\/[^/?]+\/[^/?]+\/issues\/\d+$/,
  /^repos\/[^/?]+\/[^/?]+\/issues\?labels=[^&]*&state=all&per_page=100&page=\d+$/,
  /^repos\/[^/?]+\/[^/?]+\/issues\/\d+\/timeline\?per_page=100$/,
  /^repos\/[^/?]+\/[^/?]+\/issues\/\d+\/comments\?per_page=100(&page=\d+)?$/,
  /^repos\/[^/?]+\/[^/?]+\/pulls\/\d+$/,
  // #8 — the one comment write (manager notes / tier verdicts).
  /^repos\/[^/?]+\/[^/?]+\/issues\/\d+\/comments$/,
];

test("every operation hits exactly one of the allowed path shapes, with the right headers", async () => {
  const { calls, fetchImpl } = recorder((call) => {
    if (call.method === "POST" && call.url.endsWith("/labels")) return json(201, {});
    if (call.method === "POST" && call.url.endsWith("/comments")) {
      return json(201, { id: 77, html_url: "https://github.com/espace/devhub/issues/7#issuecomment-77" });
    }
    if (call.method === "POST") return json(201, issue(5));
    if (call.url.includes("?labels=")) return json(200, [issue(1), { ...issue(2), pull_request: {} }]);
    if (call.url.includes("/timeline?") || call.url.includes("/comments?")) {
      return json(200, []);
    }
    return json(200, issue(7));
  });
  const client = createGithubClient({ token: TOKEN, fetchImpl });

  await client.ensureLabel("espace/devhub", { name: "espace", color: "5b3fd9" });
  await client.createIssue("espace/devhub", { title: "t", body: "b", labels: ["espace"] });
  await client.getIssue("espace/devhub", 7);
  const listed = await client.listIssuesByLabels("espace/devhub", ["espace", "espace:R-1"]);
  await client.listTimeline("espace/devhub", 7);
  await client.listComments("espace/devhub", 7);
  await client.getPull("espace/devhub", 9);
  await client.listComments("espace/devhub", 7, { page: 3 });
  const posted = await client.createComment("espace/devhub", 7, "hello");

  assert.equal(calls.length, 9);
  assert.deepEqual(posted, { id: 77, html_url: "https://github.com/espace/devhub/issues/7#issuecomment-77" });
  assert.deepEqual(calls[8]?.body, { body: "hello" });
  assert.equal(calls[8]?.method, "POST");
  assert.ok(calls[7]?.url.endsWith("/comments?per_page=100&page=3"));
  for (const call of calls) {
    assert.ok(call.url.startsWith(`${GITHUB_API_BASE}/`), call.url);
    const path = call.url.slice(GITHUB_API_BASE.length + 1);
    assert.ok(ALLOWED.some((re) => re.test(path)), `unexpected path ${path}`);
    assert.equal(call.headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(call.headers.Accept, "application/vnd.github+json");
    assert.equal(call.headers["X-GitHub-Api-Version"], "2022-11-28");
    assert.equal(call.headers["User-Agent"], "espace-devhub");
  }
  // Pull requests come back from the issues list and are dropped.
  assert.deepEqual(listed.map((i) => i.number), [1]);
  assert.equal(calls[3]?.url.includes("labels=espace%2Cespace%3AR-1"), true);
});

test("repo and issue number are validated before any request is made", async () => {
  const { calls, fetchImpl } = recorder(() => json(200, issue(1)));
  const client = createGithubClient({ token: TOKEN, fetchImpl });
  for (const bad of ["espace", "a/b/c", "../x/y", "es pace/dev", "a/..", "espace/dev?x=1"]) {
    await assert.rejects(client.getIssue(bad, 1), (e: unknown) => e instanceof HttpError && e.status === 400);
  }
  await assert.rejects(client.getIssue("espace/devhub", 0), (e: unknown) => e instanceof HttpError && e.status === 400);
  await assert.rejects(client.getIssue("espace/devhub", 1.5), (e: unknown) => e instanceof HttpError && e.status === 400);
  assert.equal(calls.length, 0);
});

test("a transport failure never leaks the token into the error", async () => {
  const fetchImpl = (async () => {
    throw new Error(`socket hang up while sending Bearer ${TOKEN}`);
  }) as unknown as typeof fetch;
  const client = createGithubClient({ token: TOKEN, fetchImpl });
  await assert.rejects(client.getIssue("espace/devhub", 1), (err: unknown) => {
    assert.ok(err instanceof HttpError);
    assert.equal(err.status, 502);
    assert.equal(err.code, "github_upstream_error");
    assert.equal(err.message.includes(TOKEN), false);
    assert.equal(JSON.stringify(err).includes(TOKEN), false);
    return true;
  });
});

test("upstream statuses map to the documented codes without echoing the body", async () => {
  const cases: Array<[number, number, string]> = [
    [401, 401, "integration_needs_reconnect"],
    [403, 401, "integration_needs_reconnect"],
    [404, 404, "github_target_missing"],
    [410, 404, "github_target_missing"],
    [500, 502, "github_upstream_error"],
    [422, 502, "github_upstream_error"],
  ];
  for (const [upstream, status, code] of cases) {
    const { fetchImpl } = recorder(() => json(upstream, { message: "SECRET-UPSTREAM-BODY" }));
    const client = createGithubClient({ token: TOKEN, fetchImpl });
    await assert.rejects(client.getIssue("espace/devhub", 1), (err: unknown) => {
      assert.ok(err instanceof HttpError);
      assert.equal(err.status, status, `upstream ${upstream}`);
      assert.equal(err.code, code, `upstream ${upstream}`);
      assert.equal(err.message.includes("SECRET-UPSTREAM-BODY"), false);
      return true;
    });
  }
});

test("ensureLabel tolerates already_exists and treats a refusal as 'no labels', not a failure", async () => {
  const exists = recorder(() => json(422, { errors: [{ code: "already_exists", field: "name" }] }));
  const a = createGithubClient({ token: TOKEN, fetchImpl: exists.fetchImpl });
  assert.equal(await a.ensureLabel("espace/devhub", { name: "espace", color: "5b3fd9" }), true);

  const forbidden = recorder(() => json(403, { message: "Resource not accessible" }));
  const b = createGithubClient({ token: TOKEN, fetchImpl: forbidden.fetchImpl });
  assert.equal(await b.ensureLabel("espace/devhub", { name: "espace", color: "5b3fd9" }), false);

  const unauthorized = recorder(() => json(401, { message: "Bad credentials" }));
  const c = createGithubClient({ token: TOKEN, fetchImpl: unauthorized.fetchImpl });
  await assert.rejects(
    c.ensureLabel("espace/devhub", { name: "espace", color: "5b3fd9" }),
    (e: unknown) => e instanceof HttpError && e.code === "integration_needs_reconnect",
  );
});

test("createIssue retries once without labels when GitHub rejects them", async () => {
  const { calls, fetchImpl } = recorder((_call, n) =>
    n === 1 ? json(422, { errors: [{ field: "labels", code: "invalid" }] }) : json(201, issue(3)),
  );
  const client = createGithubClient({ token: TOKEN, fetchImpl });
  const out = await client.createIssue("espace/devhub", { title: "t", body: "b", labels: ["espace"] });
  assert.equal(out.labelsApplied, false);
  assert.equal(out.issue.number, 3);
  assert.equal(calls.length, 2);
  assert.deepEqual((calls[0]?.body as { labels: string[] }).labels, ["espace"]);
  assert.equal("labels" in (calls[1]?.body as object), false);
});

test("a rate limit becomes a 429 HttpError carrying retryAfterMs", async () => {
  const primary = recorder(() =>
    json(403, { message: "API rate limit exceeded" }, {
      "x-ratelimit-remaining": "0",
      "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 120),
    }),
  );
  const client = createGithubClient({ token: TOKEN, fetchImpl: primary.fetchImpl });
  await assert.rejects(client.getIssue("espace/devhub", 1), (err: unknown) => {
    assert.ok(err instanceof HttpError);
    assert.equal(err.status, 429);
    assert.equal(err.code, "rate_limited");
    assert.ok((err.retryAfterMs ?? 0) >= 60_000 && (err.retryAfterMs ?? 0) <= 125_000);
    return true;
  });

  const secondary = recorder(() => json(429, {}, { "retry-after": "30" }));
  const c2 = createGithubClient({ token: TOKEN, fetchImpl: secondary.fetchImpl });
  await assert.rejects(
    c2.createIssue("espace/devhub", { title: "t", body: "b", labels: [] }),
    (err: unknown) => err instanceof HttpError && err.status === 429 && err.retryAfterMs === 30_000,
  );
});

test("listIssuesByLabels paginates to the 300-item cap", async () => {
  const page = (start: number) => Array.from({ length: 100 }, (_, i) => issue(start + i));
  const { calls, fetchImpl } = recorder((call) => {
    const n = Number(/page=(\d+)/.exec(call.url)?.[1] ?? 1);
    return json(200, page((n - 1) * 100 + 1));
  });
  const client = createGithubClient({ token: TOKEN, fetchImpl });
  const all = await client.listIssuesByLabels("espace/devhub", ["espace"]);
  assert.equal(all.length, 300);
  assert.equal(calls.length, 3);
});

test("an empty token is refused up front", () => {
  assert.throws(
    () => createGithubClient({ token: "  " }),
    (e: unknown) => e instanceof HttpError && e.code === "integration_not_connected",
  );
});

test("createComment refuses an empty body before any request", async () => {
  const { calls, fetchImpl } = recorder(() => json(201, { id: 1, html_url: "x" }));
  const client = createGithubClient({ token: TOKEN, fetchImpl });
  await assert.rejects(client.createComment("espace/devhub", 7, "   "), (e: unknown) => e instanceof HttpError && e.status === 400);
  await assert.rejects(client.createComment("../x", 7, "hi"), (e: unknown) => e instanceof HttpError && e.status === 400);
  assert.equal(calls.length, 0);
});
