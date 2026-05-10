// Shared layout helpers for secondary screens (Evidence, Snapshots, Settings, Onboarding).
// Matches V1's HexaCore aesthetic — mono labels, serif italic numerals, electric accent.

const Screens = {};

// Page wrapper — consistent padding + optional title strip
Screens.Page = function Page({ children, style = {} }) {
  return (
    <main style={{ padding: "36px 40px 56px", position: "relative", zIndex: 2, ...style }}>
      {children}
    </main>
  );
};

// Big editorial page header, matches hero style
Screens.PageHeader = function PageHeader({ crumb, title, italicWord, subtitle, right }) {
  // title may contain {italicWord} placeholder we'll swap with an em in italic serif
  const parts = italicWord && title.includes(italicWord)
    ? title.split(italicWord)
    : null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 24, alignItems: "end", marginBottom: 28 }}>
      <div>
        {crumb && <MonoLabel>{crumb}</MonoLabel>}
        <h1 style={{
          fontFamily: "var(--display)", fontWeight: 600,
          fontSize: "clamp(40px, 5vw, 68px)", lineHeight: 0.98, letterSpacing: -1.8,
          margin: "8px 0 0", textWrap: "balance",
        }}>
          {parts ? (
            <>
              {parts[0]}
              <em style={{ fontStyle: "italic", fontFamily: 'ui-serif, "Iowan Old Style", Georgia, serif', color: "var(--accent)" }}>{italicWord}</em>
              {parts[1]}
            </>
          ) : title}
        </h1>
        {subtitle && <p style={{ marginTop: 12, maxWidth: 640, fontSize: 14.5, color: "var(--muted-fg)", lineHeight: 1.55 }}>{subtitle}</p>}
      </div>
      {right && <div>{right}</div>}
    </div>
  );
};

// Section title — "01 / Something"
Screens.Section = function Section({ num, title, children, right, style = {} }) {
  return (
    <section style={{ marginBottom: 36, ...style }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 20, marginBottom: 14, paddingBottom: 10, borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
          {num && (
            <span style={{ fontFamily: 'ui-serif, "Iowan Old Style", Georgia, serif', fontStyle: "italic", fontSize: 22, color: "var(--accent)", fontWeight: 500 }}>
              {num}
            </span>
          )}
          <h2 style={{ margin: 0, fontFamily: "var(--display)", fontSize: 22, fontWeight: 600, letterSpacing: -0.5 }}>
            {title}
          </h2>
        </div>
        {right && <div>{right}</div>}
      </div>
      {children}
    </section>
  );
};

// Primary button — solid accent
Screens.Btn = function Btn({ children, onClick, variant = "primary", size = "md", style = {}, disabled, type = "button" }) {
  const sizes = {
    sm: { padding: "6px 12px", fontSize: 11 },
    md: { padding: "10px 18px", fontSize: 13 },
    lg: { padding: "14px 24px", fontSize: 14 },
  };
  const variants = {
    primary: { background: "var(--accent)", color: "var(--accent-on)", border: "1px solid var(--accent)" },
    ghost:   { background: "transparent", color: "var(--fg)", border: "1px solid var(--border)" },
    solid:   { background: "var(--fg)", color: "var(--bg)", border: "1px solid var(--fg)" },
    danger:  { background: "transparent", color: "var(--bad)", border: "1px solid var(--bad)" },
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} style={{
      ...sizes[size], ...variants[variant],
      fontFamily: "var(--mono)", fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase",
      borderRadius: 4, cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.5 : 1,
      whiteSpace: "nowrap",
      ...style,
    }}>{children}</button>
  );
};

// Input field
Screens.Field = function Field({ label, hint, children, style = {} }) {
  return (
    <label style={{ display: "block", marginBottom: 14, ...style }}>
      {label && <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, letterSpacing: 0.6, textTransform: "uppercase", color: "var(--muted-fg)", marginBottom: 6 }}>{label}</div>}
      {children}
      {hint && <div style={{ fontSize: 11.5, color: "var(--dim-fg)", marginTop: 4, lineHeight: 1.4 }}>{hint}</div>}
    </label>
  );
};

Screens.Input = function Input({ value, onChange, placeholder, mono = false, style = {}, ...rest }) {
  return (
    <input value={value} onChange={onChange} placeholder={placeholder} style={{
      width: "100%", padding: "10px 12px",
      border: "1px solid var(--border)", borderRadius: 4,
      background: "var(--card)", color: "var(--fg)",
      fontFamily: mono ? "var(--mono)" : "var(--sans)", fontSize: 13,
      outline: "none",
      ...style,
    }} {...rest} />
  );
};

// Card / panel
Screens.Card = function Card({ children, pad = 20, variant = "default", style = {} }) {
  const isAccent = variant === "accent";
  return (
    <div style={{
      background: isAccent ? "var(--accent)" : "var(--card)",
      color: isAccent ? "var(--accent-on)" : "var(--fg)",
      border: isAccent ? "1px solid var(--accent)" : "1px solid var(--border)",
      borderRadius: 4, padding: pad,
      position: "relative", overflow: "hidden",
      ...style,
    }}>{children}</div>
  );
};

// Big stat (for snapshot trend, etc.)
Screens.Stat = function Stat({ label, value, unit, delta, deltaInvert, sub }) {
  return (
    <div>
      <MonoLabel>{label}</MonoLabel>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 6 }}>
        <div style={{ fontFamily: "var(--display)", fontSize: 44, fontWeight: 600, lineHeight: 1, letterSpacing: -1.4 }}>{value}</div>
        {unit && <div style={{ fontSize: 15, color: "var(--muted-fg)" }}>{unit}</div>}
        {delta !== undefined && <Delta value={delta} invert={deltaInvert} />}
      </div>
      {sub && <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--muted-fg)", marginTop: 6 }}>{sub}</div>}
    </div>
  );
};

window.Screens = Screens;
