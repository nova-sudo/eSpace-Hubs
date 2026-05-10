// V1 — HexaCore: editorial, dithered, electric blue on warm off-white
// Big editorial headline, dither/halftone textures, sans + mono type,
// bento grid, dense tiles with sparklines.

const V1 = {};

// ── Shell ────────────────────────────────────────────────────
V1.Shell = function Shell({ density = "balanced", showTexture = true, dark = false, accent = "#3826ff", accent2 = "#00c48a", hiddenTiles = {}, route = "dashboard", onNavigate = () => {}, connectedCount = 3 }) {
  const pad = density === "dense" ? 14 : density === "airy" ? 22 : 18;
  const gap = density === "dense" ? 10 : density === "airy" ? 18 : 14;
  const rowH = density === "dense" ? 132 : density === "airy" ? 168 : 150;

  const bg = dark ? "#0a0a0f" : "#f1eee6";
  const fg = dark ? "#f1eee6" : "#0b0b14";
  const card = dark ? "#14141d" : "#ffffff";
  const cardAlt = dark ? "#1a1a25" : "#faf8f2";
  const border = dark ? "rgba(255,255,255,0.08)" : "rgba(10,11,22,0.10)";
  const muted = dark ? "rgba(241,238,230,0.55)" : "rgba(11,11,20,0.55)";
  const dim   = dark ? "rgba(241,238,230,0.35)" : "rgba(11,11,20,0.38)";

  const theme = {
    "--bg": bg, "--fg": fg, "--card": card, "--card-alt": cardAlt,
    "--border": border, "--muted-fg": muted, "--dim-fg": dim,
    "--accent": accent, "--accent-on": "#ffffff", "--accent-dim": accent + "1a",
    "--accent-2": accent2, "--good": "#047857", "--bad": "#b91c1c",
    "--mono": "'JetBrains Mono', 'SF Mono', Menlo, monospace",
    "--sans": "'Inter Tight', 'Inter', system-ui, -apple-system, sans-serif",
    "--display": "'Inter Tight', 'Inter', system-ui, sans-serif",
  };

  return (
    <div style={{ ...theme, background: bg, color: fg, fontFamily: "var(--sans)", minHeight: "100%", position: "relative" }}>
      {showTexture && <Grain opacity={dark ? 0.35 : 0.55} blend={dark ? "screen" : "multiply"} style={{ zIndex: 1 }} />}
      <V1.Header dark={dark} route={route} onNavigate={onNavigate} connectedCount={connectedCount} />
      {route === "dashboard"  && <V1.DashboardBody dark={dark} accent={accent} showTexture={showTexture} pad={pad} gap={gap} rowH={rowH} hiddenTiles={hiddenTiles} onNavigate={onNavigate} />}
      {route === "evidence"   && <Screens.Evidence  dark={dark} accent={accent} showTexture={showTexture} onNavigate={onNavigate} />}
      {route === "snapshots"  && <Screens.Snapshots dark={dark} accent={accent} showTexture={showTexture} onNavigate={onNavigate} />}
      {route === "settings"   && <Screens.Settings  dark={dark} accent={accent} showTexture={showTexture} onNavigate={onNavigate} />}
      {route === "onboarding" && <Screens.Onboarding dark={dark} accent={accent} showTexture={showTexture} onNavigate={onNavigate} />}
    </div>
  );
};

