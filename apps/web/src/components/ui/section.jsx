/**
 * "01 / Something" section heading with hairline rule.
 */
export function Section({ num, title, children, right, className }) {
  return (
    <section className={className} style={{ marginBottom: 36 }}>
      <div
        className="mb-3.5 flex items-baseline justify-between gap-5 border-b border-border pb-2.5"
      >
        <div className="flex items-baseline gap-3.5">
          {num ? (
            <span
              className="text-accent"
              style={{
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: 22,
                fontWeight: 500,
              }}
            >
              {num}
            </span>
          ) : null}
          <h2
            className="m-0 font-semibold"
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 22,
              letterSpacing: "-0.5px",
            }}
          >
            {title}
          </h2>
        </div>
        {right ? <div>{right}</div> : null}
      </div>
      {children}
    </section>
  );
}
