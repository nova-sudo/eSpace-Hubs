"use client";

import { toast } from "sonner";
import { Button, Card, MonoLabel, Section } from "@/components/ui";
import {
  DASHBOARD_PROVIDER_DEPENDENCIES,
  disconnectProvider,
  PROVIDERS,
  useIntegrations,
} from "@/features/integrations";
import {
  useActiveHub,
  useAllowedProviders,
} from "@/features/hubs";
import { startGitHubOAuth } from "@/lib/oauth-pkce";
import { useMyEngagementConfig } from "@/features/auth";
import {
  GitLabTokenForm,
  JenkinsTokenForm,
  JiraTokenForm,
} from "../token-forms";

/** Pre-computed: provider id → tile labels that depend on it. */
const TILES_BY_PROVIDER = (() => {
  const out = {};
  for (const dep of Object.values(DASHBOARD_PROVIDER_DEPENDENCIES)) {
    for (const pid of dep.providers) {
      (out[pid] ??= []).push(dep.label);
    }
  }
  return out;
})();

/** Map provider id → OAuth start function. Single point of dispatch. */
const OAUTH_STARTERS = {
  github: startGitHubOAuth,
};

export function IntegrationsTab() {
  const allowed = useAllowedProviders();
  const hub = useActiveHub();
  const totalCatalog = Object.keys(PROVIDERS).length;
  const hiddenCount = totalCatalog - allowed.length;

  return (
    <>
      <Section num="00 /" title="Integration health">
        <IntegrationHealthSummary providers={allowed} />
      </Section>

      <Section num="01 /" title="Connected providers">
        <div className="flex flex-col gap-3">
          {allowed.map((p) => (
            <ProviderCard key={p.id} provider={p} />
          ))}
          {hub && hiddenCount > 0 ? (
            <div
              className="rounded-[var(--radius-sub)] border border-dashed border-border bg-card-alt px-4 py-3 text-[12px] text-muted-fg"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {hiddenCount} provider{hiddenCount === 1 ? " is" : "s are"} hidden in
              the <span className="text-fg">{hub.label}</span> — they aren't
              used by this hub's widgets. Switch to a hub that uses them to
              manage their tokens.
            </div>
          ) : null}
        </div>
      </Section>

      <Section num="02 /" title="How tokens are stored">
        <Card className="p-6">
          <div className="grid grid-cols-2 gap-6">
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
        </Card>
      </Section>
    </>
  );
}

