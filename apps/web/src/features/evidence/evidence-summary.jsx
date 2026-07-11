"use client";

/**
 * Sticky sidebar for the goal evidence board: at-a-glance goal-status counts
 * (big Doto numerals) + the "Compile into review →" CTA that switches to the
 * document builder. Goal-oriented — no integration tallies.
 */

const ROWS = [
  { key: "onTrack", label: "On track", color: "var(--good)" },
  { key: "inProgress", label: "In progress", color: "var(--accent)" },
  { key: "behind", label: "Behind", color: "var(--warn)" },
  { key: "awaiting", label: "Awaiting data", color: "var(--muted-fg)" },
];

export function EvidenceSummary({ rangeLabel, summary, onCompile }) {
  return (
    <div
      className="flex flex-col gap-[13px]"
      style={{ position: "sticky", top: "calc(var(--header-height) + 21px)" }}
    >
      <div className="rounded-[11px] border border-border bg-card p-[17px]">
        <div
          className="mb-3.5 flex items-baseline justify-between uppercase tracking-[2px] text-muted-fg"
          style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
        >
          <span>Goal standing</span>
          <span className="tracking-[0.5px] text-dim-fg">{rangeLabel}</span>
        </div>
        <div className="flex flex-col gap-3">
          {ROWS.map((r) => (
            <div key={r.key} className="flex items-baseline justify-between gap-2">
              <span className="flex items-center gap-2 text-[12.5px] text-muted-fg">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: r.color }} />
                {r.label}
              </span>
              <span
                className="text-fg"
                style={{ fontFamily: "var(--font-dot)", fontWeight: 900, fontSize: 24, lineHeight: 1 }}
              >
                {summary?.[r.key] ?? 0}
              </span>
            </div>
          ))}
          <div className="mt-1 flex items-baseline justify-between gap-2 border-t border-border pt-2.5">
            <span className="text-[11px] uppercase tracking-[0.5px] text-dim-fg" style={{ fontFamily: "var(--font-mono)" }}>
              Total goals
            </span>
            <span className="text-[13px] font-semibold text-fg" style={{ fontFamily: "var(--font-mono)" }}>
              {summary?.total ?? 0}
            </span>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={onCompile}
        className="rounded-[11px] uppercase tracking-[1px] transition-[filter] hover:brightness-110"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          fontWeight: 700,
          color: "var(--accent-on)",
          background: "var(--accent)",
          border: "1px solid var(--accent)",
          padding: 15,
        }}
      >
        Compile into review →
      </button>
    </div>
  );
}
