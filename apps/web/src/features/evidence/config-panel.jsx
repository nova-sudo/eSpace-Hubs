"use client";

import { Card } from "@/components/ui";

const FORMATS = [
  ["markdown", ".md"],
  ["pdf", ".pdf"],
];

const RANGES = [
  ["30d", "30d"],
  ["90d", "90d"],
  ["q1", "Q1"],
];

const SECTION_TOGGLES = [
  ["narrative", "Narrative"],
  ["metrics", "Metrics"],
  ["prs", "Pull requests"],
  ["tickets", "Tickets"],
  ["reviews", "Reviews given"],
  ["goals", "Goal readings"],
];

/** Mono micro-label used for each field group inside the config card. */
function FieldLabel({ children }) {
  return (
    <div
      className="uppercase text-dim-fg"
      style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "1px" }}
    >
      {children}
    </div>
  );
}

/** A single segmented-control cell. Active cell fills with the accent. */
function Seg({ active, accentFill, onClick, children }) {
  const base = {
    flex: 1,
    textAlign: "center",
    cursor: "pointer",
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    textTransform: "uppercase",
    borderRadius: 5,
    padding: "8px",
    transition: "background .15s ease, border-color .15s ease, color .15s ease",
  };
  let style;
  if (active && accentFill) {
    // .md format / solid-accent cell — white text on accent.
    style = { ...base, color: "var(--accent-on)", background: "var(--accent)", border: "1px solid var(--accent)" };
  } else if (active) {
    // range cell — tinted accent wash, accent border.
    style = { ...base, color: "var(--fg)", background: "var(--accent-dim)", border: "1px solid var(--accent)" };
  } else {
    style = { ...base, color: "var(--muted-fg)", background: "transparent", border: "1px solid var(--border)" };
  }
  return (
    <button type="button" onClick={onClick} style={style}>
      {children}
    </button>
  );
}

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
    <div className="sticky top-20 flex flex-col gap-4">
      <Card className="p-[18px]">
        <div
          className="mb-3.5 uppercase text-muted-fg"
          style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "2px" }}
        >
          Configure bundle
        </div>

        <FieldLabel>Format</FieldLabel>
        <div className="mb-4 mt-[7px] flex gap-1.5">
          {FORMATS.map(([v, l]) => (
            <Seg
              key={v}
              active={format === v}
              accentFill
              onClick={() => setFormat(v)}
            >
              {l}
            </Seg>
          ))}
        </div>

        <FieldLabel>Range</FieldLabel>
        <div className="mb-4 mt-[7px] flex gap-1.5">
          {RANGES.map(([v, l]) => (
            <Seg key={v} active={range === v} onClick={() => setRange(v)}>
              {l}
            </Seg>
          ))}
        </div>

        <FieldLabel>Level</FieldLabel>
        <input
          value={level}
          onChange={(e) => setLevel(e.target.value)}
          placeholder="L1 → L2"
          className="mb-[18px] mt-[7px] w-full outline-none placeholder:text-dim-fg focus:border-accent"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            color: "var(--fg)",
            border: "1px solid var(--border)",
            borderRadius: 5,
            padding: "9px 11px",
            background: "var(--panel)",
          }}
        />

        <FieldLabel>Include sections</FieldLabel>
        <div className="mt-[9px] flex flex-col gap-[9px]">
          {SECTION_TOGGLES.map(([id, label]) => {
            const on = include[id];
            return (
              <label
                key={id}
                className="flex cursor-pointer items-center gap-2.5"
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={on}
                  onChange={() => setInclude({ ...include, [id]: !include[id] })}
                />
                <span
                  className="flex items-center justify-center"
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: 4,
                    border: `1px solid ${on ? "var(--accent)" : "var(--border-strong)"}`,
                    background: on ? "var(--accent)" : "transparent",
                    color: "var(--accent-on)",
                    fontSize: 11,
                    lineHeight: 1,
                  }}
                  aria-hidden="true"
                >
                  {on ? "✓" : ""}
                </span>
                <span className="text-[13px] text-fg">{label}</span>
              </label>
            );
          })}
        </div>
      </Card>

      <div
        className="px-1 text-muted-fg"
        style={{ fontFamily: "var(--font-mono)", fontSize: 10, lineHeight: 1.6 }}
      >
        <div className="mb-1 font-bold uppercase tracking-[0.8px] text-accent">
          Privacy · first
        </div>
        {rangeLabel} bundle generated in your browser. Nothing is uploaded. You paste
        the output wherever you want it to go.
      </div>
    </div>
  );
}