// Dashboard body extracted so we can route
V1.DashboardBody = function DashboardBody({ dark, accent, showTexture, pad, gap, rowH, hiddenTiles, onNavigate }) {
  return (
    <>
      <V1.Hero dark={dark} accent={accent} showTexture={showTexture} />
      {ATTENTION && ATTENTION.length > 0 && <V1.AttentionBand onNavigate={onNavigate} />}
      <main style={{ padding: `0 40px 56px`, position: "relative", zIndex: 2 }}>
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(12, 1fr)",
          gridAutoRows: rowH,
          gap,
          padding: 0,
        }}>
          {!hiddenTiles.integrations && <V1.IntegrationsTile pad={pad} />}
          {!hiddenTiles.merged && <V1.MergedTile pad={pad} showTexture={showTexture} />}
          {!hiddenTiles.rounds && <V1.RoundsTile pad={pad} />}
          {!hiddenTiles.linkage && <V1.LinkageTile pad={pad} showTexture={showTexture} />}

          {!hiddenTiles.tickets && <V1.TicketsTile pad={pad} />}
          {!hiddenTiles.prs && <V1.PRsTile pad={pad} />}

          {!hiddenTiles.activity && <V1.ActivityTile pad={pad} showTexture={showTexture} />}
          {!hiddenTiles.turnaround && <V1.TurnaroundTile pad={pad} />}
          {!hiddenTiles.reviews && <V1.ReviewsTile pad={pad} />}

          {!hiddenTiles.snapshots && <V1.SnapshotsTile pad={pad} onNavigate={onNavigate} />}
          {!hiddenTiles.export && <V1.ExportTile pad={pad} showTexture={showTexture} onNavigate={onNavigate} />}
          {!hiddenTiles.commits && <V1.CommitsTile pad={pad} />}
        </div>
        <V1.Footer />
      </main>
    </>
  );
};

