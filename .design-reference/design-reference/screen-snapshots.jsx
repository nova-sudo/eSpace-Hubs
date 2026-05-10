// Snapshot history — long-term trend + weekly table.
// This is the moat: 12-month rolling self-vs-self comparison.

Screens.Snapshots = function Snapshots({ dark, accent, showTexture, onNavigate }) {
  const [metric, setMetric] = React.useState("merged");
  const [selected, setSelected] = React.useState(SNAPSHOTS[0].week);

  const metrics = [
    { id: "merged",     label: "Merged PRs",         unit: "",    key: "merged" },
    { id: "reviews",    label: "Reviews given",      unit: "",    key: "reviews" },
    { id: "turnaround", label: "Turnaround (hours)", unit: "h",   key: "turnaround", invert: true },
    { id: "linkage",    label: "Jira linkage",       unit: "%",   key: "linkage" },
    { id: "rounds",     label: "Rounds per MR",      unit: "",    key: "rounds", invert: true },
  ];
  const active = metrics.find((m) => m.id === metric);
  const series = [...SNAPSHOTS].reverse(); // oldest → newest for the chart
  const selectedSnap = SNAPSHOTS.find((s) => s.week === selected);

  return (
    <Screens.Page>
      <Screens.PageHeader
        crumb="Snapshots · 8 weeks · W09 — W16 2026"
        title="Your trend, on record."
        italicWord="trend"
        subtitle="Every Monday morning we freeze the dashboard into a snapshot. The line you're watching is you, vs. you."
        right={
          <div style={{ display: "flex", gap: 8 }}>
            <Screens.Btn variant="ghost" onClick={() => onNavigate && onNavigate("dashboard")}>← Dashboard</Screens.Btn>
            <Screens.Btn variant="primary">Snapshot now</Screens.Btn>
          </div>
        }
      />

      {/* Metric switcher */}
      <div style={{ display: "flex", gap: 6, marginBottom: 20, flexWrap: "wrap" }}>
        {metrics.map((m) => (
          <button key={m.id} onClick={() => setMetric(m.id)} style={{
            padding: "8px 14px",
            border: metric === m.id ? "1px solid var(--accent)" : "1px solid var(--border)",
            background: metric === m.id ? "var(--accent)" : "transparent",
            color: metric === m.id ? "var(--accent-on)" : "var(--fg)",
            borderRadius: 3, cursor: "pointer",
            fontFamily: "var(--mono)", fontSize: 11, fontWeight: 600, letterSpacing: 0.3, textTransform: "uppercase",
          }}>{m.label}</button>
        ))}
      </div>

      {/* Big chart */}
      <TrendChart series={series} metricKey={active.key} metricLabel={active.label} unit={active.unit} invert={active.invert} showTexture={showTexture} selected={selected} onSelect={setSelected} />

      {/* Selected week detail */}
      <Screens.Section num="01 /" title={`Selected week · ${selectedSnap.week} (${selectedSnap.date})`}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 16, padding: "6px 0 18px" }}>
          <Screens.Stat label="Merged PRs"    value={selectedSnap.merged}    sub="in the week" />
          <Screens.Stat label="Reviews given" value={selectedSnap.reviews}   sub="comments on teammates" />
          <Screens.Stat label="Turnaround"    value={selectedSnap.turnaround} unit="h" sub="median open → merge" />
          <Screens.Stat label="Jira linkage"  value={`${selectedSnap.linkage}%`} sub="MRs with ticket key" />
          <Screens.Stat label="Rounds / MR"   value={selectedSnap.rounds}    sub="reviewer comments" />
        </div>
        <div style={{ padding: "14px 16px", background: "var(--card-alt)", border: "1px dashed var(--border)", borderRadius: 3 }}>
          <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--muted-fg)", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>Week note</div>
          <div style={{ fontFamily: 'ui-serif, "Iowan Old Style", Georgia, serif', fontSize: 17, fontStyle: "italic", color: "var(--fg)", lineHeight: 1.4 }}>
            "{selectedSnap.note}"
          </div>
        </div>
      </Screens.Section>

      {/* Full table */}
      <Screens.Section num="02 /" title="All snapshots" right={<MonoLabel>{SNAPSHOTS.length} weeks</MonoLabel>}>
        <div style={{ border: "1px solid var(--border)", borderRadius: 3, overflow: "hidden", background: "var(--card)" }}>
          <div style={{
            display: "grid",
            gridTemplateColumns: "70px 110px 80px 80px 90px 80px 80px 1fr",
            padding: "10px 14px", background: "var(--card-alt)",
            fontFamily: "var(--mono)", fontSize: 10, letterSpacing: 0.5, textTransform: "uppercase", color: "var(--muted-fg)",
            borderBottom: "1px solid var(--border)",
          }}>
            <span>Week</span><span>Date</span><span>Merged</span><span>Reviews</span><span>Turn.</span><span>Link.</span><span>Rounds</span><span>Note</span>
          </div>
          {SNAPSHOTS.map((s, i) => {
            const isSel = s.week === selected;
            return (
              <div key={s.week} onClick={() => setSelected(s.week)} style={{
                display: "grid",
                gridTemplateColumns: "70px 110px 80px 80px 90px 80px 80px 1fr",
                padding: "12px 14px",
                borderBottom: i < SNAPSHOTS.length - 1 ? "1px dashed var(--border)" : "none",
                background: isSel ? "var(--accent-dim)" : "transparent",
                cursor: "pointer", alignItems: "center",
                fontSize: 13,
              }}>
                <span style={{ fontFamily: "var(--mono)", fontWeight: 700, color: isSel ? "var(--accent)" : "var(--fg)" }}>{s.week}</span>
                <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--muted-fg)" }}>{s.date}</span>
                <span style={{ fontFamily: "var(--display)", fontWeight: 600 }}>{s.merged}</span>
                <span style={{ fontFamily: "var(--display)", fontWeight: 600 }}>{s.reviews}</span>
                <span style={{ fontFamily: "var(--mono)" }}>{s.turnaround}h</span>
                <span style={{ fontFamily: "var(--mono)" }}>{s.linkage}%</span>
                <span style={{ fontFamily: "var(--mono)" }}>{s.rounds}</span>
                <span style={{ fontSize: 12.5, color: "var(--muted-fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.note}</span>
              </div>
            );
          })}
        </div>
      </Screens.Section>
    </Screens.Page>
  );
};

