/**
 * What a COMPOSED field is currently saying — pure, so the claim-and-proof
 * layout can be a dumb renderer and this can be tested without React.
 *
 * Three questions, one per export:
 *
 *   1. Is it answered?          `hasValue`
 *   2. Is it backed by proof?   `proofState`
 *   3. Does the answer meet the target the spec set? `meetsTarget`
 *
 * Question 2 is the one the redesign exists for. Evidence used to be a grey
 * line under every field, identical whether it held a link to a report or
 * nothing at all — so a tracker could read "5/5 captured" while carrying no
 * justification for any of it, and the tier grader (which folds `evidence`
 * into the data it judges) was left to judge bare booleans. Proof now has a
 * state with a name, and "owed" is the one the UI is allowed to nag about.
 *
 * `owed` is deliberately narrow: proof is owed only once a claim EXISTS, and
 * never on an optional field. Nagging for evidence of something the user
 * hasn't claimed yet is how a form teaches people to ignore its warnings.
 */

/**
 * Plain-English name for a field kind, shown beside the label so "what am I
 * being asked for" is answerable at a glance — today's form gives a link
 * field, a note field and a repo-read field the identical appearance.
 *
 * Sentence case, never mono: per docs/design-system-v2.md, JetBrains Mono is
 * for goal codes and commit hashes, not for labels. Lives here rather than in
 * the renderer because the compose preview names the same kinds, and a second
 * copy is a second thing to forget to update.
 */
export const FIELD_KIND_HINT = Object.freeze({
  checkbox: "yes / no",
  counter: "count",
  scale: "1–5",
  number: "number",
  text: "note",
  date: "date",
  select: "choice",
  link: "link",
});

/** Pretty operator for a `target` ({op, value}) — "≤ 30" reads, "<= 30" is code. */
export const TARGET_OP_LABEL = Object.freeze({ "<=": "≤", ">=": "≥", "=": "=" });

/** A field whose value is read from a provider rather than typed. */
export function isAutoField(f) {
  return !!(f && f.source && typeof f.source === "object" && f.source.query);
}

/** Is this field answered? A checkbox only counts when it's actually ticked. */
export function hasValue(v, kind) {
  if (kind === "checkbox") return v === true;
  return v != null && v !== "";
}

export const PROOF = Object.freeze({
  /** Read from a repo — the provenance IS the proof, and it isn't the user's to supply. */
  AUTO: "auto",
  /** A link field: the link the user pasted is itself the evidence. */
  NA: "na",
  /** Evidence is attached. */
  HAS: "has",
  /** A claim with nothing behind it — the state worth surfacing. */
  OWED: "owed",
  /** Nothing claimed yet (or optional), so nothing is owed. */
  IDLE: "idle",
});

export function proofState({ field, value, evidence }) {
  if (isAutoField(field)) return PROOF.AUTO;
  if (field?.kind === "link") return PROOF.NA;
  if (typeof evidence === "string" && evidence.trim()) return PROOF.HAS;
  if (hasValue(value, field?.kind) && !field?.optional) return PROOF.OWED;
  return PROOF.IDLE;
}

/**
 * Does the answer satisfy `field.target` ({op, value})? Display-only — the
 * grader has its own numeric path (goal-tiers/grade-numeric). False for an
 * unparseable value, so a half-typed "2" on the way to "20" reads as "not
 * yet", never as a failure.
 */
export function meetsTarget(target, value) {
  if (!target || typeof target !== "object") return false;
  // Guard the empty string BEFORE Number(), which turns it into 0 — and 0
  // satisfies every "<=" target, so an untouched field would otherwise render
  // a mint "meets ≤ 30" badge for a measurement nobody has taken.
  if (value == null || (typeof value === "string" && !value.trim())) return false;
  const n = Number(value);
  const t = Number(target.value);
  if (!Number.isFinite(n) || !Number.isFinite(t)) return false;
  if (target.op === ">=") return n >= t;
  if (target.op === "<=") return n <= t;
  if (target.op === "=") return n === t;
  return false;
}

/**
 * The headline counts: how much of this period is answered, and how much of
 * what CAN carry proof actually does.
 *
 * `proofable` excludes auto and link fields on purpose — counting fields the
 * user was never asked to justify would make the ratio unreachable, and a
 * number nobody can move is a number nobody reads.
 *
 * @param {object} a
 * @param {Array} a.fields
 * @param {object} a.values     periodKey-scoped values map
 * @param {object} a.evidence   periodKey-scoped evidence map
 * @param {object} a.auto       resolved readings by field id ({value,…})
 */
export function summarizeFields({ fields, values, evidence, auto }) {
  const list = Array.isArray(fields) ? fields : [];
  const v = values || {};
  const e = evidence || {};
  const a = auto || {};
  let answered = 0;
  let proofable = 0;
  let withProof = 0;
  let owed = 0;

  for (const f of list) {
    if (isAutoField(f)) {
      if (a[f.id]?.value != null) answered += 1;
      continue;
    }
    if (hasValue(v[f.id], f.kind)) answered += 1;
    const state = proofState({ field: f, value: v[f.id], evidence: e[f.id] });
    if (state === PROOF.NA) continue;
    proofable += 1;
    if (state === PROOF.HAS) withProof += 1;
    if (state === PROOF.OWED) owed += 1;
  }

  return { answered, total: list.length, proofable, withProof, owed };
}
