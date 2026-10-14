// Pure window-state helpers shared by every packet template. The `state`
// strings are the shared package's vocabulary (filled, settled, owed, current,
// future, before); a few aliases are accepted so older payloads still read.

const COMPLETE = new Set(["filled", "settled", "done", "complete", "met"]);
const MISSED = new Set(["owed", "missed"]);
const CURRENT = new Set(["current", "open"]);

export function classifyWindow(state) {
  if (COMPLETE.has(state)) return "complete";
  if (MISSED.has(state)) return "missed";
  if (CURRENT.has(state)) return "current";
  if (state === "future") return "future";
  if (state === "before") return "before";
  return "unknown";
}

const TINTS = {
  complete: { bg: "bg-mint", text: "text-mint-ink" },
  missed: { bg: "bg-peach", text: "text-peach-ink" },
  current: { bg: "bg-sky", text: "text-sky-ink" },
  future: { bg: "bg-card-alt", text: "text-muted-fg" },
  before: { bg: "bg-card-alt opacity-60", text: "text-muted-fg" },
  unknown: { bg: "bg-card-alt", text: "text-fg" },
};

/** Token class names for a window cell / dot. */
export function windowTint(state) {
  return TINTS[classifyWindow(state)];
}

/** Only complete and missed windows count as elapsed. */
export function windowSummary(windows) {
  const list = Array.isArray(windows) ? windows : [];
  let complete = 0;
  let missed = 0;
  for (const w of list) {
    const k = classifyWindow(w?.state);
    if (k === "complete") complete += 1;
    else if (k === "missed") missed += 1;
  }
  const elapsed = complete + missed;
  const text = elapsed
    ? `${complete} of ${elapsed} periods complete${missed ? `, ${missed} missed` : ""}`
    : "No periods elapsed yet";
  return { complete, missed, elapsed, total: list.length, text };
}
