"use client";

import { toast } from "sonner";
import { Badge, Button, Card, Section } from "@/components/ui";
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
    <div className="flex flex-col gap-8">
      <Section title="Integration health">
        <IntegrationHealthSummary providers={allowed} />
      </Section>

      <Section title="Connected providers">
        <div className="flex flex-col gap-3">
          {allowed.map((p) => (
            <ProviderCard key={p.id} provider={p} />
          ))}
          {hub && hiddenCount > 0 ? (
            <div className="rounded-[var(--radius-lg)] bg-card-alt px-4 py-3 text-[12px] text-muted-fg">
              {hiddenCount} provider{hiddenCount === 1 ? " is" : "s are"} hidden in
              the <span className="text-fg font-semibold">{hub.label}</span> — they
              aren't used by this hub's widgets. Switch to a hub that uses them to
              manage their tokens.
            </div>
          ) : null}
        </div>
        <LocalCallout />
      </Section>

      <Section title="How tokens are stored">
        <Card className="p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
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

      {/* The token promise above is absolute — "they never touch our server."
          The AI features are the honest exception: text and attached documents
          DO leave the browser, reach our API, and go on to a third-party model.
          Saying so plainly here is the price of making the token claim
          believable everywhere else. */}
      <Section title="What the AI sees">
        <Card className="p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <PrivacyPoint
              title="AI text does leave"
              body="Unlike your tokens, what you type into the AI surfaces — goal descriptions, tracker descriptions, chat — is sent to our API and on to the provider you picked in Account (Claude, Mistral, GLM, OpenRouter). There's no on-device model; that trip is how you get an answer."
            />
            <PrivacyPoint
              title="Attached documents too"
              body="Attach a PDF, DOCX, XLSX or CSV to “Build your own tracker” and the file is uploaded to our API, its text pulled out there, and that text sent to the same AI provider. You see the extracted text and can edit or trim it before it goes anywhere."
            />
            <PrivacyPoint
              title="We don't keep the file"
              body="Uploads are parsed in memory and dropped with the response — no disk, no database, no object storage. We log the size, type and outcome so we can debug failures; never the contents. Only the tracker you approve is saved."
            />
            <PrivacyPoint
              title="Their retention, their rules"
              body="Once text reaches the AI provider it's covered by that provider's policy — commercial APIs commonly hold inputs and outputs for up to 30 days. Don't attach anything you wouldn't send to that vendor directly."
            />
          </div>
        </Card>
      </Section>
    </div>
  );
}

function IntegrationHealthSummary({ providers }) {
  const { isConnected } = useIntegrations();
  return (
    <Card className="overflow-hidden p-0">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-line">
            <th className="px-4 py-2.5 text-[12px] font-semibold text-muted-fg">
              Provider
            </th>
            <th className="px-4 py-2.5 text-[12px] font-semibold text-muted-fg">
              Status
            </th>
            <th className="px-4 py-2.5 text-[12px] font-semibold text-muted-fg">
              Dashboard tiles
            </th>
          </tr>
        </thead>
        <tbody>
          {providers.map((p) => {
            const connected = isConnected(p.id);
            const tiles = TILES_BY_PROVIDER[p.id] ?? [];
            return (
              <tr key={p.id} className="border-t border-line first:border-t-0">
                <td className="px-4 py-3 text-[13px] font-semibold text-fg">
                  {p.label}
                </td>
                <td className="px-4 py-3">
                  <Badge tone={connected ? "mint" : "neutral"} dot>
                    {connected ? "Connected" : "Not connected"}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  {tiles.length === 0 ? (
                    <span className="text-[11.5px] text-dim-fg">—</span>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {tiles.map((t) => (
                        <Badge key={t} tone="neutral">
                          {t}
                        </Badge>
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
      <div className="grid grid-cols-[44px_1fr_auto] items-start gap-4">
        <ProviderGlyph glyph={provider.glyph} />
        <div>
          <div className="mb-0.5 flex items-center gap-2.5">
            <span className="text-[15px] font-bold text-fg">{provider.label}</span>
            <Badge tone={connected ? "mint" : "neutral"} dot>
              {connected ? "Connected" : "Not set"}
            </Badge>
          </div>
          {connected && meta ? (
            <div className="text-[12px] text-muted-fg">
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
              <span className="text-[11px] text-dim-fg">Affects:</span>
              {(TILES_BY_PROVIDER[provider.id] ?? []).map((t) => (
                <Badge key={t} tone="neutral">
                  {t}
                </Badge>
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

/** Provider mark — a soft square carrying the provider's short glyph text. */
function ProviderGlyph({ glyph }) {
  return (
    <span className="grid h-11 w-11 place-items-center rounded-[var(--radius-lg)] bg-card-alt text-[13px] font-bold text-fg">
      {glyph}
    </span>
  );
}

/** "100% local" privacy callout. */
function LocalCallout() {
  return (
    <div className="mt-[18px] flex items-center gap-3 rounded-[var(--radius-lg)] bg-card-alt px-4 py-3.5">
      <span className="text-[22px] font-extrabold tracking-[-0.02em] text-fg">
        100%
      </span>
      <span className="text-[13px] text-muted-fg">
        local — tokens never touch our servers. Clear them anytime from this tab.
      </span>
    </div>
  );
}

function PrivacyPoint({ title, body }) {
  return (
    <div>
      <div className="mb-1.5 text-[13px] font-bold text-fg">{title}</div>
      <div className="text-[12.5px] leading-[1.55] text-muted-fg">{body}</div>
    </div>
  );
}
