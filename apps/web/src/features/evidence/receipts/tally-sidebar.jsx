"use client";

/**
 * Sticky sidebar for the Receipts feed (EvidC): the running tally (big Doto
 * numerals), per-L1 goal-coverage bars, and the "Compile into review →" CTA
 * that switches the page into the document-builder view.
 *
 * Presentation only — `tally` from useReceiptsFeed(), `coverage` from
 * coverageByL1(goalReadings).
 */

export function TallySidebar({ rangeLabel, tally, coverage, onCompile }) {
  return (
    <div
      className="flex flex-col gap-[13px]"
      style={{ position: "sticky", top: "calc(var(--header-height) + 21px)" }}
    >
      {/* Running tally */}
      <div className="rounded-[11px] border border-border bg-card p-[17px]">
        <div
          className="mb-3.5 uppercase tracking-[2px] text-muted-fg"
          style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
        >
          Running tally · {rangeLabel}
        </div>
        <div className="flex flex-col gap-3">
          {tally.map((t) => (
            <div key={t.label} className="flex items-baseline justify-between gap-2">
              <span className="text-[12.5px] text-muted-fg">{t.label}</span>
              <span
                className="text-fg"
                style={{ fontFamily: "var(--font-dot)", fontWeight: 900, fontSize: 24, lineHeight: 1 }}
              >
                {t.value}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Goal coverage */}
      {coverage && coverage.length > 0 ? (
        <div className="rounded-[11px] border border-border bg-card p-[17px]">
          <div
            className="mb-3 uppercase tracking-[2px] text-muted-fg"
            style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
          >
            Goal coverage
          </div>
          <div className="flex flex-col gap-2.5">
            {coverage.map((c) => (
              <div key={c.id}>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-[11.5px] text-fg" title={c.label}>
                    {c.label}
                  </span>
                  <span
                    className="shrink-0 text-muted-fg"
                    style={{ fontFamily: "var(--font-mono)", fontSize: 9 }}
                  >
                    {c.covered}/{c.total}
                  </span>
                </div>
                <div
                  className="h-[5px] overflow-hidden rounded-full"
                  style={{ background: "var(--panel-2)" }}
                >
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${c.pct}%`, background: "var(--accent)" }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

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