// Attention band — surfaces stale PRs / old tickets above the bento.
V1.AttentionBand = function AttentionBand({ onNavigate }) {
  return (
    <section style={{ padding: "0 40px 20px", position: "relative", zIndex: 2 }}>
      <div style={{ border: "1px solid var(--border)", borderLeft: "3px solid var(--accent)", background: "var(--card)", borderRadius: 4, padding: "14px 18px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <MonoLabel>Needs your attention · {ATTENTION.length}</MonoLabel>
            <span style={{ fontSize: 12, color: "var(--muted-fg)" }}>Quiet nudges, not alarms.</span>
          </div>
          <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--muted-fg)" }}>DISMISS ALL</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${ATTENTION.length}, 1fr)`, gap: 10 }}>
          {ATTENTION.map((a) => (
            <div key={a.id} style={{ padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 3, background: "var(--card-alt)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, fontWeight: 700, color: "var(--accent)" }}>{a.ref}</span>
                <span style={{ fontFamily: "var(--mono)", fontSize: 9.5, color: "var(--dim-fg)", textTransform: "uppercase", letterSpacing: 0.4 }}>
                  {a.kind === "stale-pr" ? "Stale PR" : "Old ticket"} · {a.severity}
                </span>
              </div>
              <div style={{ fontSize: 12.5, lineHeight: 1.35, marginBottom: 4, textWrap: "pretty" }}>{a.title}</div>
              <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--muted-fg)", marginBottom: 6 }}>{a.detail}</div>
              <span style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, color: "var(--accent)" }}>{a.action} ↗</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

// ── Header ───────────────────────────────────────────────────
V1.Header = function Header({ dark, route, onNavigate, connectedCount = 3 }) {
  const navItems = [
    ["Dashboard", "dashboard"],
    ["Evidence",  "evidence"],
    ["Snapshots", "snapshots"],
    ["Settings",  "settings"],
  ];
  return (
    <header style={{
      position: "sticky", top: 0, zIndex: 20,
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "14px 40px", borderBottom: "1px solid var(--border)",
      background: dark ? "rgba(10,10,15,0.8)" : "rgba(241,238,230,0.8)",
      backdropFilter: "blur(12px)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }} onClick={() => onNavigate && onNavigate("dashboard")}>
          <V1.LogoMark />
          <div style={{ fontFamily: "var(--display)", fontSize: 18, fontWeight: 600, letterSpacing: -0.3 }}>
            eSpace<span style={{ color: "var(--accent)" }}>/</span>DevHub
          </div>
          <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--dim-fg)", padding: "2px 6px", border: "1px solid var(--border)", borderRadius: 4 }}>v0.3.1</span>
        </div>
        <nav style={{ display: "flex", gap: 2, fontFamily: "var(--mono)", fontSize: 12 }}>
          {navItems.map(([l, r]) => {
            const active = route === r;
            return (
              <button key={r} onClick={() => onNavigate && onNavigate(r)} style={{
                padding: "6px 12px", borderRadius: 6, border: "none", cursor: "pointer",
                color: active ? "var(--fg)" : "var(--muted-fg)",
                background: active ? "var(--accent-dim)" : "transparent",
                fontWeight: active ? 600 : 500,
                textTransform: "uppercase", letterSpacing: 0.4,
                fontFamily: "var(--mono)", fontSize: 12,
              }}>{l}</button>
            );
          })}
        </nav>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--muted-fg)", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 6, height: 6, borderRadius: 3, background: connectedCount > 0 ? "var(--accent-2)" : "var(--dim-fg)", boxShadow: connectedCount > 0 ? "0 0 0 3px rgba(0,196,138,0.2)" : "none" }} />
          {connectedCount > 0 ? `LIVE · ${connectedCount} integration${connectedCount === 1 ? "" : "s"}` : "NOT CONNECTED"}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 12px 4px 4px", border: "1px solid var(--border)", borderRadius: 999 }}>
          <div style={{ width: 26, height: 26, borderRadius: 13, background: "var(--accent)", color: "var(--accent-on)", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700, letterSpacing: 0.2 }}>{ME.avatar}</div>
          <div style={{ fontSize: 12, fontWeight: 600 }}>{ME.name}</div>
        </div>
      </div>
    </header>
  );
};

V1.LogoMark = function LogoMark() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26">
      {/* hex made of dots */}
      {(() => {
        const pts = [];
        const cx = 13, cy = 13;
        for (let ring = 1; ring <= 3; ring++) {
          for (let a = 0; a < 6; a++) {
            const ang = (a / 6) * Math.PI * 2 - Math.PI / 2;
            for (let s = 0; s < ring; s++) {
              const nextAng = ((a + 1) / 6) * Math.PI * 2 - Math.PI / 2;
              const t = s / ring;
              const x = cx + (Math.cos(ang) * (1 - t) + Math.cos(nextAng) * t) * ring * 3.6;
              const y = cy + (Math.sin(ang) * (1 - t) + Math.sin(nextAng) * t) * ring * 3.6;
              pts.push(<circle key={`${ring}-${a}-${s}`} cx={x} cy={y} r={1.4} fill="var(--accent)" />);
            }
          }
        }
        pts.push(<circle key="c" cx={cx} cy={cy} r={1.6} fill="var(--accent)" />);
        return pts;
      })()}
    </svg>
  );
};

// ── Hero ─────────────────────────────────────────────────────
V1.Hero = function Hero({ dark, accent, showTexture }) {
  return (
    <section style={{ padding: "36px 40px 28px", position: "relative", zIndex: 2 }}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 280px", gap: 24, alignItems: "end" }}>
        <div>
          <MonoLabel>W16 · Apr 20 — Apr 26 · {ME.level}</MonoLabel>
          <h1 style={{
            fontFamily: "var(--display)", fontWeight: 600,
            fontSize: "clamp(48px, 6.5vw, 92px)", lineHeight: 0.94, letterSpacing: -2.5,
            margin: "8px 0 0", textWrap: "balance",
          }}>
            <span style={{ color: "var(--muted-fg)" }}>Measure.</span>{" "}
            <span style={{ color: "var(--muted-fg)" }}>Merge.</span>{" "}
            <span>Make the</span>{" "}
            <em style={{ fontStyle: "italic", fontFamily: 'ui-serif, "Iowan Old Style", Georgia, serif', color: "var(--accent)" }}>case</em>.
          </h1>
          <p style={{ marginTop: 14, maxWidth: 620, fontSize: 15, color: "var(--muted-fg)", lineHeight: 1.5 }}>
            A quiet dashboard for loud performance seasons. Pulls your Jira, GitLab and GitHub into one receipts-ready view — so review time writes itself.
          </p>
        </div>
        <div style={{ position: "relative", height: 180, border: "1px solid var(--border)", borderRadius: 4, overflow: "hidden", background: "var(--card)" }}>
          <DitherField
            width={280} height={180} cell={5}
            color={accent}
            falloff={(u, v) => Math.max(0, 1.2 - Math.sqrt((u - 0.7) ** 2 + (v - 0.4) ** 2) * 1.4)}
            jitter={0.45}
            seed={11}
          />
          <div style={{ position: "absolute", left: 14, top: 12, fontFamily: "var(--mono)", fontSize: 10, color: "var(--muted-fg)", letterSpacing: 0.5 }}>
            SIGNAL · 14D
          </div>
          <div style={{ position: "absolute", left: 14, bottom: 12, right: 14, display: "flex", justifyContent: "space-between", alignItems: "baseline", fontFamily: "var(--mono)" }}>
            <div style={{ fontSize: 28, fontWeight: 600, color: "var(--fg)", letterSpacing: -0.5 }}>147</div>
            <div style={{ fontSize: 10, color: "var(--muted-fg)" }}>events tracked</div>
          </div>
        </div>
      </div>
    </section>
  );
};

// ── Generic tile chrome ──────────────────────────────────────
V1.Tile = function Tile({ col = "span 4", row = "span 2", label, right, children, pad = 18, variant = "default", style = {}, title, titleSize = 14 }) {
  const isAccent = variant === "accent";
  return (
    <div style={{
      gridColumn: col, gridRow: row,
      position: "relative",
      background: isAccent ? "var(--accent)" : "var(--card)",
      color: isAccent ? "var(--accent-on)" : "var(--fg)",
      border: isAccent ? "1px solid var(--accent)" : "1px solid var(--border)",
      borderRadius: 4,
      padding: pad,
      display: "flex", flexDirection: "column",
      overflow: "hidden",
      minWidth: 0,
      ...style,
    }}>
      {(label || right) && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8 }}>
          <MonoLabel style={isAccent ? { color: "rgba(255,255,255,0.75)" } : {}}>{label}</MonoLabel>
          <div>{right}</div>
        </div>
      )}
      {title && (
        <div style={{ fontSize: titleSize, fontWeight: 600, marginBottom: 6, letterSpacing: -0.1 }}>{title}</div>
      )}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>{children}</div>
    </div>
  );
};

