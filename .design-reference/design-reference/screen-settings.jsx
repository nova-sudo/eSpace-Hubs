// Settings — integrations (connect/disconnect/rotate) + account + privacy.
// Privacy-first copywriting is the point.

Screens.Settings = function Settings({ dark, accent, showTexture, onNavigate }) {
  const [tab, setTab] = React.useState("integrations");
  const tabs = [
    ["integrations", "Integrations"],
    ["account",      "Account"],
    ["snapshots",    "Snapshots & privacy"],
    ["danger",       "Danger zone"],
  ];

  return (
    <Screens.Page>
      <Screens.PageHeader
        crumb="Settings · your tokens, your data"
        title="Your keys. Your terms."
        italicWord="terms"
        subtitle="Everything lives in your browser. We never see your tokens, and your metrics never leave this tab unless you export them."
        right={<Screens.Btn variant="ghost" onClick={() => onNavigate && onNavigate("dashboard")}>← Dashboard</Screens.Btn>}
      />

      <div style={{ display: "grid", gridTemplateColumns: "220px minmax(0,1fr)", gap: 32, alignItems: "start" }}>
        <nav style={{ display: "flex", flexDirection: "column", gap: 2, position: "sticky", top: 80 }}>
          {tabs.map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} style={{
              textAlign: "left", padding: "10px 14px",
              border: "none", background: tab === id ? "var(--accent-dim)" : "transparent",
              color: tab === id ? "var(--accent)" : "var(--fg)",
              borderLeft: tab === id ? "2px solid var(--accent)" : "2px solid transparent",
              fontFamily: "var(--mono)", fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase",
              cursor: "pointer",
            }}>{label}</button>
          ))}
        </nav>

        <div>
          {tab === "integrations" && <IntegrationsTab />}
          {tab === "account"      && <AccountTab />}
          {tab === "snapshots"    && <SnapshotsPrefsTab />}
          {tab === "danger"       && <DangerTab />}
        </div>
      </div>
    </Screens.Page>
  );
};

function IntegrationsTab() {
  return (
    <>
      <Screens.Section num="01 /" title="Connected providers">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {INTEGRATIONS.map((p) => <ProviderCard key={p.id} p={p} />)}
        </div>
      </Screens.Section>

      <Screens.Section num="02 /" title="How tokens are stored">
        <Screens.Card>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
            <PrivacyPoint
              title="localStorage only"
              body="Your Jira email, GitLab PAT, and GitHub OAuth token live in your browser's localStorage — scoped to this origin. They never touch our server."
            />
            <PrivacyPoint
              title="We proxy, not persist"
              body="When you load the dashboard, the browser sends each token to our API route, which forwards it to Jira / GitLab / GitHub to dodge CORS. We don't log the token and we don't cache the response."
            />
            <PrivacyPoint
              title="Minimum scopes"
              body="GitLab PAT: read_api. GitHub OAuth: repo + read:user. Jira: user-scoped API token. We never request write scopes."
            />
            <PrivacyPoint
              title="Rotate any time"
              body="Revoke a token in its source (Jira profile, GitLab preferences, GitHub settings) and the connection goes dark within 60s. No cleanup required on our side."
            />
          </div>
        </Screens.Card>
      </Screens.Section>
    </>
  );
}

function ProviderCard({ p }) {
  return (
    <Screens.Card>
      <div style={{ display: "grid", gridTemplateColumns: "48px 1fr auto", gap: 16, alignItems: "center" }}>
        <div style={{ width: 48, height: 48, borderRadius: 3, background: "var(--accent-dim)", color: "var(--accent)", display: "grid", placeItems: "center", fontFamily: "var(--mono)", fontSize: 15, fontWeight: 700 }}>
          {p.id === "jira" ? "J" : p.id === "gitlab" ? "GL" : "GH"}
        </div>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 2 }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>{p.label}</span>
            <span style={{ fontFamily: "var(--mono)", fontSize: 10, padding: "2px 6px", background: "var(--accent-dim)", color: "var(--good)", borderRadius: 999, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>
              ● Connected
            </span>
          </div>
          <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--muted-fg)" }}>
            {p.user} · since {p.since} · last sync 32s ago
          </div>
          <div style={{ fontSize: 11.5, color: "var(--dim-fg)", marginTop: 6 }}>
            {p.id === "jira"   && "Endpoint: crealogixme.atlassian.net · scopes: read user · basic-auth (email + API token)"}
            {p.id === "gitlab" && "Endpoint: git.bcn.crealogix.net · scopes: read_api · PAT stored locally"}
            {p.id === "github" && "Endpoint: api.github.com · scopes: repo, read:user · OAuth 2.0"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <Screens.Btn variant="ghost" size="sm">Rotate token</Screens.Btn>
          <Screens.Btn variant="danger" size="sm">Disconnect</Screens.Btn>
        </div>
      </div>
    </Screens.Card>
  );
}

function PrivacyPoint({ title, body }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ width: 5, height: 5, borderRadius: 3, background: "var(--accent)" }} />
        <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--fg)" }}>{title}</span>
      </div>
      <div style={{ fontSize: 12.5, color: "var(--muted-fg)", lineHeight: 1.55, paddingLeft: 13 }}>{body}</div>
    </div>
  );
}

