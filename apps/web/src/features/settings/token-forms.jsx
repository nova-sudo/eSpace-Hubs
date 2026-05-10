"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button, Field, Input } from "@/components/ui";
import {
  disconnectProvider,
  saveConnection,
} from "@/features/integrations";

export function GitLabTokenForm() {
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!token) return toast.error("Access token is required.");
    setLoading(true);
    try {
      saveConnection("gitlab", { accessToken: token });
      const res = await fetch("/api/gitlab/user", {
        headers: { "x-devhub-token": token },
      });
      if (!res.ok) throw new Error(`GitLab rejected the token (${res.status})`);
      const me = await res.json();
      saveConnection("gitlab", {
        accessToken: token,
        username: me.username,
        displayName: me.name,
        avatarUrl: me.avatar_url,
      });
      toast.success(`Connected to GitLab as @${me.username}`);
    } catch (err) {
      disconnectProvider("gitlab");
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <Field
        label="Personal access token"
        hint={
          <>
            Create at <span style={{ fontFamily: "var(--font-mono)" }}>User Settings → Access Tokens</span>.
            Scopes: <span style={{ fontFamily: "var(--font-mono)" }}>read_api</span>,{" "}
            <span style={{ fontFamily: "var(--font-mono)" }}>read_user</span>,{" "}
            <span style={{ fontFamily: "var(--font-mono)" }}>read_repository</span>.
          </>
        }
      >
        <Input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="glpat-..."
          mono
        />
      </Field>
      <div>
        <Button type="submit" disabled={loading}>
          {loading ? "Verifying…" : "Save & verify"}
        </Button>
      </div>
    </form>
  );
}

export function JiraTokenForm() {
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
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <Field label="Atlassian email">
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@espace.com.eg"
        />
      </Field>
      <Field
        label="API token"
        hint={
          <>
            Generate at{" "}
            <a
              className="underline hover:text-fg"
              href="https://id.atlassian.com/manage-profile/security/api-tokens"
              target="_blank"
              rel="noreferrer"
            >
              id.atlassian.com → API tokens
            </a>
            .
          </>
        }
      >
        <Input
          type="password"
          value={apiToken}
          onChange={(e) => setApiToken(e.target.value)}
          placeholder="ATATT3xFfGF0T..."
          mono
        />
      </Field>
      <div>
        <Button type="submit" disabled={loading}>
          {loading ? "Verifying…" : "Save & verify"}
        </Button>
      </div>
    </form>
  );
}
