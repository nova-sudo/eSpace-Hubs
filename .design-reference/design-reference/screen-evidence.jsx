// Evidence Export — the "make the case" screen.
// Left: configuration (date range, format, what to include, narrative).
// Right: live preview of the output document.
// Bottom: starred evidence + candidates.

Screens.Evidence = function Evidence({ dark, accent, showTexture, onNavigate }) {
  const [format, setFormat] = React.useState("markdown"); // markdown / pdf
  const [range, setRange] = React.useState("90d"); // 30d / 90d / q1 / custom
  const [includeNarrative, setIncludeNarrative] = React.useState(true);
  const [includeMetrics, setIncludeMetrics] = React.useState(true);
  const [includePRs, setIncludePRs] = React.useState(true);
  const [includeTickets, setIncludeTickets] = React.useState(true);
  const [includeReviews, setIncludeReviews] = React.useState(true);
  const [level, setLevel] = React.useState("L1 → L2");
  const [narrative, setNarrative] = React.useState(
    "This quarter I focused on reliability in the payments platform — specifically reducing retry-failure blast radius and tightening the p95 latency on /charges. Three of my merged PRs touched the core retry path, and I drove the refactor that split ChargeService into command/query before it became unmaintainable. I also stepped up on reviews (47 comments given, +34%) and kept Jira linkage above 90% for the first full quarter."
  );
  const [starred, setStarred] = React.useState(EVIDENCE_STARRED.map((e) => e.id));

  const toggleStar = (id) => {
    setStarred((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  };

  const allEvidence = [...EVIDENCE_STARRED, ...EVIDENCE_CANDIDATES];
  const activeEvidence = allEvidence.filter((e) => starred.includes(e.id));

  return (
    <Screens.Page>
      <Screens.PageHeader
        crumb="Evidence · 90-day performance bundle"
        title="Make the case."
        italicWord="case"
        subtitle="Turn 90 days of scattered receipts into one reviewable document. You pick what to include; the data speaks for itself."
        right={
          <div style={{ display: "flex", gap: 8 }}>
            <Screens.Btn variant="ghost" onClick={() => onNavigate && onNavigate("dashboard")}>← Dashboard</Screens.Btn>
            <Screens.Btn variant="primary" size="lg">Export {format === "markdown" ? ".md" : ".pdf"}</Screens.Btn>
          </div>
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "340px minmax(0, 1fr)", gap: 20, alignItems: "start" }}>
        {/* LEFT — configuration */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20, position: "sticky", top: 80 }}>
          <Screens.Card>
            <MonoLabel>Format</MonoLabel>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 8 }}>
              {[["markdown", "Markdown", ".md · paste-ready"], ["pdf", "PDF", ".pdf · print-ready"]].map(([v, l, s]) => (
                <button key={v} onClick={() => setFormat(v)} style={{
                  padding: "12px 10px", textAlign: "left",
                  border: format === v ? "1px solid var(--accent)" : "1px solid var(--border)",
                  background: format === v ? "var(--accent-dim)" : "var(--card-alt)",
                  borderRadius: 3, cursor: "pointer",
                }}>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2, color: "var(--fg)" }}>{l}</div>
                  <div style={{ fontFamily: "var(--mono)", fontSize: 9.5, color: "var(--muted-fg)" }}>{s}</div>
                </button>
              ))}
            </div>
          </Screens.Card>

          <Screens.Card>
            <MonoLabel>Date range</MonoLabel>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginTop: 8 }}>
              {[["30d", "Last 30d"], ["90d", "Last 90d"], ["q1", "Q1 2026"], ["custom", "Custom…"]].map(([v, l]) => (
                <button key={v} onClick={() => setRange(v)} style={{
                  padding: "8px 10px",
                  border: range === v ? "1px solid var(--accent)" : "1px solid var(--border)",
                  background: range === v ? "var(--accent-dim)" : "transparent",
                  color: range === v ? "var(--accent)" : "var(--fg)",
                  borderRadius: 3, cursor: "pointer",
                  fontFamily: "var(--mono)", fontSize: 11, fontWeight: 600, letterSpacing: 0.3,
                }}>{l}</button>
              ))}
            </div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--dim-fg)", marginTop: 8, textTransform: "uppercase", letterSpacing: 0.4 }}>
              Jan 22 — Apr 22, 2026 · 91 days
            </div>
          </Screens.Card>

          <Screens.Card>
            <MonoLabel>Performance cycle</MonoLabel>
            <Screens.Input value={level} onChange={(e) => setLevel(e.target.value)} style={{ marginTop: 8 }} placeholder="L1 → L2" />
            <div style={{ fontSize: 11, color: "var(--dim-fg)", marginTop: 6, lineHeight: 1.4 }}>
              Appears as the header of the exported document. We don't read your level from anywhere.
            </div>
          </Screens.Card>

          <Screens.Card>
            <MonoLabel>Sections</MonoLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
              {[
                ["narrative", "Narrative intro", includeNarrative, setIncludeNarrative],
                ["metrics",   "Headline metrics", includeMetrics, setIncludeMetrics],
                ["prs",       "Merged PRs (starred)", includePRs, setIncludePRs],
                ["tickets",   "Closed tickets (starred)", includeTickets, setIncludeTickets],
                ["reviews",   "Notable reviews given", includeReviews, setIncludeReviews],
              ].map(([id, label, val, set]) => (
                <label key={id} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", padding: "6px 2px" }}>
                  <CheckBox checked={val} onChange={() => set(!val)} />
                  <span style={{ fontSize: 12.5 }}>{label}</span>
                </label>
              ))}
            </div>
          </Screens.Card>

          <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--muted-fg)", padding: "0 4px", lineHeight: 1.6 }}>
            <div style={{ color: "var(--accent)", fontWeight: 700, marginBottom: 4 }}>PRIVACY · FIRST</div>
            This bundle is generated in your browser. Nothing is uploaded. You paste the output wherever you want it to go.
          </div>
        </div>

        {/* RIGHT — live preview + evidence picker */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20, minWidth: 0 }}>
          <DocumentPreview
            format={format} range={range} level={level} narrative={narrative}
            setNarrative={setNarrative}
            includeNarrative={includeNarrative} includeMetrics={includeMetrics}
            includePRs={includePRs} includeTickets={includeTickets} includeReviews={includeReviews}
            activeEvidence={activeEvidence}
            showTexture={showTexture}
          />

          <EvidencePicker allEvidence={allEvidence} starred={starred} onToggle={toggleStar} />
        </div>
      </div>
    </Screens.Page>
  );
};

