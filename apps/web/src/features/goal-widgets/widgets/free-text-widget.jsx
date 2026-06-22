"use client";

import { useState } from "react";
import { WidgetShell } from "../widget-shell";
import { useGoalInputs } from "@/features/goal-inputs";
import { fullDate } from "@/lib/date";

/**
 * Free-text journal. Each entry is a dated note the user writes. Useful
 * for goals that are narrative in nature (e.g. "write 1 insight per week").
 */
export function FreeTextWidget({ spec, goal, variant = "light", className, onRetry }) {
  const { entries, append, remove } = useGoalInputs(goal?.id);
  const [draft, setDraft] = useState("");

  function submit() {
    const body = draft.trim();
    if (!body) return;
    append(body);
    setDraft("");
  }

  return (
    <WidgetShell
      spec={spec}
      variant={variant}
      label={`Journal · ${entries.length} entries`}
      title={goal?.title || spec.title}
      onRetry={onRetry}
      className={className}
    >
      <div className="flex h-full flex-col gap-2">
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: variant === "light" ? "rgba(255,255,255,0.72)" : "var(--muted-fg)",
          }}
        >
          {spec.manual?.prompt || "Capture a short note"}
        </div>
        <ul
          className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-1"
          style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
        >
          {entries.length === 0 ? (
            <li
              style={{
                color:
                  variant === "light" ? "rgba(255,255,255,0.5)" : "var(--dim-fg)",
              }}
            >
              No entries yet.
            </li>
          ) : null}
          {entries.slice().reverse().map((e) => (
            <li
              key={e.ts}
              className="group flex flex-col gap-0.5 rounded-[var(--radius-sub)] px-2 py-1.5"
              style={{
                background:
                  variant === "light"
                    ? "rgba(255,255,255,0.06)"
                    : "var(--card-alt)",
              }}
            >
              <div className="flex items-center justify-between">
                <span
                  style={{
                    color:
                      variant === "light"
                        ? "rgba(255,255,255,0.6)"
                        : "var(--muted-fg)",
                    fontSize: 10,
                  }}
                >
                  {fullDate(new Date(e.ts).toISOString())}
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
              </div>
              <div
                style={{
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  color:
                    variant === "light"
                      ? "rgba(255,255,255,0.88)"
                      : "var(--fg)",
                }}
              >
                {String(e.value)}
              </div>
            </li>
          ))}
        </ul>
        <div className="flex items-end gap-1.5">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Write a short note…"
            rows={1}
            className="max-h-[100px] min-h-[36px] flex-1 resize-none rounded-[var(--radius-sub)] bg-transparent px-2 py-1.5 outline-none"
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
            onClick={submit}
            disabled={!draft.trim()}
            className="rounded-[var(--radius-sub)] px-3 py-1.5 font-bold uppercase transition-opacity disabled:opacity-40"
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
      </div>
    </WidgetShell>
  );
}
