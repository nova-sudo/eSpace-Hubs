"use client";

import { useMemo, useState } from "react";
import { WidgetShell } from "../widget-shell";
import { useGoalInputs } from "@/features/goal-inputs";
import { useGoalContext } from "@/features/goal-context";

/**
 * Milestone checklist.
 *
 * Three sources, in priority:
 *   1. The user's edits — `goal-inputs` latest entry's `items` array.
 *   2. The user's context answers — every `kind: "list"` answer the user
 *      gave to the AI's `context.questions` block flows in as milestones,
 *      flattened in question order. This is the "I just defined what done
 *      looks like, those should be my milestones" path.
 *   3. The AI-pre-seeded items in `spec.manual.items` — older specs that
 *      didn't go through context collection.
 *
 * Once the user toggles or adds, an entry is written; from then on, the
 * entries list owns the source of truth. If the user later wipes every
 * milestone (entries.items.length === 0), we fall back to the context
 * seed again — that way "edit truths" → "wipe list" → "save" is a clean
 * way to re-seed from the latest truths.
 */
export function MilestoneWidget({ spec, goal, variant = "light", className, onRetry }) {
  const { entries, latest, append } = useGoalInputs(goal?.id);
  const { answers: contextAnswers } = useGoalContext(goal?.id);
  const items = useMemo(
    () => resolveItems(latest, spec, contextAnswers),
    [latest, spec, contextAnswers],
  );
  const done = items.filter((i) => i.done).length;
  const total = items.length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  const [draft, setDraft] = useState("");
  const promptCopy = spec.manual?.prompt || "Check off milestones";

  function toggle(id) {
    const next = items.map((it) =>
      it.id === id ? { ...it, done: !it.done } : it,
    );
    append({ items: next });
  }

  function add() {
    const label = draft.trim();
    if (!label) return;
    const next = [
      ...items,
      { id: `m-${Date.now()}`, label, done: false },
    ];
    append({ items: next });
    setDraft("");
  }

  function remove(id) {
    const next = items.filter((i) => i.id !== id);
    append({ items: next });
  }

  return (
    <WidgetShell
      spec={spec}
      variant={variant}
      label={`Milestones · ${done}/${total}`}
      title={goal?.title || spec.title}
      onRetry={onRetry}
      className={className}
    >
      <div className="flex h-full flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <div
            className="font-semibold leading-none"
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 36,
              letterSpacing: "-1.2px",
            }}
          >
            {pct}%
          </div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              color: variant === "light" ? "rgba(255,255,255,0.72)" : "var(--muted-fg)",
            }}
          >
            complete
          </div>
        </div>
        <div
          className="h-1.5 w-full overflow-hidden rounded-full"
          style={{
            background:
              variant === "light" ? "rgba(255,255,255,0.18)" : "var(--border)",
          }}
        >
          <div
            className="h-full"
            style={{
              width: `${pct}%`,
              background: variant === "light" ? "#ffffff" : "var(--accent)",
            }}
          />
        </div>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: variant === "light" ? "rgba(255,255,255,0.68)" : "var(--muted-fg)",
          }}
        >
          {promptCopy}
        </div>
        <ul
          className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto"
          style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
        >
          {items.length === 0 ? (
            <li
              style={{
                color:
                  variant === "light" ? "rgba(255,255,255,0.5)" : "var(--dim-fg)",
              }}
            >
              No milestones yet.
            </li>
          ) : null}
          {items.map((it) => (
            <li key={it.id} className="group flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!it.done}
                onChange={() => toggle(it.id)}
                className="h-3.5 w-3.5"
              />
              <span
                className="flex-1 truncate"
                style={{
                  textDecoration: it.done ? "line-through" : "none",
                  color: it.done
                    ? variant === "light"
                      ? "rgba(255,255,255,0.5)"
                      : "var(--dim-fg)"
                    : "inherit",
                }}
                title={it.label}
              >
                {it.label}
              </span>
              <button
                type="button"
                onClick={() => remove(it.id)}
                className="opacity-0 transition-opacity group-hover:opacity-100"
                style={{
                  fontSize: 10,
                  color:
                    variant === "light"
                      ? "rgba(255,255,255,0.6)"
                      : "var(--dim-fg)",
                }}
                aria-label={`Remove ${it.label}`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
        {/* Input row — `min-w-0` on parent + child so the text input shrinks
            below its intrinsic width on narrow tiles. Button stays `shrink-0`. */}
        <div className="flex min-w-0 items-center gap-1.5">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            placeholder="+ Add milestone"
            className="min-w-0 flex-1 rounded-[var(--radius-sub)] bg-transparent px-2 py-1.5 outline-none"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: variant === "light" ? "#ffffff" : "var(--fg)",
              border:
                variant === "light"
                  ? "1px solid rgba(255,255,255,0.22)"
                  : "1px solid var(--border)",
            }}
          />
          <button
            type="button"
            onClick={add}
            disabled={!draft.trim()}
            className="shrink-0 rounded-[var(--radius-sub)] px-3 py-1.5 font-bold uppercase transition-opacity disabled:opacity-40"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              letterSpacing: "0.4px",
              background:
                variant === "light" ? "#ffffff" : "var(--accent)",
              color:
                variant === "light" ? "var(--accent)" : "var(--accent-on)",
            }}
          >
            Add
          </button>
        </div>
        {/* Footnote count */}
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 9.5,
            color:
              variant === "light" ? "rgba(255,255,255,0.55)" : "var(--dim-fg)",
          }}
        >
          {entries.length} revision{entries.length === 1 ? "" : "s"}
        </div>
      </div>
    </WidgetShell>
  );
}

