/**
 * GoalInput — a single time-series entry logged against a goal's manual
 * widget.
 *
 * Shape:
 *   {
 *     goalId: string,
 *     ts:     number,             // epoch ms — append time; also the primary key
 *     value:  number | string | boolean | object,
 *                                 // widget-interpreted. Keep primitive where possible.
 *     note?:  string,             // optional free-text, up to 500 chars
 *   }
 *
 * The store is append-only in normal use. `value` is typed loosely because
 * different manual widgets store different things (number for Counter,
 * 1-5 for Scale, checkbox map for Milestone, etc). Each widget's
 * interpretation is documented in its own file.
 */

function isPrimitiveValue(v) {
  if (v === null) return false;
  const t = typeof v;
  if (t === "number") return Number.isFinite(v);
  if (t === "string") return v.length <= 2000;
  if (t === "boolean") return true;
  // Plain objects are allowed — e.g. MilestoneWidget stores a checked-map.
  return t === "object" && !Array.isArray(v) ? true : Array.isArray(v);
}

export function validateInput(entry) {
  const errors = [];
  if (!entry || typeof entry !== "object") {
    return { ok: false, errors: ["entry: must be an object"] };
  }
  if (typeof entry.goalId !== "string" || entry.goalId.trim() === "") {
    errors.push("goalId: required string");
  }
  if (typeof entry.ts !== "number" || !Number.isFinite(entry.ts) || entry.ts <= 0) {
    errors.push("ts: required positive number");
  }
  if (entry.value === undefined) {
    errors.push("value: required");
  } else if (!isPrimitiveValue(entry.value)) {
    errors.push("value: must be a primitive or plain object/array");
  }
  if (entry.note != null && typeof entry.note !== "string") {
    errors.push("note: must be a string when present");
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    entry: {
      goalId: entry.goalId.trim(),
      ts: entry.ts,
      value: entry.value,
      note: entry.note ? entry.note.slice(0, 500) : undefined,
    },
  };
}