function TrendChart({ series, metricKey, metricLabel, unit, invert, showTexture, selected, onSelect }) {
  const values = series.map((s) => s[metricKey]);
  const max = Math.max(...values) * 1.15;
  const min = Math.min(...values) * 0.85;
  const range = max - min || 1;

  const W = 100, H = 40;
  const step = W / (series.length - 1 || 1);
  const pts = values.map((v, i) => [i * step, H - ((v - min) / range) * H]);
  const d = pts.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(" ");
  const area = `${d} L${pts[pts.length - 1][0]},${H} L0,${H} Z`;

  const first = values[0], last = values[values.length - 1];
  const delta = last - first;
  const pct = first ? Math.round((delta / first) * 100) : 0;
  const good = invert ? delta < 0 : delta > 0;

  return (
    <Screens.Card pad={0} style={{ overflow: "hidden", marginBottom: 36 }}>
      <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div>
          <MonoLabel>{metricLabel} · 8 weeks</MonoLabel>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 6 }}>
            <span style={{ fontFamily: "var(--display)", fontSize: 44, fontWeight: 600, letterSpacing: -1.4, lineHeight: 1 }}>{last}{unit}</span>
            <span style={{ fontFamily: "var(--mono)", fontSize: 12, color: good ? "var(--good)" : "var(--bad)", fontWeight: 600 }}>
              {delta > 0 ? "↑" : "↓"} {Math.abs(delta).toFixed(metricKey === "rounds" ? 1 : 0)}{unit} ({pct >= 0 ? "+" : ""}{pct}%) · 8w
            </span>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--muted-fg)", textTransform: "uppercase", letterSpacing: 0.5 }}>8-week avg</div>
          <div style={{ fontFamily: "var(--display)", fontSize: 22, fontWeight: 600, letterSpacing: -0.5 }}>
            {(values.reduce((a, b) => a + b, 0) / values.length).toFixed(metricKey === "rounds" ? 1 : 0)}{unit}
          </div>
        </div>
      </div>

      <div style={{ position: "relative", height: 260, padding: "20px 24px 10px" }}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ position: "absolute", inset: "20px 24px 40px", width: "calc(100% - 48px)", height: "calc(100% - 60px)" }}>
          {/* grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <line key={t} x1={0} x2={W} y1={H * t} y2={H * t} stroke="var(--border)" strokeWidth="0.15" vectorEffect="non-scaling-stroke" />
          ))}
          <path d={area} fill="var(--accent)" opacity={0.12} />
          <path d={d} fill="none" stroke="var(--accent)" strokeWidth="2.2" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
          {pts.map((p, i) => {
            const isSel = series[i].week === selected;
            return (
              <g key={i}>
                <circle cx={p[0]} cy={p[1]} r={isSel ? 1.8 : 1.0} fill="var(--accent)" />
                {isSel && <circle cx={p[0]} cy={p[1]} r={3.2} fill="none" stroke="var(--accent)" strokeWidth="0.5" vectorEffect="non-scaling-stroke" opacity="0.4" />}
              </g>
            );
          })}
        </svg>
        {/* hover/click overlay */}
        <div style={{ position: "absolute", inset: "20px 24px 40px", display: "flex" }}>
          {series.map((s, i) => (
            <div key={s.week} onClick={() => onSelect(s.week)} style={{
              flex: 1, cursor: "pointer", borderLeft: i === 0 ? "none" : "1px dashed transparent",
            }} title={`${s.week} · ${s[metricKey]}${unit}`} />
          ))}
        </div>
        {/* axis labels */}
        <div style={{ position: "absolute", bottom: 10, left: 24, right: 24, display: "flex", justifyContent: "space-between", fontFamily: "var(--mono)", fontSize: 10, color: "var(--muted-fg)" }}>
          {series.map((s) => (
            <span key={s.week} onClick={() => onSelect(s.week)} style={{
              cursor: "pointer",
              color: s.week === selected ? "var(--accent)" : "var(--muted-fg)",
              fontWeight: s.week === selected ? 700 : 400,
            }}>{s.week}</span>
          ))}
        </div>
      </div>
    </Screens.Card>
  );
}
