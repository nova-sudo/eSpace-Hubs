import test from "node:test";
import assert from "node:assert/strict";

import {
  EVIDENCE_STATE,
  cycleEvidence,
  isActionable,
  requiresEvidence,
  windowEvidenceState,
  cycleEvidenceToText,
} from "./evidence-freshness.js";

const T = (iso) => new Date(iso).getTime();
const NOW = T("2026-08-15T00:00:00Z");

const Q = (n, label) => ({
  key: `2026-Q${n}`,
  label: label || `Q${n}`,
  start: T(`2026-${String((n - 1) * 3 + 1).padStart(2, "0")}-01T00:00:00Z`),
  end: T(n === 4 ? "2027-01-01T00:00:00Z" : `2026-${String(n * 3 + 1).padStart(2, "0")}-01T00:00:00Z`),
  state: "filled",
});

const REQUIRED = { evidence: { requiredPerPeriod: true } };
const file = (periodKey, uploadedAt) => ({ periodKey, uploadedAt });

test("evidence is opt-in, so a goal that never asked for it is unaffected", () => {
  assert.equal(requiresEvidence({}), false);
  assert.equal(requiresEvidence(null), false);
  assert.equal(requiresEvidence(REQUIRED), true);

  const out = cycleEvidence({ windows: [Q(1), Q(2)] }, { spec: {}, now: NOW });
  assert.equal(out.required, false);
  assert.equal(out.pct, null);
  assert.equal(out.worst, EVIDENCE_STATE.NOT_REQUIRED);
});

test("a closed window with nothing attached is missing", () => {
  const state = windowEvidenceState(Q(1), { required: true, files: [], now: NOW });
  assert.equal(state, EVIDENCE_STATE.MISSING);
});

test("the open window is pending, never missing", () => {
  // Q3 contains 15 August, so it has not closed.
  const state = windowEvidenceState(Q(3), { required: true, files: [], now: NOW });
  assert.equal(
    state,
    EVIDENCE_STATE.PENDING,
    "evidence for a period still running is not late, it is not yet due",
  );
});

test("a window that has not opened is future", () => {
  const state = windowEvidenceState(Q(4), { required: true, files: [], now: NOW });
  assert.equal(state, EVIDENCE_STATE.FUTURE);
});

test("a file pinned to the window evidences it", () => {
  const state = windowEvidenceState(Q(1), {
    required: true,
    files: [file("2026-Q1", "2026-02-10T00:00:00Z")],
    now: NOW,
  });
  assert.equal(state, EVIDENCE_STATE.ATTACHED);
});

test("one artifact carried across quarters reads as stale, not as evidenced", () => {
  // Uploaded during Q1, then pinned to Q2 as well.
  const carried = file("2026-Q2", "2026-01-20T00:00:00Z");

  assert.equal(
    windowEvidenceState(Q(2), { required: true, files: [carried], now: NOW }),
    EVIDENCE_STATE.STALE,
    "nothing is missing, so no nag would ever fire — which is the failure",
  );
});

test("written proof on an entry counts, not just uploads", () => {
  const state = windowEvidenceState(Q(1), {
    required: true,
    files: [],
    entryEvidence: [{ periodKey: "2026-Q1", at: T("2026-02-01T00:00:00Z") }],
    now: NOW,
  });
  assert.equal(state, EVIDENCE_STATE.ATTACHED, "a linked PR is evidence just as much as a PDF");
});

test("an undated item gets the benefit of the doubt rather than being called stale", () => {
  const state = windowEvidenceState(Q(2), {
    required: true,
    files: [file("2026-Q2", null)],
    now: NOW,
  });
  assert.equal(
    state,
    EVIDENCE_STATE.ATTACHED,
    "older uploads must not be punished for a field they predate",
  );
});