// ── Tiles ────────────────────────────────────────────────────
V1.IntegrationsTile = function ({ pad }) {
  return (
    <V1.Tile col="span 3" row="span 2" label="Integrations · 3 / 3" pad={pad}
      right={<span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--muted-fg)" }}>MANAGE ↗</span>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
        {INTEGRATIONS.map((p) => (
          <div key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 3, background: "var(--card-alt)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <V1.ProviderGlyph id={p.id} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{p.label}</div>
                <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--dim-fg)" }}>{p.user}</div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: 3, background: "var(--accent-2)" }} />
              <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--muted-fg)", textTransform: "uppercase" }}>OK</span>
            </div>
          </div>
        ))}
      </div>
    </V1.Tile>
  );
};

V1.ProviderGlyph = function ({ id }) {
  const g = { jira: "J", gitlab: "GL", github: "GH" };
  return (
    <div style={{ width: 26, height: 26, borderRadius: 3, background: "var(--accent-dim)", color: "var(--accent)", display: "grid", placeItems: "center", fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700 }}>
      {g[id]}
    </div>
  );
};

V1.MergedTile = function ({ pad, showTexture }) {
  return (
    <V1.Tile col="span 4" row="span 2" variant="accent" label="MERGED THIS WEEK" pad={pad}
      right={<span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "rgba(255,255,255,0.8)" }}>W16</span>}>
      {showTexture && (
        <div style={{ position: "absolute", right: -20, top: -10, opacity: 0.35, pointerEvents: "none" }}>
          <DitherField width={220} height={220} cell={7} color="#ffffff"
            falloff={(u, v) => Math.max(0, 1 - Math.sqrt((u - 0.3) ** 2 + (v - 0.6) ** 2) * 1.5)}
            jitter={0.4} seed={9} />
        </div>
      )}
      <div style={{ position: "relative", display: "flex", flexDirection: "column", justifyContent: "space-between", height: "100%" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginTop: 4 }}>
          <div style={{ fontFamily: "var(--display)", fontSize: 96, fontWeight: 600, lineHeight: 0.9, letterSpacing: -4 }}>{METRICS.mergedThisWeek}</div>
          <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "rgba(255,255,255,0.8)" }}>
            <div>+{METRICS.mergedDelta} vs W15</div>
            <div>8w avg · 5.3</div>
          </div>
        </div>
        <div>
          <Sparkline data={METRICS.mergedTrend.map((m) => m.n)} accent="#ffffff" height={36} strokeWidth={1.8} fillOpacity={0.15} showDots />
          <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--mono)", fontSize: 9, color: "rgba(255,255,255,0.6)", marginTop: 2 }}>
            <span>W09</span><span>W16</span>
          </div>
        </div>
      </div>
    </V1.Tile>
  );
};

