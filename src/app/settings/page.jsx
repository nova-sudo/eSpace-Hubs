"use client";

import { useState } from "react";
import { AppHeader } from "@/components/app-header";
import { PROVIDERS, saveConnection, disconnectProvider } from "@/lib/integrations";
import { startGitLabOAuth, startGitHubOAuth } from "@/lib/oauth-pkce";
import { useIntegrations } from "@/hooks/use-integrations";
import { cn } from "@/lib/utils";
import { Check, X, KeyRound, ExternalLink } from "lucide-react";
import { toast } from "sonner";

export default function SettingsPage() {
  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-3xl px-6 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">Integrations</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect Jira, GitLab and GitHub so the dashboard can read your tickets and
          pull/merge requests. Tokens are stored only in your browser&apos;s <code>localStorage</code>.
        </p>

        <div className="mt-6 space-y-4">
          {Object.values(PROVIDERS).map((p) => (
            <ProviderCard key={p.id} provider={p} />
          ))}
        </div>
      </main>
    </>
  );
}

function ProviderCard({ provider }) {
  const { integrations, isConnected } = useIntegrations();
  const connected = isConnected(provider.id);
  const meta = integrations[provider.id];

  return (
    <div className="rounded-2xl border border-border bg-card/60 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span
            className="flex h-10 w-10 items-center justify-center rounded-lg text-white"
            style={{ background: provider.color }}
          >
            <KeyRound className="h-5 w-5" />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold">{provider.label}</h2>
              <span
                className={cn(
                  "flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                  connected ? "bg-success/15 text-success" : "bg-muted text-muted-foreground",
                )}
              >
                {connected ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                {connected ? "Connected" : "Not connected"}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">{provider.description}</p>
            {connected && meta?.username ? (
              <p className="mt-1 text-xs">
                Logged in as <span className="font-mono">@{meta.username}</span>
              </p>
            ) : null}
          </div>
        </div>
        {connected ? (
          <button
            onClick={() => {
              disconnectProvider(provider.id);
              toast.success(`Disconnected from ${provider.label}`);
            }}
            className="rounded-md border border-border px-3 py-1.5 text-xs hover:border-danger/60 hover:text-danger"
          >
            Disconnect
          </button>
        ) : null}
      </div>

      {!connected ? (
        <div className="mt-4">
          {provider.authMode === "token" ? (
            <JiraTokenForm />
          ) : provider.id === "gitlab" ? (
            <OAuthButton
              label="Connect GitLab"
              onClick={async () => {
                try {
                  await startGitLabOAuth();
                } catch (e) {
                  toast.error(e.message);
                }
              }}
            />
          ) : (
            <OAuthButton
              label="Connect GitHub"
              onClick={async () => {
                try {
                  await startGitHubOAuth();
                } catch (e) {
                  toast.error(e.message);
                }
              }}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}

function OAuthButton({ label, onClick }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/15"
    >
      <ExternalLink className="h-4 w-4" />
      {label}
    </button>
  );
}

function JiraTokenForm() {
  const [email, setEmail] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email || !apiToken) return toast.error("Email and API token are required.");
    setLoading(true);
    try {
      saveConnection("jira", { email, apiToken });
      const res = await fetch("/api/jira/myself", {
        headers: {
          "x-devhub-api-token": apiToken,
          "x-devhub-email": email,
        },
      });
      if (!res.ok) throw new Error(`Jira rejected credentials (${res.status})`);
      const me = await res.json();
      saveConnection("jira", {
        email,
        apiToken,
        username: me.emailAddress || me.name || email,
        displayName: me.displayName,
      });
      toast.success(`Connected to Jira as ${me.displayName || email}`);
    } catch (err) {
      disconnectProvider("jira");
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          Atlassian email
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@espace.com.eg"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          API token
        </label>
        <input
          type="password"
          value={apiToken}
          onChange={(e) => setApiToken(e.target.value)}
          placeholder="Paste your Atlassian API token"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
        />
        <p className="mt-1 text-[11px] text-muted-foreground">
          Generate at{" "}
          <a
            className="underline hover:text-foreground"
            href="https://id.atlassian.com/manage-profile/security/api-tokens"
            target="_blank"
            rel="noreferrer"
          >
            id.atlassian.com → API tokens
          </a>
          .
        </p>
      </div>
      <button
        type="submit"
        disabled={loading}
        className="rounded-md border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/15 disabled:opacity-50"
      >
        {loading ? "Verifying..." : "Save & verify"}
      </button>
    </form>
  );
}
