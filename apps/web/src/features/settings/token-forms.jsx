"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button, Field, Input } from "@/components/ui";
import {
  disconnectProvider,
  saveConnection,
} from "@/features/integrations";
import { proxyFetch } from "@/features/integrations/api-clients/proxy-fetch";

const GITLAB_URL = process.env.NEXT_PUBLIC_GITLAB_URL;
const JIRA_URL = process.env.NEXT_PUBLIC_JIRA_URL;

/**
 * Token-form validation flow (post-M7.9c):
 *   1. saveConnection() — writes locally AND mirrors to /api/v1/integrations
 *      (server encrypts and persists). We await the returned mirror
 *      promise so the credential is server-side before step 2.
 *   2. proxyFetch() — hits /api/v1/integrations/proxy/<provider>/<path>.
 *      The API reads the just-saved encrypted token, decrypts in-process,
 *      forwards upstream. Confirms the token actually works.
 *   3. saveConnection() again — enriches the row with the provider's
 *      profile info (username, displayName, etc.) for the header chip.
 *
 * On any failure we disconnectProvider() to wipe both local and server
 * copies so the user can retry cleanly.
 */
export function GitLabTokenForm() {
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!token) return toast.error("Access token is required.");
    if (!GITLAB_URL) {
      return toast.error(
        "NEXT_PUBLIC_GITLAB_URL is not set — set it in apps/web/.env.local and restart.",
      );
    }
    setLoading(true);
    try {
      // Save + await the mirror — the API needs the encrypted token on
      // disk before the proxy call below can use it.
      await saveConnection("gitlab", {
        accessToken: token,
        endpointUrl: GITLAB_URL,
      });
      const me = await proxyFetch("gitlab", "user");
      await saveConnection("gitlab", {
        accessToken: token,
        endpointUrl: GITLAB_URL,
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
    if (!JIRA_URL) {
      return toast.error(
        "NEXT_PUBLIC_JIRA_URL is not set — set it in apps/web/.env.local and restart.",
      );
    }
    setLoading(true);
    try {
      await saveConnection("jira", {
        email,
        apiToken,
        endpointUrl: JIRA_URL,
      });
      const me = await proxyFetch("jira", "myself");
      await saveConnection("jira", {
        email,
        apiToken,
        endpointUrl: JIRA_URL,
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
