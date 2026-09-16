import test from "node:test";
import assert from "node:assert/strict";

import { assistedSharePct, isAssisted, DEFAULT_ASSISTED_LABELS } from "./assisted.js";
import { normalizeGithubMergedSearch } from "../api-clients/github-normalize.js";

const merged = (labels, i = 0) => ({
  merged_at: `2026-03-0${(i % 9) + 1}T00:00:00.000Z`,
  labels,
});

test("counts merged PRs carrying any watched label", () => {
  const out = assistedSharePct([
    merged(["claude-code-assisted"], 0),
    merged(["bug"], 1),
    merged(["cursor-assisted", "bug"], 2),
    merged([], 3),
  ]);

  assert.equal(out.assisted, 2);
  assert.equal(out.unassisted, 2);
  assert.equal(out.total, 4);
  assert.equal(out.pct, 50);
});

test("reports which labels were actually seen, not just the count", () => {
  const out = assistedSharePct([
    merged(["claude-code-assisted"], 0),
    merged(["claude-code-assisted"], 1),
  ]);

  assert.deepEqual(out.matched, ["claude-code-assisted"]);
});

test("an empty window is null, not zero percent", () => {
  assert.equal(assistedSharePct([]), null);
  assert.equal(assistedSharePct([{ labels: ["claude-code-assisted"] }]), null, "unmerged ignored");
});

test("a non-empty window with no matches is a real zero", () => {
  const out = assistedSharePct([merged(["bug"], 0), merged([], 1)]);
  assert.equal(out.pct, 0);
  assert.equal(out.total, 2);
  assert.deepEqual(out.matched, []);
});

test("matching is case-insensitive and ignores surrounding whitespace", () => {
  assert.equal(isAssisted({ labels: ["Claude-Code-Assisted"] }), true);
  assert.equal(isAssisted({ labels: ["  ai-assisted  "] }), true);
  assert.equal(isAssisted({ labels: ["assisted"] }), false, "no loose substring match");
});

test("a custom label set replaces the defaults rather than adding to them", () => {
  const mrs = [merged(["claude-code-assisted"], 0), merged(["our-own-tag"], 1)];

  const custom = assistedSharePct(mrs, ["our-own-tag"]);
  assert.equal(custom.assisted, 1);
  assert.deepEqual(custom.matched, ["our-own-tag"]);

  const fallback = assistedSharePct(mrs, []);
  assert.equal(fallback.assisted, 1, "an empty list falls back to the defaults");
  assert.deepEqual(fallback.matched, ["claude-code-assisted"]);
});

test("a PR carrying two watched labels counts once, not twice", () => {
  const out = assistedSharePct([merged(["claude-code-assisted", "ai-assisted"], 0)]);
  assert.equal(out.assisted, 1);
  assert.equal(out.pct, 100);
  assert.deepEqual(out.matched, ["ai-assisted", "claude-code-assisted"]);
});

test("the defaults cover the assistants that actually label pull requests", () => {
  assert.ok(DEFAULT_ASSISTED_LABELS.includes("claude-code-assisted"));
  assert.ok(DEFAULT_ASSISTED_LABELS.every((l) => l === l.toLowerCase()));
});

// The whole point of the metric is that the labels are already on the data
// the app fetches. If the normaliser drops them, the metric silently reads 0%.
test("labels survive GitHub search normalisation", () => {
  const rows = normalizeGithubMergedSearch({
    items: [
      {
        id: 1,
        number: 7,
        title: "Add retry ceiling",
        body: "",
        created_at: "2026-03-01T00:00:00.000Z",
        comments: 0,
        html_url: "https://example.invalid/pr/7",
        labels: [{ name: "Claude-Code-Assisted" }, { name: "bug" }],
        pull_request: { merged_at: "2026-03-02T00:00:00.000Z" },
      },
    ],
  });

  assert.deepEqual(rows[0].labels, ["claude-code-assisted", "bug"]);
  assert.equal(assistedSharePct(rows).pct, 100);
});

test("a PR with no labels field normalises to an empty list, not undefined", () => {
  const rows = normalizeGithubMergedSearch({
    items: [
      {
        id: 2,
        number: 8,
        title: "No labels",
        created_at: "2026-03-01T00:00:00.000Z",
        html_url: "https://example.invalid/pr/8",
        pull_request: { merged_at: "2026-03-02T00:00:00.000Z" },
      },
    ],
  });

  assert.deepEqual(rows[0].labels, []);
  assert.equal(assistedSharePct(rows).pct, 0);
});
