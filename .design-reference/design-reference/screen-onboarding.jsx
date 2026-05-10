// Onboarding / empty state — when 0 integrations connected.
// This is the first impression. Sell the product, don't just show a form.

Screens.Onboarding = function Onboarding({ dark, accent, showTexture, onNavigate }) {
  const [step, setStep] = React.useState(0);
  const steps = ["jira", "gitlab", "github"];
  const stepLabels = { jira: "Jira", gitlab: "GitLab", github: "GitHub" };

  return (
    <Screens.Page style={{ maxWidth: 1200, margin: "0 auto", paddingTop: 64 }}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 440px", gap: 48, alignItems: "start" }}>
        {/* Left — the pitch */}
        <div>
          <MonoLabel>Welcome · 0 of 3 connected</MonoLabel>
          <h1 style={{
            fontFamily: "var(--display)", fontWeight: 600,
            fontSize: "clamp(48px, 6vw, 82px)", lineHeight: 0.95, letterSpacing: -2.2,
            margin: "10px 0 18px", textWrap: "balance",
          }}>
            Receipts for <em style={{ fontStyle: "italic", fontFamily: 'ui-serif, "Iowan Old Style", Georgia, serif', color: "var(--accent)" }}>review</em> season. Calm for the rest of it.
          </h1>
          <p style={{ fontSize: 16, color: "var(--muted-fg)", lineHeight: 1.55, maxWidth: 560, marginBottom: 28 }}>
            Connect Jira, GitLab, and GitHub once. Watch your metrics quietly for 90 days. When performance review lands, export the whole case in one click.
          </p>

          {/* Value props */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginBottom: 32 }}>
            {[
              ["Live, not lagging", "Everything proxies through to Jira/GitLab/GitHub on page load. No cron. No stale cache."],
              ["Private by default", "Tokens stay in your browser. We don't have a database. There is no manager dashboard."],
              ["Your story, your data", "You star the PRs that mattered. You write the narrative. The tool just organizes."],
              ["Works with self-hosted", "Self-hosted GitLab, Atlassian Cloud Jira, and GitHub.com all work out of the box."],
            ].map(([t, b]) => (
              <div key={t}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span style={{ width: 6, height: 6, borderRadius: 3, background: "var(--accent)" }} />
                  <span style={{ fontFamily: "var(--mono)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>{t}</span>
                </div>
                <div style={{ fontSize: 12.5, color: "var(--muted-fg)", lineHeight: 1.5, paddingLeft: 14 }}>{b}</div>
              </div>
            ))}
          </div>

          {/* Dashboard preview (blurred tease) */}
          <div style={{ position: "relative", border: "1px solid var(--border)", borderRadius: 4, overflow: "hidden", height: 220, background: "var(--card)" }}>
            <div style={{ position: "absolute", inset: 0, padding: 14, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, filter: "blur(3px)", opacity: 0.55, pointerEvents: "none" }}>
              {[...Array(12)].map((_, i) => (
                <div key={i} style={{
                  background: i === 1 ? "var(--accent)" : "var(--card-alt)",
                  border: "1px solid var(--border)", borderRadius: 3,
                  gridRow: i === 1 ? "span 2" : "span 1",
                  height: i === 1 ? "auto" : 48,
                }} />
              ))}
            </div>
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, transparent, var(--bg) 80%)", display: "flex", alignItems: "flex-end", justifyContent: "center", paddingBottom: 16 }}>
              <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--muted-fg)", textTransform: "uppercase", letterSpacing: 0.6 }}>
                your dashboard, once connected ↓
              </span>
            </div>
          </div>
        </div>

        {/* Right — connect wizard */}
        <Screens.Card style={{ position: "sticky", top: 80 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <MonoLabel>Connect · step {step + 1} of 3</MonoLabel>
            <div style={{ display: "flex", gap: 4 }}>
              {steps.map((s, i) => (
                <span key={s} style={{
                  width: 18, height: 3, background: i <= step ? "var(--accent)" : "var(--border)",
                  borderRadius: 2,
                }} />
              ))}
            </div>
          </div>

          <h3 style={{ margin: "0 0 4px", fontFamily: "var(--display)", fontSize: 22, fontWeight: 600, letterSpacing: -0.4 }}>
            Connect {stepLabels[steps[step]]}
          </h3>
          <p style={{ fontSize: 12.5, color: "var(--muted-fg)", lineHeight: 1.5, marginBottom: 18 }}>
            {step === 0 && "Your Atlassian email plus a personal API token (create one at id.atlassian.com → security → API tokens)."}
            {step === 1 && "A GitLab personal access token with read_api scope, created at your GitLab instance → preferences → access tokens."}
            {step === 2 && "We'll redirect you to GitHub to authorize. You can revoke any time at github.com/settings/applications."}
          </p>

          {step === 0 && (
            <>
              <Screens.Field label="Atlassian workspace URL">
                <Screens.Input placeholder="https://your-company.atlassian.net" mono />
              </Screens.Field>
              <Screens.Field label="Email"><Screens.Input placeholder="m.hany@espace.com.eg" /></Screens.Field>
              <Screens.Field label="API token" hint="Stays in your browser. Never sent to our server except as a proxied Authorization header.">
                <Screens.Input placeholder="ATATT3xFfGF0T..." mono type="password" />
              </Screens.Field>
            </>
          )}
          {step === 1 && (
            <>
              <Screens.Field label="GitLab URL"><Screens.Input placeholder="https://git.your-company.net" mono /></Screens.Field>
              <Screens.Field label="Personal access token" hint="read_api scope is enough. Don't grant write.">
                <Screens.Input placeholder="glpat-xxxxxxxxxxxxxxxxxxxx" mono type="password" />
              </Screens.Field>
            </>
          )}
          {step === 2 && (
            <div style={{ padding: "14px 16px", background: "var(--card-alt)", border: "1px dashed var(--border)", borderRadius: 3, marginBottom: 16 }}>
              <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--muted-fg)", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>Redirect</div>
              <div style={{ fontSize: 13 }}>You'll be bounced to <span style={{ fontFamily: "var(--mono)", color: "var(--accent)" }}>github.com/login/oauth/authorize</span> to grant <strong>repo</strong> + <strong>read:user</strong>. You'll come right back here.</div>
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
            <Screens.Btn variant="ghost" size="sm" onClick={() => step > 0 && setStep(step - 1)} disabled={step === 0}>← Back</Screens.Btn>
            {step < 2 ? (
              <Screens.Btn variant="primary" onClick={() => setStep(step + 1)}>
                {step === 0 ? "Test & continue" : "Continue"} →
              </Screens.Btn>
            ) : (
              <Screens.Btn variant="primary" onClick={() => onNavigate && onNavigate("dashboard")}>
                Authorize & finish
              </Screens.Btn>
            )}
          </div>

          <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px dashed var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 11.5, color: "var(--muted-fg)" }}>Only connect what you use.</span>
            <button onClick={() => onNavigate && onNavigate("dashboard")} style={{ border: "none", background: "transparent", cursor: "pointer", fontFamily: "var(--mono)", fontSize: 10.5, fontWeight: 600, color: "var(--dim-fg)", textTransform: "uppercase", letterSpacing: 0.5 }}>
              Skip for now →
            </button>
          </div>
        </Screens.Card>
      </div>
    </Screens.Page>
  );
};
