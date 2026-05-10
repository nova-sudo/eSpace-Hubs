/**
 * Blurred dashboard tease used in the onboarding empty state.
 * Pure decoration.
 */
export function DashboardPreview() {
  return (
    <div className="relative h-[220px] overflow-hidden rounded-[var(--radius-tile)] border border-border bg-card">
      <div
        className="absolute inset-0 grid gap-2 p-3.5"
        style={{
          gridTemplateColumns: "repeat(4, 1fr)",
          filter: "blur(3px)",
          opacity: 0.55,
          pointerEvents: "none",
        }}
      >
        {[...Array(12)].map((_, i) => (
          <div
            key={i}
            className="rounded-[var(--radius-sub)] border border-border"
            style={{
              background: i === 1 ? "var(--accent)" : "var(--card-alt)",
              gridRow: i === 1 ? "span 2" : "span 1",
              height: i === 1 ? "auto" : 48,
            }}
          />
        ))}
      </div>
      <div
        className="absolute inset-0 flex items-end justify-center pb-4"
        style={{
          background: "linear-gradient(180deg, transparent, var(--bg) 80%)",
        }}
      >
        <span
          className="uppercase tracking-[0.6px] text-muted-fg"
          style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
        >
          your dashboard, once connected ↓
        </span>
      </div>
    </div>
  );
}