function IntegrationHealthSummary({ providers }) {
  const { isConnected } = useIntegrations();
  return (
    <Card className="overflow-hidden p-0">
      <table className="w-full text-left" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr
            className="border-b border-border bg-card-alt"
            style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
          >
            <th className="px-4 py-2.5 font-semibold uppercase tracking-[0.4px] text-muted-fg">
              Provider
            </th>
            <th className="px-4 py-2.5 font-semibold uppercase tracking-[0.4px] text-muted-fg">
              Status
            </th>
            <th className="px-4 py-2.5 font-semibold uppercase tracking-[0.4px] text-muted-fg">
              Dashboard tiles
            </th>
          </tr>
        </thead>
        <tbody>
          {providers.map((p, i) => {
            const connected = isConnected(p.id);
            const tiles = TILES_BY_PROVIDER[p.id] ?? [];
            return (
              <tr
                key={p.id}
                className={i < providers.length - 1 ? "border-b border-border" : ""}
              >
                <td
                  className="px-4 py-3 font-semibold"
                  style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}
                >
                  {p.label}
                </td>
                <td className="px-4 py-3">
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-bold uppercase tracking-[0.4px]"
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 10,
                      background: connected ? "var(--accent-dim)" : "rgba(0,0,0,0.04)",
                      color: connected ? "var(--good)" : "var(--muted-fg)",
                    }}
                  >
                    <span
                      className="inline-block h-1.5 w-1.5 rounded-full"
                      style={{ background: connected ? "var(--good)" : "var(--muted-fg)" }}
                    />
                    {connected ? "Connected" : "Not connected"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {tiles.length === 0 ? (
                    <span
                      className="text-dim-fg"
                      style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
                    >
                      —
                    </span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {tiles.map((t) => (
                        <span
                          key={t}
                          className="rounded-[3px] border border-border bg-card-alt px-1.5 py-0.5 text-muted-fg"
                          style={{ fontFamily: "var(--font-mono)", fontSize: 9.5 }}
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

function ProviderCard({ provider }) {
  const { integrations, isConnected } = useIntegrations();
  const { config: engagementCfg } = useMyEngagementConfig();
  const connected = isConnected(provider.id);
  const meta = integrations[provider.id];

  return (
    <Card className="p-5">
      <div className="grid grid-cols-[48px_1fr_auto] items-start gap-4">
        <div
          className="grid h-12 w-12 place-items-center rounded-[var(--radius-sub)] bg-accent-dim font-bold text-accent"
          style={{ fontFamily: "var(--font-mono)", fontSize: 15 }}
        >
          {provider.glyph}
        </div>
        <div>
          <div className="mb-0.5 flex items-center gap-2.5">
            <span className="text-[15px] font-semibold">{provider.label}</span>
            <span
              className="rounded-full px-2 py-0.5 font-bold uppercase tracking-[0.4px]"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                background: connected
                  ? "var(--accent-dim)"
                  : "rgba(0,0,0,0.04)",
                color: connected ? "var(--good)" : "var(--muted-fg)",
              }}
            >
              {connected ? "● Connected" : "○ Not connected"}
            </span>
          </div>
          {connected && meta ? (
            <div
              className="text-muted-fg"
              style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
            >
              {meta.username ? `@${meta.username}` : ""}
              {meta.connectedAt
                ? ` · since ${new Date(meta.connectedAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}`
                : ""}
            </div>
          ) : null}
          <div className="mt-1.5 text-[11.5px] text-dim-fg">
            {provider.description} · scopes: {provider.scopes}
          </div>
          {(TILES_BY_PROVIDER[provider.id] ?? []).length > 0 ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span
                className="text-dim-fg"
                style={{ fontFamily: "var(--font-mono)", fontSize: 9.5 }}
              >
                Affects:
              </span>
              {(TILES_BY_PROVIDER[provider.id] ?? []).map((t) => (
                <span
                  key={t}
                  className="rounded-[3px] border border-border bg-card-alt px-1.5 py-0.5 text-muted-fg"
                  style={{ fontFamily: "var(--font-mono)", fontSize: 9.5 }}
                >
                  {t}
                </span>
              ))}
            </div>
          ) : null}
          {!connected ? (
            <div className="mt-4">
              {provider.authMode === "token" ? (
                <JiraTokenForm />
              ) : provider.authMode === "pat" ? (
                <GitLabTokenForm />
              ) : provider.authMode === "basic" ? (
                <JenkinsTokenForm />
              ) : (
                <Button
                  onClick={async () => {
                    const start = OAUTH_STARTERS[provider.id];
                    if (!start) {
                      toast.error(
                        `No OAuth starter wired for ${provider.label}`,
                      );
                      return;
                    }
                    try {
                      // Pass per-user engagement config — the GitHub
                      // client id depends on whether the user is on
                      // the eSpace or Crealogix engagement.
                      await start({
                        clientId: engagementCfg?.githubClientId,
                      });
                    } catch (e) {
                      toast.error(e.message);
                    }
                  }}
                >
                  Connect {provider.label}
                </Button>
              )}
            </div>
          ) : null}
        </div>
        {connected ? (
          <div className="flex gap-1.5">
            <Button variant="ghost" size="sm" disabled>
              Rotate token
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                disconnectProvider(provider.id);
                toast.success(`Disconnected from ${provider.label}`);
              }}
            >
              Disconnect
            </Button>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function PrivacyPoint({ title, body }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="block h-[5px] w-[5px] rounded-full bg-accent" />
        <span
          className="uppercase tracking-[0.5px] font-bold"
          style={{ fontFamily: "var(--font-mono)", fontSize: 10.5 }}
        >
          {title}
        </span>
      </div>
      <div className="pl-[13px] text-[12.5px] leading-[1.55] text-muted-fg">{body}</div>
    </div>
  );
}
