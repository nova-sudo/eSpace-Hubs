"use client";

import { useState } from "react";
import { WidgetShell } from "../widget-shell";
import { useGoalInputs } from "@/features/goal-inputs";
import { fullDate } from "@/lib/date";

/**
 * "Date log" — pin a date (past or future) against an optional note.
 * Example goals: "Publish 2 tech-talks this year". Each talk is a date-entry.
 */
export function DateLogWidget({ spec, goal, variant = "light", className, onRetry }) {
  const { entries, append, remove } = useGoalInputs(goal?.id);
  const [date, setDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [note, setNote] = useState("");

  function logEntry() {
    if (!date) return;
    const t = new Date(date);
    if (Number.isNaN(t.getTime())) return;
    append(t.toISOString(), note || undefined);
    setNote("");
  }

  const target = spec.manual?.target;
  const reachedTarget =
    target && target.op === ">=" ? entries.length >= target.value : null;

  return (
    <WidgetShell
      spec={spec}
      variant={variant}
      label={`Date log · ${entries.length} entries`}
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
              fontSize: 44,
              letterSpacing: "-1.5px",
            }}
          >
            {entries.length}
          </div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: variant === "light" ? "rgba(255,255,255,0.72)" : "var(--muted-fg)",
            }}
          >
            {spec.manual?.unit || "events"}
            {target ? ` · target ${target.op} ${target.value}` : ""}
            {reachedTarget ? " · ✓" : ""}
          </div>
        </div>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: variant === "light" ? "rgba(255,255,255,0.68)" : "var(--muted-fg)",
          }}
        >
          {spec.manual?.prompt || "Log dated events"}
        </div>
        {/* Input row.
            Native <input type="date"> has a chunky intrinsic width
            (~150px in Chrome) and the <input> "note" wants to grow.
            Without `min-w-0` on this flex row AND `min-w-0` on each
            shrinkable child, the row pushes wider than the card and the
            tile clips. The button stays `shrink-0` so it always shows. */}
        <div className="flex min-w-0 items-center gap-1.5">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="min-w-0 flex-1 rounded-[var(--radius-sub)] bg-transparent px-2 py-1.5 outline-none"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: variant === "light" ? "#ffffff" : "var(--fg)",
              border:
                variant === "light"
                  ? "1px solid rgba(255,255,255,0.25)"
                  : "1px solid var(--border-strong)",
              colorScheme: variant === "light" ? "dark" : "light",
            }}
          />
          <input
            placeholder="note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="min-w-0 flex-1 rounded-[var(--radius-sub)] bg-transparent px-2 py-1.5 outline-none"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: variant === "light" ? "#ffffff" : "var(--fg)",
              border:
                variant === "light"
                  ? "1px solid rgba(255,255,255,0.22)"
                  : "1px solid var(--border-strong)",
            }}
          />
          <button
            type="button"
            onClick={logEntry}
            className="shrink-0 rounded-[var(--radius-sub)] px-3 py-1.5 font-bold uppercase"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              letterSpacing: "0.4px",
              background: variant === "light" ? "#ffffff" : "var(--accent)",
              color:
                variant === "light" ? "var(--accent)" : "var(--accent-on)",
            }}
          >
            Log
          </button>
        </div>
        <ul
          className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-1"
          style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
        >
          {entries.slice().reverse().map((e) => (
            <li
              key={e.ts}
              className="group flex items-center gap-2 rounded-[var(--radius-sub)] px-1.5 py-1"
              style={{
                background:
                  variant === "light"
                    ? "rgba(255,255,255,0.06)"
                    : "var(--card-alt)",
              }}
            >
              <span className="shrink-0 font-semibold">
                {fullDate(e.value)}
              </span>
              <span
                className="flex-1 truncate"
                style={{
                  color:
                    variant === "light"
                      ? "rgba(255,255,255,0.78)"
                      : "var(--muted-fg)",
                }}
              >
                {e.note || "—"}
              </span>
              <button
                type="button"
                onClick={() => remove(e.ts)}
                className="opacity-0 transition-opacity group-hover:opacity-100"
                style={{
                  fontSize: 10,
                  color:
                    variant === "light"
                      ? "rgba(255,255,255,0.5)"
                      : "var(--dim-fg)",
                }}
                aria-label="Remove"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      </div>
    </WidgetShell>
  );
}
