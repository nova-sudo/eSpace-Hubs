import test from "node:test";
import assert from "node:assert/strict";

import { buildCurrentData } from "./use-goal-tier.js";
import { evidenceManifestToText } from "./use-evidence-manifest.js";
import { SPEC_KINDS } from "@/features/goal-specs";

/**
 * What the grader is allowed to see.
 *
 * Every case here is a thing the product already captured, stored and showed
 * to a human, and then withheld from the model that grades it. The written
 * root cause collapsed to "root cause: yes". A reflection journal graded as a
 * count of reflections. A date log graded without its dates. A note typed
 * beside a reading reached the manager's export and nothing else.
 *
 * These assertions are deliberately about CONTENT REACHING THE STRING, not
 * about its phrasing, so the prompt can be reworded without breaking them.
 */

const entry = (value, ts, note) => ({ goalId: "g1", ts, value, note });

test("an entry note reaches the grader, whatever the widget is", () => {
  const spec = { widget: SPEC_KINDS.COUNTER };
  const entries = [
    entry(3, Date.UTC(2026, 0, 5), "vendor SDK regressed, refiled as INFRA-812"),
    entry(4, Date.UTC(2026, 0, 12)),
  ];

  const out = buildCurrentData(spec, entries, null, null);

  assert.match(out, /current total: 7/);
  assert.match(out, /vendor SDK regressed, refiled as INFRA-812/);
  assert.match(out, /2026-01-05/);
});

test("a goal with no notes is unchanged", () => {
  const spec = { widget: SPEC_KINDS.COUNTER };
  const out = buildCurrentData(spec, [entry(2, Date.UTC(2026, 0, 5))], null, null);
  assert.equal(out, "current total: 2");
});

test("notes are capped, newest first, so one long journal cannot crowd the prompt", () => {
  const spec = { widget: SPEC_KINDS.COUNTER };
  const entries = Array.from({ length: 20 }, (_, i) =>
    entry(1, Date.UTC(2026, 0, i + 1), `note number ${i}`),
  );

  const out = buildCurrentData(spec, entries, null, null);

  assert.match(out, /note number 19/, "keeps the newest");
  assert.doesNotMatch(out, /note number 0\b/, "drops the oldest");
  assert.equal(out.match(/note number/g).length, 6);
});

test("a written root cause reaches the grader instead of collapsing to yes", () => {
  const spec = {
    widget: SPEC_KINDS.INCIDENT_LOG,
    manual: { unit: "defects", target: { value: 3, op: "<=" } },
  };
  const entries = [
    entry(
      {
        severity: "P2",
        downtime: 45,
        rca: "connection pool exhausted under retry storm",
        action: "added a circuit breaker and a pool ceiling",
        preventive: "closed",
      },
      Date.now(),
    ),
  ];

  const out = buildCurrentData(spec, entries, null, null);

  assert.match(out, /connection pool exhausted under retry storm/);
  assert.match(out, /added a circuit breaker and a pool ceiling/);
});

test("an undocumented defect says so in words the grader can act on", () => {
  const spec = { widget: SPEC_KINDS.INCIDENT_LOG, manual: { unit: "defects" } };
  const entries = [entry({ severity: "P3" }, Date.now())];

  const out = buildCurrentData(spec, entries, null, null);

  assert.match(out, /root cause: NOT DOCUMENTED/);
  assert.match(out, /corrective action: NOT DOCUMENTED/);
});

test("a legacy defect carrying only a link still reports a documented root cause", () => {
  const spec = { widget: SPEC_KINDS.INCIDENT_LOG, manual: { unit: "defects" } };
  const entries = [
    entry({ severity: "P1", link: "https://wiki.internal/postmortem/2026-03" }, Date.now()),
  ];

  const out = buildCurrentData(spec, entries, null, null);

  assert.match(out, /wiki\.internal\/postmortem\/2026-03/);
  assert.doesNotMatch(out, /root cause: NOT DOCUMENTED/);
});

test("reflections are graded on their text, not on how many there are", () => {
  const spec = { widget: SPEC_KINDS.FREE_TEXT };
  const entries = [
    entry("Ran the guild session on tracing; twelve attendees.", Date.UTC(2026, 1, 3)),
    entry("Wrote up the retry-storm incident and circulated it.", Date.UTC(2026, 1, 10)),
  ];

  const out = buildCurrentData(spec, entries, null, null);

  assert.match(out, /Ran the guild session on tracing/);
  assert.match(out, /Wrote up the retry-storm incident/);
});

