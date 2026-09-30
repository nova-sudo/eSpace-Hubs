import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import express, { type NextFunction, type Request, type Response } from "express";
import { ObjectId } from "mongodb";

import { loginKey, loginLimiter, normalizedEmail, totpKey } from "./rate-limit.js";
import { HttpError } from "./error-handler.js";

const req = (ip: string, body?: unknown, userId?: ObjectId) =>
  ({ ip, body, session: userId ? { userId } : undefined }) as unknown as Request;

test("login is keyed by IP + normalised email", () => {
  assert.equal(normalizedEmail({ email: "  Dev@Example.COM " }), "dev@example.com");
  assert.equal(loginKey(req("10.0.0.1", { email: "a@x.io" })), loginKey(req("10.0.0.1", { email: "A@X.io " })));
  assert.notEqual(loginKey(req("10.0.0.1", { email: "a@x.io" })), loginKey(req("10.0.0.1", { email: "b@x.io" })));
  assert.notEqual(loginKey(req("10.0.0.1", { email: "a@x.io" })), loginKey(req("10.0.0.2", { email: "a@x.io" })));
});

test("TOTP is keyed by IP + the partial session's user", () => {
  const u1 = new ObjectId();
  const u2 = new ObjectId();
  assert.notEqual(totpKey(req("10.0.0.1", {}, u1)), totpKey(req("10.0.0.1", {}, u2)));
  assert.equal(totpKey(req("10.0.0.1", {}, u1)), totpKey(req("10.0.0.1", {}, u1)));
});

async function withApp(fn: (url: string) => Promise<void>) {
  const app = express();
  app.set("trust proxy", false);
  app.use(express.json() as unknown as express.RequestHandler);
  app.post("/login", loginLimiter, (_req: Request, res: Response) => {
    res.json({ ok: true });
  });
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof HttpError ? err.status : 500;
    res.status(status).json({ error: { code: err instanceof HttpError ? err.code : "x" } });
  });
  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
  }
}

const post = (url: string, email: string) =>
  fetch(`${url}/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "x" }),
  });

test("one office NAT: an 11th user signing in is NOT locked out by the other ten", async () => {
  await withApp(async (url) => {
    // Ten colleagues, one attempt each, from the same IP…
    for (let i = 0; i < 10; i += 1) {
      assert.equal((await post(url, `dev${i}@espace.io`)).status, 200);
    }
    // …the eleventh still gets in (per-IP keying used to 429 here).
    assert.equal((await post(url, "dev10@espace.io")).status, 200);
  });
});

test("one account hammered from one IP is still throttled after 10 tries", async () => {
  await withApp(async (url) => {
    for (let i = 0; i < 10; i += 1) {
      assert.equal((await post(url, "victim@espace.io")).status, 200);
    }
    const r = await post(url, "victim@espace.io");
    assert.equal(r.status, 429);
    assert.equal(((await r.json()) as { error: { code: string } }).error.code, "rate_limited");
  });
});