function resolveItems(latestEntry, spec, contextAnswers) {
  // 1) User-owned list wins — anything the user has actually edited.
  const existing = latestEntry?.value?.items;
  if (Array.isArray(existing) && existing.length > 0) return existing;

  // 2) Otherwise, seed from the user's context list-answers (the user
  //    just defined "what counts" via the ContextCollector).
  const contextItems = collectListAnswers(spec, contextAnswers);
  if (contextItems.length > 0) {
    return contextItems.map((label, i) => ({
      id: `ctx-${i}`,
      label,
      done: false,
    }));
  }

  // 3) Final fallback — AI-pre-seeded items in the spec itself.
  const seed = spec.manual?.items || [];
  return seed.map((label, i) => ({
    id: `seed-${i}`,
    label,
    done: false,
  }));
}

/**
 * Pull every list-shaped or text-shaped context answer from a goal's
 * context and flatten the collected strings into a single de-duped
 * array, preserving question order.
 *
 * Accepts both:
 *   - `kind: "list"`  → answer is already string[]; flatten + dedupe.
 *   - `kind: "text"`  → answer is a single string; split on newlines so
 *                       a user who pasted multi-line milestones into a
 *                       single-line input (because the AI emitted
 *                       `kind: "text"` instead of `kind: "list"` for a
 *                       milestone-style question) still gets their
 *                       items materialised. Single-line text answers
 *                       become a one-item list.
 *
 * Why widen to `text`: the classifier occasionally picks `kind: "text"`
 * for "What are your X milestones?" style questions even though it
 * should pick `"list"`. Before this widening, the saved answer was
 * silently dropped by the widget (rendered as an empty checklist) and
 * the user saw "Save did nothing". Being defensive here matches the
 * permissive-on-shape stance the rest of the spec layer takes.
 *
 * Why dedupe: the user's two questions may share an item ("Documented
 * milestones" mentioned in both), and we don't want it to appear twice
 * in the checklist.
 */
function collectListAnswers(spec, answers) {
  if (!spec?.context?.questions || !answers) return [];
  const seen = new Set();
  const out = [];
  for (const q of spec.context.questions) {
    if (q.kind !== "list" && q.kind !== "text") continue;
    const raw = answers[q.id];
    const items =
      Array.isArray(raw)
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