function AccountTab() {
  return (
    <Screens.Section num="01 /" title="Profile">
      <Screens.Card>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <Screens.Field label="Display name"><Screens.Input defaultValue={ME.name} /></Screens.Field>
          <Screens.Field label="Handle" hint="Used to identify your MRs and reviews in GitLab/GitHub."><Screens.Input defaultValue={ME.handle} mono /></Screens.Field>
          <Screens.Field label="Team"><Screens.Input defaultValue={ME.team} /></Screens.Field>
          <Screens.Field label="Current level" hint="Appears only on exports. We don't read this from anywhere."><Screens.Input defaultValue={ME.level} mono /></Screens.Field>
        </div>
      </Screens.Card>
    </Screens.Section>
  );
}

function SnapshotsPrefsTab() {
  return (
    <>
      <Screens.Section num="01 /" title="Snapshot schedule">
        <Screens.Card>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            <Screens.Field label="Frequency" hint="Weekly is recommended. Daily creates noise; monthly misses deltas.">
              <Screens.Input defaultValue="Weekly · Mondays at 09:00 Africa/Cairo" />
            </Screens.Field>
            <Screens.Field label="Retention" hint="How many weeks of history to keep in your browser.">
              <Screens.Input defaultValue="26 weeks (6 months)" />
            </Screens.Field>
          </div>
          <div style={{ marginTop: 10, padding: "12px 14px", background: "var(--accent-dim)", borderRadius: 3, fontSize: 12.5, color: "var(--fg)", lineHeight: 1.5 }}>
            <strong style={{ color: "var(--accent)" }}>Heads up:</strong> snapshots live in your browser storage. Clearing site data wipes them. Consider exporting to JSON before switching machines.
          </div>
        </Screens.Card>
      </Screens.Section>
      <Screens.Section num="02 /" title="What we explicitly do not do">
        <Screens.Card>
          {[
            ["No leaderboard.", "Your metrics are never compared to teammates inside this tool. Personal vs. personal baseline only."],
            ["No manager view.", "There is no role-based manager dashboard. If that product ever ships, it will be a separate app with separate consent."],
            ["No telemetry.", "We don't track which tiles you look at, which tickets you hover, or when you open the app."],
            ["No third-party cookies.", "The only cookies we set are a session cookie for the OAuth handshake with GitHub — cleared on disconnect."],
          ].map(([t, b]) => (
            <div key={t} style={{ padding: "12px 0", borderBottom: "1px dashed var(--border)" }}>
              <div style={{ fontFamily: "var(--display)", fontSize: 15, fontWeight: 600, marginBottom: 3 }}>{t}</div>
              <div style={{ fontSize: 13, color: "var(--muted-fg)", lineHeight: 1.5 }}>{b}</div>
            </div>
          ))}
        </Screens.Card>
      </Screens.Section>
    </>
  );
}

function DangerTab() {
  return (
    <Screens.Section num="01 /" title="Danger zone">
      <Screens.Card>
        {[
          ["Export snapshots as JSON", "Download all local snapshots as a portable archive.", "Export JSON", "ghost"],
          ["Clear snapshot history", "Deletes all weekly snapshots from this browser. Current metrics stay.", "Clear snapshots", "danger"],
          ["Disconnect all providers", "Revokes tokens from localStorage and logs out of GitHub OAuth.", "Disconnect all", "danger"],
          ["Reset everything", "Wipes all local state including preferences. You'll see the onboarding screen next load.", "Reset", "danger"],
        ].map(([t, b, cta, v]) => (
          <div key={t} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 20, alignItems: "center", padding: "14px 0", borderBottom: "1px dashed var(--border)" }}>
            <div>
              <div style={{ fontFamily: "var(--display)", fontSize: 14, fontWeight: 600, marginBottom: 2 }}>{t}</div>
              <div style={{ fontSize: 12.5, color: "var(--muted-fg)", lineHeight: 1.45 }}>{b}</div>
            </div>
            <Screens.Btn variant={v} size="sm">{cta}</Screens.Btn>
          </div>
        ))}
      </Screens.Card>
    </Screens.Section>
  );
}