test("the rollup takes the weakest window and counts the rest", () => {
  const out = cycleEvidence(
    { windows: [Q(1), Q(2), Q(3), Q(4)] },
    {
      spec: REQUIRED,
      files: [
        file("2026-Q1", "2026-02-10T00:00:00Z"), // attached
        file("2026-Q2", "2026-01-20T00:00:00Z"), // carried over → stale
      ],
      now: NOW,
    },
  );

  assert.equal(out.attached, 1);
  assert.equal(out.stale, 1);
  assert.equal(out.pending, 1, "Q3 is open");
  assert.equal(out.missing, 0);
  assert.equal(out.worst, EVIDENCE_STATE.STALE);
  assert.equal(out.label, "Carried over");
});

test("a missing window outranks a stale one in the rollup", () => {
  const out = cycleEvidence(
    { windows: [Q(1), Q(2)] },
    { spec: REQUIRED, files: [file("2026-Q2", "2026-01-20T00:00:00Z")], now: NOW },
  );
  assert.equal(out.missing, 1);
  assert.equal(out.stale, 1);
  assert.equal(out.worst, EVIDENCE_STATE.MISSING);
});

test("the percentage excludes windows that are not due yet", () => {
  const out = cycleEvidence(
    { windows: [Q(1), Q(2), Q(3), Q(4)] },
    {
      spec: REQUIRED,
      files: [file("2026-Q1", "2026-02-10T00:00:00Z"), file("2026-Q2", "2026-05-10T00:00:00Z")],
      now: NOW,
    },
  );

  // Q4 is future and excluded; Q1, Q2 attached, Q3 pending → 2 of 3.
  assert.equal(out.pct, 67);
});

test("a cycle with nothing due yet reports no percentage rather than zero", () => {
  const out = cycleEvidence({ windows: [Q(4)] }, { spec: REQUIRED, files: [], now: NOW });
  assert.equal(out.pct, null, "0% on a cycle that has not started is an accusation, not a measure");
});

test("only missing and stale are things a person can act on", () => {
  assert.equal(isActionable(EVIDENCE_STATE.MISSING), true);
  assert.equal(isActionable(EVIDENCE_STATE.STALE), true);
  assert.equal(isActionable(EVIDENCE_STATE.PENDING), false);
  assert.equal(isActionable(EVIDENCE_STATE.ATTACHED), false);
  assert.equal(isActionable(EVIDENCE_STATE.FUTURE), false);
});

// ── What the grader is told ───────────────────────────────────────────────

test("a goal that never asked for evidence says nothing to the grader", () => {
  const summary = cycleEvidence({ windows: [Q(1)] }, { spec: {}, now: NOW });
  assert.equal(cycleEvidenceToText(summary), "");
  assert.equal(cycleEvidenceToText(null), "");
});

test("the coverage line states the split rather than a bare percentage", () => {
  const summary = cycleEvidence(
    { windows: [Q(1), Q(2)] },
    { spec: REQUIRED, files: [file("2026-Q1", "2026-02-10T00:00:00Z")], now: NOW },
  );

  const text = cycleEvidenceToText(summary);
  assert.match(text, /1 evidenced/);
  assert.match(text, /1 with no evidence/);
});

test("the grader is warned not to read a missing attachment as missing work", () => {
  const summary = cycleEvidence({ windows: [Q(1)] }, { spec: REQUIRED, files: [], now: NOW });
  const text = cycleEvidenceToText(summary);

  assert.match(text, /absence of an attachment is not evidence of absence of work/);
  assert.match(text, /Do not lower the tier for it/);
});

test("a carried-over period is described as unevidenced, not as dishonest", () => {
  const summary = cycleEvidence(
    { windows: [Q(2)] },
    { spec: REQUIRED, files: [file("2026-Q2", "2026-01-20T00:00:00Z")], now: NOW },
  );

  const text = cycleEvidenceToText(summary);
  assert.match(text, /carried over/);
  assert.match(text, /not as dishonest/);
});
