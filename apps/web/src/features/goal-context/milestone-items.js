/**
 * Shared milestone-checklist resolver — the SINGLE source of truth for "which
 * items does this milestone show?", used by every surface that renders one:
 * the Goals-page widgets (MilestoneWidget / RecurringMilestoneWidget) and the
 * check-in editors (MilestoneEditor / RecurringMilestoneEditor).
 *
 * Why this lives here and is shared: the surfaces used to each resolve items
 * their own way, so the Goals page and check-in could show DIFFERENT lists for
 * the same goal — the user answered context questions, the widget re-seeded
 * from those answers, but check-in kept showing the AI's original seed. One
 * resolver, imported everywhere, makes that class of bug impossible.
 *
 * Priority (highest first):
 *   1. The stored entry's items — anything the user has actually edited
 *      (toggled, added, removed). The user OWNS the list once they touch it.
 *   2. The user's context `list`/`text` answers — "I just defined what counts"
 *      via the ContextCollector. Flattened in question order, de-duped.
 *   3. The AI-pre-seeded `spec.manual.items` — older specs that never went
 *      through context collection.
 *
 * `reseedOnEmpty` controls what an EMPTY stored list means:
 *   - false (default, recurring): an empty period entry stays empty — wiping a
 *     period's items is a deliberate "nothing this period", not a reset.
 *   - true (one-time milestone): an empty list falls back to the context seed,
 *     so "edit truths → wipe list → save" cleanly re-seeds from the latest
 *     truths. Matches the original MilestoneWidget behaviour.
 *
 * Pure — no React, no IO. Pass `storedItems` (the relevant entry's
 * `value.items`, or null/undefined) + the spec + the goal's context answers.
 */

const seedLabel = (it) => (typeof it === "string" ? it : it?.label ?? String(it));

export function resolveMilestoneItems(
  storedItems,
  spec,
  answers,
  { reseedOnEmpty = false } = {},
) {
  const stored = Array.isArray(storedItems) ? storedItems : null;
  if (stored && (reseedOnEmpty ? stored.length > 0 : true)) {
    return stored;
  }

  const contextItems = collectListAnswers(spec, answers);
  if (contextItems.length > 0) {
    return contextItems.map((label, i) => ({ id: `ctx-${i}`, label, done: false }));
  }

  const seed = Array.isArray(spec?.manual?.items) ? spec.manual.items : [];
  return seed.map((it, i) => ({ id: `seed-${i}`, label: seedLabel(it), done: false }));
}

/**
 * Pull every `list`- or `text`-shaped context answer from a goal's context and
 * flatten the strings into one de-duped array, preserving question order.
 *
 *   - `kind: "list"` → answer is already string[]; flatten + dedupe.
 *   - `kind: "text"` → answer is one string; split on newlines so a user who
 *     pasted multi-line milestones into a single-line input (because the AI
 *     emitted `kind: "text"` for a milestone-style question) still gets their
 *     items materialised instead of a silently-empty checklist.
 *
 * De-dupe because two questions may share an item and we don't want it twice.
 */
export function collectListAnswers(spec, answers) {
  if (!spec?.context?.questions || !answers) return [];
  const seen = new Set();
  const out = [];
  for (const q of spec.context.questions) {
    if (q.kind !== "list" && q.kind !== "text") continue;
    const raw = answers[q.id];
    const items = Array.isArray(raw)
      ? raw
      : typeof raw === "string"
        ? raw.split(/\r?\n/)
        : [];
    for (const r of items) {
      const label = typeof r === "string" ? r.trim() : "";
      if (!label || seen.has(label)) continue;
      seen.add(label);
      out.push(label);
    }
  }
  return out;
}