function CheckBox({ checked, onChange }) {
  return (
    <span onClick={onChange} style={{
      display: "inline-grid", placeItems: "center",
      width: 16, height: 16,
      border: checked ? "1px solid var(--accent)" : "1px solid var(--border)",
      background: checked ? "var(--accent)" : "var(--card)",
      borderRadius: 2,
    }}>
      {checked && <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5.5l2 2 4-5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>}
    </span>
  );
}

function DocumentPreview({ format, range, level, narrative, setNarrative, includeNarrative, includeMetrics, includePRs, includeTickets, includeReviews, activeEvidence, showTexture }) {
  const prs = activeEvidence.filter((e) => e.kind === "merged-pr");
  const tickets = activeEvidence.filter((e) => e.kind === "ticket");
  const reviews = activeEvidence.filter((e) => e.kind === "review");

  return (
    <Screens.Card pad={0} style={{ overflow: "hidden" }}>
      {/* Preview header strip */}
      <div style={{ padding: "10px 18px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--card-alt)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 6, height: 6, borderRadius: 3, background: "var(--accent-2)" }} />
          <MonoLabel>Live preview · {format === "markdown" ? "Markdown" : "PDF"}</MonoLabel>
        </div>
        <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--muted-fg)" }}>
          ~{estimateLines(includeNarrative, includeMetrics, prs, tickets, reviews)} lines · {activeEvidence.length} items
        </div>
      </div>

      {/* The document itself — styled to feel like paper */}
      <div style={{ padding: "40px 48px", background: "var(--card)", minHeight: 640, position: "relative" }}>
        {showTexture && (
          <div style={{ position: "absolute", top: 20, right: 20, opacity: 0.25, pointerEvents: "none" }}>
            <DitherField width={100} height={60} cell={4} color="var(--accent)"
              falloff={(u, v) => Math.max(0, 1 - u * 1.2)} jitter={0.35} seed={17} />
          </div>
        )}

        <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--muted-fg)", marginBottom: 8 }}># performance-review-{range}.{format === "markdown" ? "md" : "pdf"}</div>
        <div style={{ fontFamily: 'ui-serif, "Iowan Old Style", Georgia, serif', fontSize: 34, fontWeight: 600, letterSpacing: -0.8, lineHeight: 1.1, color: "var(--fg)", marginBottom: 4 }}>
          {ME.name} — {level}
        </div>
        <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--muted-fg)", marginBottom: 28 }}>
          {ME.team} · {rangeLabel(range)}
        </div>

        {includeNarrative && (
          <DocSection title="01 / Summary" rangeLabel={rangeLabel(range)}>
            <textarea
              value={narrative}
              onChange={(e) => setNarrative(e.target.value)}
              rows={5}
              style={{
                width: "100%", border: "1px dashed var(--border)", borderRadius: 3, padding: 10,
                fontFamily: 'ui-serif, "Iowan Old Style", Georgia, serif', fontSize: 15, lineHeight: 1.55,
                color: "var(--fg)", background: "var(--card-alt)", resize: "vertical", outline: "none",
              }}
            />
            <div style={{ fontFamily: "var(--mono)", fontSize: 9.5, color: "var(--dim-fg)", marginTop: 4, textTransform: "uppercase", letterSpacing: 0.4 }}>
              Click to edit · your words, not ours
            </div>
          </DocSection>
        )}

        {includeMetrics && (
          <DocSection title="02 / Headline metrics" rangeLabel={rangeLabel(range)}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginTop: 6 }}>
              <MetricBox label="Merged PRs" value={METRICS.mergedThisWeek * 11} sub={`+${METRICS.mergedDelta * 8} vs prev 90d`} />
              <MetricBox label="Review turnaround" value={METRICS.turnaround} sub={`${METRICS.turnaroundDelta} vs prev`} good />
              <MetricBox label="Rounds / MR" value={METRICS.avgRounds} sub={`${METRICS.avgRoundsDelta} (cleaner)`} good />
              <MetricBox label="Jira linkage" value={`${METRICS.linkage}%`} sub={`+${METRICS.linkageDelta}pp`} />
              <MetricBox label="Reviews given" value={METRICS.reviewsGiven * 3} sub={`+${METRICS.reviewsDelta * 3} vs prev`} />
              <MetricBox label="Cycle time" value={METRICS.cycleTime} sub="open → merge, median" />
              <MetricBox label="SLA hit rate" value={`${METRICS.slaHit}%`} sub="priority tickets" />
              <MetricBox label="On-call incidents" value={METRICS.onCallIncidents} sub="1 post-mortem led" />
            </div>
          </DocSection>
        )}

        {includePRs && prs.length > 0 && (
          <DocSection title={`03 / Merged pull requests · ${prs.length}`} rangeLabel="starred as evidence">
            {prs.map((p) => <EvidenceRow key={p.id} item={p} />)}
          </DocSection>
        )}

        {includeTickets && tickets.length > 0 && (
          <DocSection title={`04 / Closed tickets · ${tickets.length}`} rangeLabel="starred as evidence">
            {tickets.map((t) => <EvidenceRow key={t.id} item={t} />)}
          </DocSection>
        )}

        {includeReviews && reviews.length > 0 && (
          <DocSection title={`05 / Notable reviews given · ${reviews.length}`} rangeLabel="starred as evidence">
            {reviews.map((r) => <EvidenceRow key={r.id} item={r} />)}
          </DocSection>
        )}

        <div style={{ marginTop: 40, paddingTop: 16, borderTop: "1px solid var(--border)", fontFamily: "var(--mono)", fontSize: 10, color: "var(--dim-fg)", display: "flex", justifyContent: "space-between" }}>
          <span>Generated by eSpace/DevHub · {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
          <span>Source: Jira + GitLab + GitHub</span>
        </div>
      </div>
    </Screens.Card>
  );
}