V1.RoundsTile = function ({ pad }) {
  return (
    <V1.Tile col="span 2" row="span 2" label="REVIEW ROUNDS" pad={pad}>
      <div style={{ marginTop: "auto" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <div style={{ fontFamily: "var(--display)", fontSize: 56, fontWeight: 600, letterSpacing: -1.8, lineHeight: 1 }}>{METRICS.avgRounds}</div>
          <Delta value={METRICS.avgRoundsDelta} invert />
        </div>
        <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--muted-fg)", marginTop: 4 }}>avg comments / merged MR · 30d</div>
        <div style={{ display: "flex", gap: 3, marginTop: 10 }}>
          {[3, 1, 2, 1, 2, 1, 3, 1, 2, 1].map((v, i) => (
            <div key={i} style={{ flex: 1, height: 18, background: "var(--accent-dim)", borderRadius: 1, position: "relative" }}>
              <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: `${v * 25}%`, background: "var(--accent)" }} />
            </div>
          ))}
        </div>
      </div>
    </V1.Tile>
  );
};

V1.LinkageTile = function ({ pad, showTexture }) {
  return (
    <V1.Tile col="span 3" row="span 2" label="JIRA LINKAGE · 30D" pad={pad}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 90px", gap: 10, alignItems: "center", height: "100%" }}>
        <div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <div style={{ fontFamily: "var(--display)", fontSize: 60, fontWeight: 600, letterSpacing: -2, lineHeight: 1 }}>{METRICS.linkage}</div>
            <div style={{ fontSize: 20, color: "var(--muted-fg)" }}>%</div>
            <Delta value={METRICS.linkageDelta} />
          </div>
          <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--muted-fg)", marginTop: 6 }}>
            MRs referencing a Jira key
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 10, fontFamily: "var(--mono)", fontSize: 10, color: "var(--muted-fg)" }}>
            <span><span style={{ color: "var(--accent)", fontWeight: 700 }}>94</span> linked</span>
            <span><span style={{ color: "var(--fg)", fontWeight: 700 }}>6</span> loose</span>
          </div>
        </div>
        <div style={{ position: "relative", width: 80, height: 80 }}>
          <DitherDisc size={80} cell={4} color={showTexture ? "var(--accent)" : "var(--accent)"} density={0.94} seed={22} />
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontFamily: "var(--mono)", fontSize: 11, fontWeight: 700, color: "var(--accent-on)", background: "var(--accent)", borderRadius: 999, width: 28, height: 28, margin: "auto" }}>24/7</div>
        </div>
      </div>
    </V1.Tile>
  );
};

