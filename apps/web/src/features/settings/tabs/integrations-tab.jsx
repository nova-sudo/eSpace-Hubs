"use client";

import { toast } from "sonner";
import { Button, Card, MonoLabel, Section } from "@/components/ui";
import {
  disconnectProvider,
  PROVIDERS,
  useIntegrations,
} from "@/features/integrations";
import { startGitHubOAuth } from "@/lib/oauth-pkce";
import { GitLabTokenForm, JiraTokenForm } from "../token-forms";

/** Map provider id → OAuth start function. Single point of dispatch. */
const OAUTH_STARTERS = {
  github: startGitHubOAuth,
};

export function IntegrationsTab() {
  return (
    <>
      <Section num="01 /" title="Connected providers">
        <div className="flex flex-col gap-3">
          {Object.values(PROVIDERS).map((p) => (
            <ProviderCard key={p.id} provider={p} />
          ))}
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

function ProviderCard({ provider }) {
  const { integrations, isConnected } = useIntegrations();
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
          {!connected ? (
            <div className="mt-4">
              {provider.authMode === "token" ? (
                <JiraTokenForm />
              ) : provider.authMode === "pat" ? (
                <GitLabTokenForm />
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
                      await start();
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
