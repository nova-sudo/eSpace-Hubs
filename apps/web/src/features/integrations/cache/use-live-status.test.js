import test from "node:test";
import assert from "node:assert/strict";
import { deriveLiveStatus, providersLabel } from "./use-live-status.js";
import { resolveLiveState } from "../../../components/ui/live-value-state.js";

const NOW = Date.now();

test("before the integrations list arrives, a tile is pending (skeleton), not empty", () => {
  const st = deriveLiveStatus({ providers: ["github"], connected: [], integrationsReady: false });
  assert.equal(st.pending, true);
  assert.equal(resolveLiveState(st, NOW).kind, "skeleton");
});

test("a connected provider whose feed hasn't answered is pending, not 0", () => {
  const st = deriveLiveStatus({ providers: ["github", "gitlab"], connected: ["github"], dataReady: false });
  assert.equal(st.pending, true);
});

test("no provider connected reads as a connect prompt, not a skeleton", () => {
  const st = deriveLiveStatus({ providers: ["github", "gitlab"], connected: [], dataReady: false });
  assert.equal(st.pending, false);
  const s = resolveLiveState(st, NOW);
  assert.equal(s.kind, "empty");
  assert.equal(s.message, "Connect GitHub or GitLab in Settings");
});

test("a rate-limited error names its provider and carries the limit expiry", () => {
  const until = NOW + 5 * 60_000;
  const err = Object.assign(new Error("github 403"), { rateLimited: true, provider: "github", rateLimitedUntil: until });
  const st = deriveLiveStatus({
    providers: ["github", "gitlab"],
    connected: ["github", "gitlab"],
    hasValue: true,
    dataReady: true,
    error: err,
    fetchedAt: NOW - 60_000,
  });
  assert.equal(st.provider, "GitHub");
  assert.equal(st.rateLimitedUntil, until);
  const s = resolveLiveState(st, NOW);
  assert.equal(s.kind, "value");
  assert.match(s.note, /GitHub rate limit — refreshing at/);
});

test("provider activity drives 'updating…' and a provider-level limit", () => {
  const st = deriveLiveStatus({
    providers: ["jira"],
    hasValue: true,
    dataReady: true,
    activity: { isRefreshing: true, rateLimitedUntil: null },
  });
  assert.equal(resolveLiveState(st, NOW).note, "updating…");
});

test("providersLabel", () => {
  assert.equal(providersLabel(["github"]), "GitHub");
  assert.equal(providersLabel(["github", "gitlab", "jira"]), "GitHub, GitLab or Jira");
  assert.equal(providersLabel([]), "");
});
