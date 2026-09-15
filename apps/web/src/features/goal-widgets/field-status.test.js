import test from "node:test";
import assert from "node:assert/strict";

import {
  PROOF,
  hasValue,
  isAutoField,
  meetsTarget,
  proofState,
  summarizeFields,
} from "./field-status.js";

/**
 * The claim-and-proof form is graded on one rule above all: proof is OWED
 * only once a claim exists, and never on an optional field. A form that asks
 * for evidence of something nobody claimed yet trains people to ignore it,
 * which is exactly what the old undifferentiated grey note line achieved.
 */

const text = { id: "notes", kind: "text", label: "Notes" };
const check = { id: "done", kind: "checkbox", label: "Done" };
const link = { id: "report", kind: "link", label: "Report link" };
const auto = {
  id: "runbook",
  kind: "text",
  label: "Runbook present",
  source: { provider: "github", query: "repo_file_exists" },
};

// ─── hasValue ────────────────────────────────────────────────────────

test("a checkbox is answered only when ticked", () => {
  assert.equal(hasValue(true, "checkbox"), true);
  assert.equal(hasValue(false, "checkbox"), false);
  // A number 0 and an empty string are different answers.
  assert.equal(hasValue(0, "number"), true);
  assert.equal(hasValue("", "text"), false);
  assert.equal(hasValue(null, "text"), false);
});

// ─── proofState ──────────────────────────────────────────────────────

test("a claim with nothing behind it owes proof", () => {
  assert.equal(proofState({ field: text, value: "shipped it", evidence: "" }), PROOF.OWED);
  assert.equal(proofState({ field: check, value: true, evidence: undefined }), PROOF.OWED);
});

test("an unanswered field owes nothing — nagging before a claim is noise", () => {
  assert.equal(proofState({ field: text, value: "", evidence: "" }), PROOF.IDLE);
  assert.equal(proofState({ field: check, value: false, evidence: "" }), PROOF.IDLE);
});

test("an optional field never owes proof, answered or not", () => {
  const opt = { ...check, optional: true };
  assert.equal(proofState({ field: opt, value: true, evidence: "" }), PROOF.IDLE);
});

test("attached evidence reads as backed, and whitespace is not evidence", () => {
  assert.equal(proofState({ field: text, value: "x", evidence: "PR 412" }), PROOF.HAS);
  assert.equal(proofState({ field: text, value: "x", evidence: "   " }), PROOF.OWED);
});

test("a link field is its own evidence, and an auto field is the repo's", () => {
  assert.equal(proofState({ field: link, value: "https://x.dev", evidence: "" }), PROOF.NA);
  assert.equal(proofState({ field: auto, value: "Present", evidence: "" }), PROOF.AUTO);
  assert.equal(isAutoField(auto), true);
  assert.equal(isAutoField(text), false);
});

// ─── meetsTarget ─────────────────────────────────────────────────────

test("targets evaluate per operator", () => {
  assert.equal(meetsTarget({ op: "<=", value: 30 }, "20"), true);
  assert.equal(meetsTarget({ op: "<=", value: 30 }, "31"), false);
  assert.equal(meetsTarget({ op: ">=", value: 5 }, 5), true);
  assert.equal(meetsTarget({ op: "=", value: 3 }, "3"), true);
  assert.equal(meetsTarget({ op: "=", value: 3 }, "4"), false);
});

test("a half-typed or missing number reads as not-yet, never as failure", () => {
  assert.equal(meetsTarget({ op: "<=", value: 30 }, ""), false);
  assert.equal(meetsTarget({ op: "<=", value: 30 }, "abc"), false);
  assert.equal(meetsTarget(null, "20"), false);
  assert.equal(meetsTarget({ op: "~", value: 3 }, "3"), false);
});

// ─── summarizeFields ─────────────────────────────────────────────────

test("the headline counts answers and proof separately", () => {
  const s = summarizeFields({
    fields: [check, text, link, auto],
    values: { done: true, notes: "ran the drill", report: "https://x.dev" },
    evidence: { done: "screenshot in the wiki" },
    auto: { runbook: { value: "Present" } },
  });
  assert.equal(s.total, 4);
  assert.equal(s.answered, 4, "auto counts as answered when the repo replied");
  assert.equal(s.proofable, 2, "link and auto are excluded — they carry their own");
  assert.equal(s.withProof, 1);
  assert.equal(s.owed, 1, "the notes field claims something with nothing behind it");
});

test("an auto field that hasn't resolved is not answered", () => {
  const s = summarizeFields({ fields: [auto], values: {}, evidence: {}, auto: {} });
  assert.equal(s.answered, 0);
  assert.equal(s.proofable, 0);
});

test("an empty period owes nothing", () => {
  const s = summarizeFields({ fields: [check, text], values: {}, evidence: {}, auto: {} });
  assert.deepEqual(s, { answered: 0, total: 2, proofable: 2, withProof: 0, owed: 0 });
});

test("missing maps are tolerated", () => {
  assert.deepEqual(summarizeFields({}), {
    answered: 0,
    total: 0,
    proofable: 0,
    withProof: 0,
    owed: 0,
  });
});