V1.TicketsTile = function ({ pad }) {
  const byCat = { indeterminate: [], new: [], done: [] };
  TICKETS.forEach((t) => byCat[t.cat].push(t));
  return (
    <V1.Tile col="span 7" row="span 3" label={`JIRA · ${TICKETS.length} assigned to you`} pad={pad}
      right={<span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--muted-fg)" }}>OPEN BOARD ↗</span>}
      title="Tickets on your plate" titleSize={18}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginTop: 6, height: "100%" }}>
        {[["In flight", "indeterminate", "accent"], ["Queued", "new", "default"], ["Shipped", "done", "ok"]].map(([label, key, tone]) => (
          <div key={key} style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <Pill tone={tone}>{label} · {byCat[key].length}</Pill>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, overflow: "hidden" }}>
              {byCat[key].map((t) => (
                <div key={t.key} style={{ padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 3, background: "var(--card-alt)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                    <span style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, color: "var(--accent)" }}>{t.key}</span>
                    <span style={{ fontFamily: "var(--mono)", fontSize: 9.5, color: "var(--dim-fg)" }}>{t.due}</span>
                  </div>
                  <div style={{ fontSize: 12, lineHeight: 1.35, color: "var(--fg)", textWrap: "pretty" }}>{t.title}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </V1.Tile>
  );
};

V1.PRsTile = function ({ pad }) {
  return (
    <V1.Tile col="span 5" row="span 3" label={`PULL REQUESTS · ${OPEN_MRS_MINE.length} YOURS · ${OPEN_MRS_REVIEW.length} TO REVIEW`} pad={pad}
      title="Open PRs" titleSize={18}>
      <div style={{ display: "grid", gridTemplateRows: "1fr 1fr", gap: 10, flex: 1, minHeight: 0 }}>
        <V1.PRBlock heading="Yours" items={OPEN_MRS_MINE} kind="mine" />
        <V1.PRBlock heading="Awaiting your review" items={OPEN_MRS_REVIEW} kind="review" />
      </div>
    </V1.Tile>
  );
};

V1.PRBlock = function ({ heading, items, kind }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <MonoLabel>{heading}</MonoLabel>
        <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
        <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--muted-fg)" }}>{items.length}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, overflow: "hidden" }}>
        {items.map((m) => (
          <div key={m.id} style={{ display: "grid", gridTemplateColumns: "38px 1fr auto", gap: 8, alignItems: "center", padding: "6px 8px", borderBottom: "1px dashed var(--border)" }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, fontWeight: 700, color: "var(--accent)" }}>{m.num}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.title}</div>
              <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--dim-fg)" }}>{m.repo} · {kind === "mine" ? `${m.rounds} rounds · ${m.age}` : `${m.author} · ${m.age}`}</div>
            </div>
            {kind === "mine" ? (
              <Pill tone={m.pipeline === "pass" ? "ok" : m.pipeline === "fail" ? "warn" : "muted"} mono>
                {m.draft ? "DRAFT" : m.pipeline.toUpperCase()}
              </Pill>
            ) : <Pill tone="accent" mono>REVIEW</Pill>}
          </div>
        ))}
      </div>
    </div>
  );
};

V1.ActivityTile = function ({ pad, showTexture }) {
  const data = ACTIVITY_14D.map((a) => a.n);
  return (
    <V1.Tile col="span 6" row="span 2" label="ACTIVITY · 14D · 147 EVENTS · PEAK 23/DAY" pad={pad}
      title="Signal strength" titleSize={16}>
      <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
        {showTexture ? (
          <DitherBars values={data} height={90} cell={5} color="var(--accent)" style={{ flex: 1 }} />
        ) : (
          <Bars data={data.map((n) => ({ n }))} accent="var(--accent)" track="var(--accent-dim)" height={90} />
        )}
        <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--mono)", fontSize: 9.5, color: "var(--dim-fg)", marginTop: 4 }}>
          {ACTIVITY_14D.filter((_, i) => i % 2 === 0).map((a) => <span key={a.d}>{a.d.split(" ")[1]}</span>)}
        </div>
      </div>
    </V1.Tile>
  );
};

V1.TurnaroundTile = function ({ pad }) {
  return (
    <V1.Tile col="span 3" row="span 2" label="TURNAROUND · OPEN → MERGE" pad={pad}>
      <div style={{ marginTop: "auto" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <div style={{ fontFamily: "var(--display)", fontSize: 56, fontWeight: 600, letterSpacing: -1.8, lineHeight: 1 }}>{METRICS.turnaround}</div>
          <Delta value={METRICS.turnaroundDelta} invert />
        </div>
        <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--muted-fg)", marginTop: 4 }}>median across 32 merged MRs</div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 3, marginTop: 10, height: 32 }}>
          {TURNAROUND_BUCKETS.map((b) => (
            <div key={b.b} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "stretch", gap: 2 }}>
              <div style={{ height: b.n * 4, background: "var(--accent)", borderRadius: 1 }} />
              <div style={{ fontFamily: "var(--mono)", fontSize: 8.5, color: "var(--muted-fg)", textAlign: "center" }}>{b.b}</div>
            </div>
          ))}
        </div>
      </div>
    </V1.Tile>
  );
};

