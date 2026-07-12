"use client";

/**
 * Focus carousel — pages through the priority-sorted attention queue one goal
 * at a time. `queue` is severity-sorted (queue[0] = most-slipping), so the
 * carousel opens on the top priority and you step DOWN the order. Keeps the
 * "one thing at a time" calm of the Focus hero while letting you reach
 * everything that needs you without dropping to the full board.
 *
 * Presentation only — each card is pre-derived by useGoalHealth. Replaces the
 * old single-hero + "Also needs attention" list (the carousel subsumes both).
 */

import { useState } from "react";
import { FocusHero } from "./focus-hero";

const mono = { fontFamily: "var(--font-mono)" };

function NavArrow({ dir, disabled, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={dir === "prev" ? "Higher priority" : "Next priority"}
      className="grid h-7 w-7 place-items-center rounded-full transition-colors disabled:opacity-30"
      style={{
        border: "1px solid var(--border-strong)",
        color: "var(--fg)",
        background: "transparent",
        cursor: disabled ? "default" : "pointer",
      }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {dir === "prev" ? <path d="M15 6l-6 6 6 6" /> : <path d="M9 6l6 6-6 6" />}
      </svg>
    </button>
  );
}

export function FocusCarousel({ queue, week }) {
  const [index, setIndex] = useState(0);
  if (!Array.isArray(queue) || queue.length === 0) return null;

  // Clamp: filling/settling the current goal drops it from the queue, which
  // reindexes — keep the pointer in range so the carousel lands on the goal
  // that slid into this slot instead of going blank.
  const safe = Math.min(index, queue.length - 1);
  const card = queue[safe];
  const count = queue.length;
  const go = (next) => setIndex(Math.max(0, Math.min(count - 1, next)));

  return (
    <div>
      <div className="mb-3 flex items-center justify-between border-b border-border pb-2.5">
        <span className="uppercase tracking-[2px] text-muted-fg" style={{ ...mono, fontSize: 10 }}>
          Needs you · {String(safe + 1).padStart(2, "0")} / {String(count).padStart(2, "0")}
        </span>
        {count > 1 ? (
          <div className="flex items-center gap-2">
            <NavArrow dir="prev" disabled={safe === 0} onClick={() => go(safe - 1)} />
            <NavArrow dir="next" disabled={safe === count - 1} onClick={() => go(safe + 1)} />
          </div>
        ) : null}
      </div>

      {/* key by goal id → remount on navigate so the hero's inline editor never
          carries an open/expanded state onto the next goal. */}
      <FocusHero key={card.goal.id} card={card} week={week} />

      {count > 1 ? (
        <div className="mt-3.5 flex flex-wrap items-center justify-center gap-1.5">
          {queue.map((c, i) => (
            <button
              key={c.goal.id}
              type="button"
              onClick={() => go(i)}
              aria-label={`Priority ${i + 1}: ${c.goal.title}`}
              aria-current={i === safe ? "true" : undefined}
              title={`${String(i + 1).padStart(2, "0")} · ${c.goal.title}`}
              className="h-2 rounded-full transition-all"
              style={{
                width: i === safe ? 20 : 8,
                background: i === safe ? "var(--accent)" : "var(--dot-dim)",
                cursor: "pointer",
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