function DocSection({ title, rangeLabel, children }) {
  return (
    <div style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontFamily: "var(--display)", fontSize: 16, fontWeight: 600, letterSpacing: -0.2 }}>{title}</h3>
        <span style={{ fontFamily: "var(--mono)", fontSize: 9.5, color: "var(--dim-fg)", textTransform: "uppercase", letterSpacing: 0.4 }}>{rangeLabel}</span>
      </div>
      {children}
    </div>
  );
}

function MetricBox({ label, value, sub, good }) {
  return (
    <div>
      <div style={{ fontFamily: "var(--mono)", fontSize: 9.5, color: "var(--muted-fg)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: "var(--display)", fontSize: 26, fontWeight: 600, letterSpacing: -0.6, lineHeight: 1 }}>{value}</div>
      <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: good ? "var(--good)" : "var(--muted-fg)", marginTop: 4 }}>{sub}</div>
    </div>
  );
}

function EvidenceRow({ item }) {
  return (
    <div style={{ padding: "10px 0", borderBottom: "1px dashed var(--border)" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", marginBottom: 2 }}>
        <span style={{ fontFamily: "var(--mono)", fontSize: 11, fontWeight: 700, color: "var(--accent)", minWidth: 70 }}>{item.ref}</span>
        <span style={{ fontSize: 13, fontWeight: 500, flex: 1, color: "var(--fg)" }}>{item.title}</span>
        <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--muted-fg)" }}>{item.date}</span>
      </div>
      {item.impact && (
        <div style={{ fontSize: 12, color: "var(--muted-fg)", marginLeft: 80, lineHeight: 1.45, textWrap: "pretty" }}>
          → {item.impact}
        </div>
      )}
    </div>
  );
}

function EvidencePicker({ allEvidence, starred, onToggle }) {
  return (
    <Screens.Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div>
          <MonoLabel>Star as evidence · {starred.length} selected</MonoLabel>
          <div style={{ fontSize: 12.5, color: "var(--muted-fg)", marginTop: 4 }}>
            Curate what lands in the export. Only starred items appear in the document above.
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <Screens.Btn variant="ghost" size="sm">Auto-pick top 10</Screens.Btn>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
        {allEvidence.map((e) => {
          const isStar = starred.includes(e.id);
          return (
            <button key={e.id} onClick={() => onToggle(e.id)} style={{
              textAlign: "left", padding: "10px 12px",
              border: isStar ? "1px solid var(--accent)" : "1px solid var(--border)",
              background: isStar ? "var(--accent-dim)" : "var(--card-alt)",
              borderRadius: 3, cursor: "pointer", position: "relative",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 3 }}>
                <span style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, color: "var(--accent)" }}>{e.ref}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontFamily: "var(--mono)", fontSize: 9.5, color: "var(--muted-fg)", textTransform: "uppercase", letterSpacing: 0.3 }}>
                    {e.kind === "merged-pr" ? "PR" : e.kind === "ticket" ? "Ticket" : "Review"}
                  </span>
                  <StarGlyph on={isStar} />
                </div>
              </div>
              <div style={{ fontSize: 12, lineHeight: 1.35, color: "var(--fg)", textWrap: "pretty", marginBottom: e.impact ? 4 : 0 }}>{e.title}</div>
              {e.impact && <div style={{ fontSize: 11, color: "var(--muted-fg)", lineHeight: 1.4 }}>→ {e.impact}</div>}
              <div style={{ fontFamily: "var(--mono)", fontSize: 9.5, color: "var(--dim-fg)", marginTop: 4 }}>{e.date}</div>
            </button>
          );
        })}
      </div>
    </Screens.Card>
  );
}

function StarGlyph({ on }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill={on ? "var(--accent)" : "none"} stroke={on ? "var(--accent)" : "var(--muted-fg)"} strokeWidth="2" strokeLinejoin="round">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}

function rangeLabel(range) {
  return range === "30d" ? "Mar 22 — Apr 22, 2026"
       : range === "90d" ? "Jan 22 — Apr 22, 2026"
       : range === "q1"  ? "Q1 2026 · Jan 1 — Mar 31"
       : "Custom";
}

function estimateLines(narrative, metrics, prs, tickets, reviews) {
  let n = 2;
  if (narrative) n += 6;
  if (metrics) n += 12;
  n += prs.length * 2 + tickets.length * 2 + reviews.length * 2;
  return n;
}