V1.ReviewsTile = function ({ pad }) {
  return (
    <V1.Tile col="span 3" row="span 2" label="REVIEWS GIVEN · 30D" pad={pad}>
      <div style={{ marginTop: "auto" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <div style={{ fontFamily: "var(--display)", fontSize: 56, fontWeight: 600, letterSpacing: -1.8, lineHeight: 1 }}>{METRICS.reviewsGiven}</div>
          <Delta value={METRICS.reviewsDelta} />
        </div>
        <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--muted-fg)", marginTop: 4 }}>comments on teammates' MRs</div>
        <Sparkline data={[2, 4, 1, 5, 3, 6, 2, 8, 4, 7, 5, 9, 6, 10]} accent="var(--accent)" height={28} strokeWidth={1.8} fillOpacity={0.15} style={{ marginTop: 10 }} />
      </div>
    </V1.Tile>
  );
};

V1.SnapshotsTile = function ({ pad, onNavigate }) {
  return (
    <V1.Tile col="span 5" row="span 2" label="WEEKLY SNAPSHOTS" pad={pad}
      right={<button onClick={() => onNavigate && onNavigate("snapshots")} style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer", fontFamily: "var(--mono)", fontSize: 10, color: "var(--accent)", fontWeight: 700 }}>SEE ALL ↗</button>}
      title="Keep receipts for review season.">
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
        {SNAPSHOTS.slice(0, 4).map((s, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "90px 1fr 140px", gap: 8, padding: "6px 4px", borderBottom: "1px dashed var(--border)", alignItems: "center" }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--muted-fg)" }}>{s.date}</span>
            <span style={{ fontSize: 11.5, color: "var(--fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.note}</span>
            <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--accent)", textAlign: "right" }}>
              {s.merged} merged · {s.reviews} reviews · {s.linkage}%
            </span>
          </div>
        ))}
      </div>
    </V1.Tile>
  );
};

V1.ExportTile = function ({ pad, showTexture, onNavigate }) {
  return (
    <V1.Tile col="span 4" row="span 2" variant="accent" label="EVIDENCE · 90D BUNDLE" pad={pad}
      right={<button onClick={() => onNavigate && onNavigate("evidence")} style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer", fontFamily: "var(--mono)", fontSize: 10, color: "rgba(255,255,255,0.9)", fontWeight: 700 }}>OPEN ↗</button>}>
      {showTexture && (
        <div style={{ position: "absolute", right: -30, bottom: -30, opacity: 0.3, pointerEvents: "none" }}>
          <DitherField width={220} height={180} cell={6} color="#ffffff"
            falloff={(u, v) => Math.max(0, 1 - v * 1.2)} jitter={0.35} seed={4} />
        </div>
      )}
      <div style={{ position: "relative", marginTop: "auto" }}>
        <div style={{ fontFamily: "var(--display)", fontSize: 28, fontWeight: 600, lineHeight: 1.05, letterSpacing: -0.6 }}>
          Bundle last 90d as markdown + PDF.
        </div>
        <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "rgba(255,255,255,0.75)", marginTop: 10 }}>
          tickets · MRs · reviews · SLA · on-call
        </div>
      </div>
    </V1.Tile>
  );
};

V1.CommitsTile = function ({ pad }) {
  return (
    <V1.Tile col="span 3" row="span 2" label="RECENT COMMITS" pad={pad}>
      <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 4 }}>
        {RECENT_COMMITS.map((c) => (
          <div key={c.sha} style={{ padding: "5px 0", borderBottom: "1px dashed var(--border)" }}>
            <div style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
              <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--accent)", fontWeight: 700 }}>{c.sha}</span>
              <span style={{ fontSize: 11, color: "var(--fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{c.msg}</span>
            </div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 9.5, color: "var(--dim-fg)", marginLeft: 2 }}>{c.repo} · {c.when} ago</div>
          </div>
        ))}
      </div>
    </V1.Tile>
  );
};

V1.Footer = function Footer() {
  return (
    <div style={{ marginTop: 32, padding: "16px 0", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--muted-fg)" }}>
      <div>eSpace/DevHub · {ME.team} · refreshed 32s ago</div>
      <div>↗ github.com/espace/devhub</div>
    </div>
  );
};

window.V1 = V1;
