"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Badge, Button, Card, Section } from "@/components/ui";
import {
  DASHBOARD_PROVIDER_DEPENDENCIES,
  disconnectProvider,
  PROVIDERS,
  providerDescription,
  useIntegrations,
} from "@/features/integrations";
import {
  useActiveHub,
  useAllowedProviders,
} from "@/features/hubs";
import { startGitHubOAuth } from "@/lib/oauth-pkce";
import { useMyEngagementConfig, useSession } from "@/features/auth";
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

      <Section title="Providers">
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
        <StorageCallout />
      </Section>

      {/* Keep this honest and in sync with CLAUDE.md §4 + the Danger
          zone copy: tokens are server-side, envelope-encrypted, and
          decrypted only inside the API process to proxy requests. */}
      <Section title="How tokens are stored">
        <Card className="p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <PrivacyPoint
              title="Encrypted on our server"
              body="Your GitLab token, GitHub token and Jira credential are sent once over TLS and stored envelope-encrypted in our database. They're decrypted only inside the API process, only to proxy your own requests, and they're never logged or sent back to the browser."
            />
            <PrivacyPoint
              title="Follows your account"
              body="Because the credential lives with your account, not this browser, a new device or a cleared cache shows the same connections. Disconnecting here deletes the stored credential on every device."
            />
            <PrivacyPoint
              title="Scopes"
              body="GitLab: read_api, read_user, read_repository (read-only). Jira: your own permissions, used read-only. GitHub: repo + read:user — GitHub has no read-only scope that covers private repositories, so repo is the smallest one that lets the PR widgets see your private work. We never write."
            />
            <PrivacyPoint
              title="Revoke any time"
              body="Revoke the token at its source (GitHub settings, GitLab access tokens, Atlassian API tokens) and the connection shows an error on its next request. Disconnecting here removes our copy but does not revoke the token there — do both."
            />
          </div>
        </Card>
      </Section>

      <Section title="What the AI sees">
        <Card className="p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <PrivacyPoint
              title="AI text does leave"
              body="What you type into the AI surfaces — goal descriptions, tracker descriptions, chat — is sent to our API and on to the AI provider you picked under Account (Claude, Mistral, GLM, OpenRouter). There's no on-device model; that trip is how you get an answer."
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
  const { isConnected, integrations } = useIntegrations();
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
              Used for
            </th>
          </tr>
        </thead>
        <tbody>
          {providers.map((p) => {
            const connected = isConnected(p.id);
            const failing = connected && Boolean(integrations[p.id]?.lastError);
            const tiles = TILES_BY_PROVIDER[p.id] ?? [];
            return (
              <tr key={p.id} className="border-t border-line first:border-t-0">
                <td className="px-4 py-3 text-[13px] font-semibold text-fg">
                  {p.label}
                </td>
                <td className="px-4 py-3">
                  <Badge tone={failing ? "peach" : connected ? "mint" : "neutral"} dot>
                    {failing ? "Needs attention" : connected ? "Connected" : "Not connected"}
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
  const { user } = useSession();
  const connected = isConnected(provider.id);
  const meta = integrations[provider.id];
  // The proxy stamps `lastError` whenever an upstream call fails
  // (401/403/network). A green "Connected" badge on top of that was
  // the lie the audit caught — surface it and offer the fix.
  const lastError = connected ? meta?.lastError : null;
  // "Reconnect" / "Replace token" re-opens the credential form on an
  // already-connected card; it collapses again once the new token
  // verifies (the form calls onConnected).
  const [reconnecting, setReconnecting] = useState(false);
  const showForm = !connected || reconnecting;

  const status = lastError
    ? { tone: "peach", label: "Needs attention" }
    : connected
      ? { tone: "mint", label: "Connected" }
      : { tone: "neutral", label: "Not connected" };

  async function startOAuth() {
    const start = OAUTH_STARTERS[provider.id];
    if (!start) {
      toast.error(`No OAuth starter wired for ${provider.label}`);
      return;
    }
    try {
      // Pass per-user engagement config — the GitHub client id depends
      // on whether the user is on the eSpace or Crealogix engagement.
      // returnTo brings the user back to this tab after the callback.
      await start({
        clientId: engagementCfg?.githubClientId,
        returnTo: `${window.location.pathname}?tab=integrations`,
      });
    } catch (e) {
      toast.error(e.message);
    }
  }

  function handleDisconnect() {
    const ok = window.confirm(
      `Disconnect ${provider.label}? The saved credential is deleted from your account on every device and the widgets that depend on it go blank until you reconnect. The token itself stays valid at ${provider.label} until you revoke it there.`,
    );
    if (!ok) return;
    disconnectProvider(provider.id);
    setReconnecting(false);
    toast.success(`Disconnected from ${provider.label}`);
  }

  const form =
    provider.authMode === "token" ? (
      <JiraTokenForm onConnected={() => setReconnecting(false)} />
    ) : provider.authMode === "pat" ? (
      <GitLabTokenForm onConnected={() => setReconnecting(false)} />
    ) : provider.authMode === "basic" ? (
      <JenkinsTokenForm onConnected={() => setReconnecting(false)} />
    ) : (
      <Button onClick={startOAuth}>
        {connected ? `Reconnect ${provider.label}` : `Connect ${provider.label}`}
      </Button>
    );

  return (
    <Card className="p-5">
      <div className="grid grid-cols-[44px_1fr_auto] items-start gap-4">
        <ProviderGlyph glyph={provider.glyph} />
        <div>
          <div className="mb-0.5 flex items-center gap-2.5">
            <span className="text-[15px] font-bold text-fg">{provider.label}</span>
            <Badge tone={status.tone} dot>
              {status.label}
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
          {lastError ? (
            <div className="mt-2 rounded-[var(--radius-lg)] bg-peach px-3 py-2 text-[12px] leading-[1.5] text-peach-ink">
              <span className="font-bold">Last error:</span> {lastError}
              {meta?.lastErrorAt
                ? ` (${new Date(meta.lastErrorAt).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })})`
                : ""}
              {" · "}
              <button
                type="button"
                className="font-bold underline"
                onClick={() =>
                  provider.authMode === "oauth" ? startOAuth() : setReconnecting(true)
                }
              >
                Reconnect
              </button>
            </div>
          ) : null}
          <div className="mt-1.5 text-[11.5px] text-muted-fg">
            {providerDescription(provider, user?.engagement)} · scopes: {provider.scopes}
          </div>
          {(TILES_BY_PROVIDER[provider.id] ?? []).length > 0 ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-muted-fg">Affects:</span>
              {(TILES_BY_PROVIDER[provider.id] ?? []).map((t) => (
                <Badge key={t} tone="neutral">
                  {t}
                </Badge>
              ))}
            </div>
          ) : null}
          {showForm ? (
            <div className="mt-4">
              {reconnecting ? (
                <div className="mb-2 text-[12px] text-muted-fg">
                  Paste a new credential — it replaces the saved one once it verifies.
                </div>
              ) : null}
              {form}
              {reconnecting ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2"
                  onClick={() => setReconnecting(false)}
                >
                  Cancel
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
        {connected ? (
          <div className="flex gap-1.5">
            {!reconnecting ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  provider.authMode === "oauth" ? startOAuth() : setReconnecting(true)
                }
                title="Swap in a new token without disconnecting first"
              >
                {provider.authMode === "oauth" ? "Reconnect" : "Replace token"}
              </Button>
            ) : null}
            <Button variant="danger" size="sm" onClick={handleDisconnect}>
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

/** One-line storage summary under the provider list. */
function StorageCallout() {
  return (
    <div className="mt-[18px] flex items-center gap-3 rounded-[var(--radius-lg)] bg-card-alt px-4 py-3.5">
      <span className="text-[13px] text-muted-fg">
        Credentials are stored encrypted on our server and decrypted only to
        proxy your own requests. Disconnect here to delete our copy; revoke
        at the provider to kill the token itself.
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
