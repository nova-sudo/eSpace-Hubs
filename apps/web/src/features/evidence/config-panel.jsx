"use client";

import { Card, Checkbox, Field, Input, MonoLabel } from "@/components/ui";
import { cn } from "@/lib/cn";

const FORMATS = [
  ["markdown", "Markdown", ".md · paste-ready"],
  ["pdf", "PDF", ".pdf · print-ready"],
];

const RANGES = [
  ["30d", "Last 30d"],
  ["90d", "Last 90d"],
  ["q1", "Q1 2026"],
  ["custom", "Custom…"],
];

const SECTION_TOGGLES = [
  ["narrative", "Narrative intro"],
  ["metrics", "Headline metrics"],
  ["prs", "Merged PRs (starred)"],
  ["tickets", "Closed tickets (starred)"],
  ["reviews", "Notable reviews given"],
  ["goals", "Goal tracking (AI)"],
];

export function ConfigPanel({
  format,
  setFormat,
  range,
  setRange,
  level,
  setLevel,
  include,
  setInclude,
  rangeLabel,
}) {
  return (
    <div className="sticky top-20 flex flex-col gap-5">
      <Card className="p-5">
        <MonoLabel>Format</MonoLabel>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          {FORMATS.map(([v, l, s]) => (
            <button
              key={v}
              onClick={() => setFormat(v)}
              className={cn(
                "rounded-[var(--radius-sub)] border p-3 text-left transition-colors",
                format === v
                  ? "border-accent bg-accent-dim"
                  : "border-border bg-card-alt hover:border-border-strong",
              )}
            >
              <div className="mb-0.5 text-[13px] font-semibold text-fg">{l}</div>
              <div
                className="text-muted-fg"
                style={{ fontFamily: "var(--font-mono)", fontSize: 9.5 }}
              >
                {s}
              </div>
            </button>
          ))}
        </div>
      </Card>

      <Card className="p-5">
        <MonoLabel>Date range</MonoLabel>
        <div className="mt-2 grid grid-cols-2 gap-1">
          {RANGES.map(([v, l]) => (
            <button
              key={v}
              onClick={() => setRange(v)}
              className={cn(
                "cursor-pointer rounded-[var(--radius-sub)] border px-3 py-2 uppercase tracking-[0.3px]",
                range === v
                  ? "border-accent bg-accent-dim text-accent"
                  : "border-border bg-transparent text-fg hover:border-border-strong",
              )}
              style={{ fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600 }}
            >
              {l}
            </button>
          ))}
        </div>
        <div
          className="mt-2 uppercase tracking-[0.4px] text-dim-fg"
          style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
        >
          {rangeLabel}
        </div>
      </Card>

      <Card className="p-5">
        <MonoLabel>Performance cycle</MonoLabel>
        <div className="mt-2">
          <Input
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            placeholder="L1 → L2"
          />
        </div>
        <div className="mt-1.5 text-[11px] leading-[1.4] text-dim-fg">
          Appears as the header of the exported document. We don&apos;t read your level
          from anywhere.
        </div>
      </Card>

      <Card className="p-5">
        <MonoLabel>Sections</MonoLabel>
        <div className="mt-2.5 flex flex-col gap-1.5">
          {SECTION_TOGGLES.map(([id, label]) => (
            <label
              key={id}
              className="flex cursor-pointer items-center gap-2.5 py-1"
            >
              <Checkbox
                checked={include[id]}
                onChange={() => setInclude({ ...include, [id]: !include[id] })}
              />
              <span className="text-[12.5px]">{label}</span>
            </label>
          ))}
        </div>
      </Card>

      <div
        className="px-1 text-muted-fg"
        style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, lineHeight: 1.6 }}
      >
        <div className="mb-1 font-bold text-accent">PRIVACY · FIRST</div>
        This bundle is generated in your browser. Nothing is uploaded. You paste the
        output wherever you want it to go.
      </div>
    </div>
  );
}
