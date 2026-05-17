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
const JENKINS_URL = process.env.NEXT_PUBLIC_JENKINS_URL;

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

/**
 * Jenkins connect form. Same three-step validation flow as the
 * GitLab / Jira forms:
 *   1. saveConnection() — encrypt + persist {url, username, apiToken}
 *      on the integrations row (api side)
 *   2. proxyFetch("jenkins", "api/json") — calls the Jenkins root API,
 *      which returns the instance metadata when auth is valid
 *   3. saveConnection() again — back-fill the connected user's
 *      `username` for the header chip + future API-client lookups
 *
 * Field shape:
 *   - URL: the Jenkins base, e.g. http://localhost:8080 or
 *     https://jenkins.eng.example.com. Trailing slashes are tolerated;
 *     the proxy strips one before joining the rest-of-path.
 *   - Username: Jenkins username, NOT email. Forms the Basic-auth
 *     identity (the API token alone isn't sufficient).
 *   - API token: generated at <jenkins>/me/configure → API Token →
 *     Add new Token. Different from a password — Jenkins lets you
 *     revoke individual tokens without changing the account password.
 *
 * Why no `endpointUrl: NEXT_PUBLIC_JENKINS_URL` shortcut like GitLab:
 *   Jenkins instances are typically per-team, not org-wide. We
 *   default the field to NEXT_PUBLIC_JENKINS_URL when set (so dev
 *   defaults to the docker compose container at :8080) but always
 *   let the user override it.
 */
export function JenkinsTokenForm() {
  const [url, setUrl] = useState(JENKINS_URL || "");
  const [username, setUsername] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!url || !username || !apiToken) {
      return toast.error("URL, username, and API token are all required.");
    }
    setLoading(true);
    try {
      // The integrations row stores the username under `email` (we
      // reuse the same field for any "second auth identity" — see
      // Jira). The proxy reads it as the Basic-auth username.
      await saveConnection("jenkins", {
        email: username,
        apiToken,
        endpointUrl: url.replace(/\/$/, ""),
      });
      // /api/json on the Jenkins root returns instance metadata
      // when auth is valid (no specific job needed).
      const root = await proxyFetch("jenkins", "api/json");
      await saveConnection("jenkins", {
        email: username,
        apiToken,
        endpointUrl: url.replace(/\/$/, ""),
        username,
        displayName: root?.nodeDescription || username,
      });
      toast.success(`Connected to Jenkins as ${username}`);
    } catch (err) {
      disconnectProvider("jenkins");
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <Field
        label="Jenkins URL"
        hint="Base URL of your Jenkins controller. Local Docker dev: http://localhost:8080."
      >
        <Input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="http://localhost:8080"
          mono
        />
      </Field>
      <Field
        label="Username"
        hint="Your Jenkins login — NOT your email. Jenkins API tokens are bound to a specific user."
      >
        <Input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="your-jenkins-username"
          mono
        />
      </Field>
      <Field
        label="API token"
        hint={
          <>
            Generate at{" "}
            <span style={{ fontFamily: "var(--font-mono)" }}>
              &lt;your-jenkins&gt;/me/configure
            </span>{" "}
            → API Token → Add new Token. Revocable independently of your
            password.
          </>
        }
      >
        <Input
          type="password"
          value={apiToken}
          onChange={(e) => setApiToken(e.target.value)}
          placeholder="11ab2c3d4e5f6789..."
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