test("an empty reflection log says nothing was logged rather than reporting zero", () => {
  const out = buildCurrentData({ widget: SPEC_KINDS.FREE_TEXT }, [], null, null);
  assert.match(out, /no reflections logged/);
});

test("a date log carries its dates, because its tiers are about when", () => {
  const spec = { widget: SPEC_KINDS.DATE_LOG };
  const entries = [
    entry("2026-02-03T00:00:00.000Z", Date.UTC(2026, 1, 3)),
    entry("2026-03-11T00:00:00.000Z", Date.UTC(2026, 2, 11)),
  ];

  const out = buildCurrentData(spec, entries, null, null);

  assert.match(out, /2026-02-03/);
  assert.match(out, /2026-03-11/);
  assert.doesNotMatch(out, /T00:00:00/, "the calendar day is the unit, not the instant");
});

test("a date log note survives alongside the date it explains", () => {
  const spec = { widget: SPEC_KINDS.DATE_LOG };
  const entries = [
    entry("2026-02-03T00:00:00.000Z", Date.UTC(2026, 1, 3), "signed off by the chapter lead"),
  ];

  const out = buildCurrentData(spec, entries, null, null);

  assert.match(out, /2026-02-03/);
  assert.match(out, /signed off by the chapter lead/);
});

test("prose is capped rather than dropped, so a long write-up still counts", () => {
  const spec = { widget: SPEC_KINDS.INCIDENT_LOG, manual: { unit: "defects" } };
  const entries = [entry({ severity: "P1", rca: "x".repeat(4000) }, Date.now())];

  const out = buildCurrentData(spec, entries, null, null);

  assert.ok(out.length < 1500, "one pasted post-mortem cannot dominate the prompt");
  assert.doesNotMatch(out, /root cause: NOT DOCUMENTED/);
  assert.match(out, /…/, "truncation is visible rather than silent");
});

// ── The manifest and the provenance caveat ────────────────────────────────
// Both were computed and then discarded before grading: evidence files were
// visible only to one component, and a sampled metric was handed over as
// though it were a census.

test("attached files reach the grader as a manifest, not as contents", () => {
  const out = evidenceManifestToText([
    {
      id: "a",
      name: "retry-storm-postmortem.pdf",
      size: 240_000,
      periodKey: "2026-Q1",
      uploadedAt: "2026-03-04T09:00:00.000Z",
    },
  ]);

  assert.match(out, /retry-storm-postmortem\.pdf/);
  assert.match(out, /2026-Q1/);
  assert.match(out, /2026-03-04/);
  assert.match(out, /MANIFEST, not the contents/, "the grader is told not to infer content");
});

test("no attachments renders nothing rather than an empty heading", () => {
  assert.equal(evidenceManifestToText([]), "");
  assert.equal(evidenceManifestToText(null), "");
});

test("the manifest is capped so a heavily-documented goal cannot flood the prompt", () => {
  const files = Array.from({ length: 40 }, (_, i) => ({
    id: String(i),
    name: `artifact-${i}.pdf`,
    size: 1000,
    periodKey: null,
    uploadedAt: "2026-03-04T09:00:00.000Z",
  }));

  const out = evidenceManifestToText(files);

  assert.match(out, /40 evidence file\(s\)/, "the true count is still stated");
  assert.equal(out.match(/artifact-/g).length, 12);
});

test("a truncated metric tells the grader it is a sample, not a shortfall", () => {
  const spec = { widget: "MERGED_COUNT" };
  const live = {
    value: "18 d median cycle",
    statusLabel: "below target",
    provenance: {
      sample: 50,
      unit: "tickets",
      window: "2026 YTD",
      truncated: true,
      note: "50 most recently updated; resolved over 90 days ago excluded",
    },
  };

  const out = buildCurrentData(spec, [], null, live);

  assert.match(out, /computed from 50 tickets/);
  assert.match(out, /2026 YTD/);
  assert.match(out, /do not treat a shortfall as proven/);
});

test("an untruncated metric states its basis without the sample warning", () => {
  const spec = { widget: "MERGED_COUNT" };
  const live = {
    value: "41 merged",
    statusLabel: "on target",
    provenance: { sample: 41, unit: "MRs", window: "2026 YTD" },
  };

  const out = buildCurrentData(spec, [], null, live);

  assert.match(out, /computed from 41 MRs/);
  assert.doesNotMatch(out, /PARTIAL/);
});
