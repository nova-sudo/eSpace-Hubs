"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button, Field, Input } from "@/components/ui";
import {
  disconnectProvider,
  saveConnection,
} from "@/features/integrations";
import { proxyFetch } from "@/features/integrations/api-clients/proxy-fetch";
import { useMyEngagementConfig, useSession } from "@/features/auth";

// Engagement-scoped URL fallbacks. Used when the engagement-config
// hook hasn't resolved yet (early mount) or as a final safety net.
// The runtime values from /auth/me/engagement-config win when set.
const ENV_FALLBACK_GITLAB_URL = process.env.NEXT_PUBLIC_GITLAB_URL;
const ENV_FALLBACK_JIRA_URL = process.env.NEXT_PUBLIC_JIRA_URL;
const ENV_FALLBACK_JENKINS_URL = process.env.NEXT_PUBLIC_JENKINS_URL;

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
  const { config: engagementCfg } = useMyEngagementConfig();
  // Resolved per-user — eSpace devs see eSpace's GitLab base URL,
  // Crealogix devs see Crealogix's. Env fallback covers early mount
  // before the hook resolves.
  const gitlabUrl = engagementCfg?.gitlabBaseUrl || ENV_FALLBACK_GITLAB_URL;

  async function handleSubmit(e) {
    e.preventDefault();
    // Trim before everything — copy-paste from password managers and
    // GitLab's UI commonly drags a trailing space/newline that breaks
    // the upstream Authorization header. We don't want to lose that
    // to undici's "fetch failed" black hole.
    const cleanToken = token.trim();
    if (!cleanToken) return toast.error("Access token is required.");
    if (!gitlabUrl) {
      return toast.error(
        "GitLab base URL not configured for your engagement. Ask an admin to set <ENGAGEMENT>_GITLAB_URL in the API env.",
      );
    }
    setLoading(true);
    try {
      // Save + await the mirror — the API needs the encrypted token on
      // disk before the proxy call below can use it.
      await saveConnection("gitlab", {
        accessToken: cleanToken,
        endpointUrl: gitlabUrl,
      });
      const me = await proxyFetch("gitlab", "user");
      await saveConnection("gitlab", {
        accessToken: cleanToken,
        endpointUrl: gitlabUrl,
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

/**
 * Jira connect form. Branches labels + helper text on the user's
 * engagement so the same form serves both flavours:
 *
 *   - Crealogix (Jira Cloud):   "Atlassian email" + "API token"
 *     Auth is Basic email:apiToken; proxy hits /rest/api/3/…
 *
 *   - eSpace (Jira Server 8.16): "Username" + "Password"
 *     Auth is Basic username:password; proxy hits /rest/api/2/…
 *     v3 doesn't exist on Server 8.x, so the user-facing label and
 *     the upstream URL flip together. Storage stays in the SAME
 *     `email` + `apiToken` fields on the integration row — that's
 *     intentional; we just relabel the meaning.
 */
export function JiraTokenForm() {
  const [identity, setIdentity] = useState("");
  const [secret, setSecret] = useState("");
  const [loading, setLoading] = useState(false);
  const { config: engagementCfg } = useMyEngagementConfig();
  const { user } = useSession();
  const isEspace = (user?.engagement ?? "espace") === "espace";
  const jiraUrl = engagementCfg?.jiraBaseUrl || ENV_FALLBACK_JIRA_URL;

  // Labels + copy flip together — keep the two consts side-by-side so
  // future engagements don't drift one without the other.
  const idLabel = isEspace ? "Username" : "Atlassian email";
  const secretLabel = isEspace ? "Password" : "API token";
  const idPlaceholder = isEspace ? "your.username" : "you@espace.com.eg";
  const secretPlaceholder = isEspace ? "•••••••••" : "ATATT3xFfGF0T...";
  const idType = isEspace ? "text" : "email";

  async function handleSubmit(e) {
    e.preventDefault();
    // Trim both — copy-paste of either field commonly drags whitespace
    // that breaks the upstream Basic-auth header encoding.
    const cleanIdentity = identity.trim();
    const cleanSecret = secret.trim();
    if (!cleanIdentity || !cleanSecret) {
      return toast.error(
        isEspace
          ? "Username and password are required."
          : "Email and API token are required.",
      );
    }
    if (!jiraUrl) {
      return toast.error(
        "Jira base URL not configured for your engagement. Ask an admin to set <ENGAGEMENT>_JIRA_URL in the API env.",
      );
    }
    setLoading(true);
    try {
      // Persist into the SAME columns either way — server-side proxy
      // reads engagement at request time and decides v2 vs v3.
      await saveConnection("jira", {
        email: cleanIdentity,
        apiToken: cleanSecret,
        endpointUrl: jiraUrl,
      });
      const me = await proxyFetch("jira", "myself");
      await saveConnection("jira", {
        email: cleanIdentity,
        apiToken: cleanSecret,
        endpointUrl: jiraUrl,
        // Jira Server's /myself returns `name` (the login id) + may not
        // expose `emailAddress` depending on user-privacy settings.
        // Cloud reliably has `emailAddress`. Fall through gracefully.
        username: me.name || me.emailAddress || cleanIdentity,
        displayName: me.displayName,
      });
      toast.success(
        `Connected to Jira as ${me.displayName || cleanIdentity}`,
      );
    } catch (err) {
      disconnectProvider("jira");
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <Field label={idLabel}>
        <Input
          type={idType}
          value={identity}
          onChange={(e) => setIdentity(e.target.value)}
          placeholder={idPlaceholder}
        />
      </Field>
      <Field
        label={secretLabel}
        hint={
          isEspace ? (
            <>
              Your Jira Server login password. Stored encrypted at rest
              with AES-256-GCM and used as Basic auth against{" "}
              <code className="font-mono text-[11px]">/rest/api/2/…</code>{" "}
              on your on-prem Jira (v8.16).
            </>
          ) : (
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
          )
        }
      >
        <Input
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder={secretPlaceholder}
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
  const { config: engagementCfg } = useMyEngagementConfig();
  const jenkinsDefault =
    engagementCfg?.jenkinsBaseUrl || ENV_FALLBACK_JENKINS_URL || "";
  const [url, setUrl] = useState(jenkinsDefault);
  const [username, setUsername] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    // Trim all three — copy-paste artifacts of any field break the
    // upstream Basic-auth header. We don't want a stray newline to
    // surface as "fetch failed" with no diagnostic.
    const cleanUrl = url.trim().replace(/\/$/, "");
    const cleanUsername = username.trim();
    const cleanApiToken = apiToken.trim();
    if (!cleanUrl || !cleanUsername || !cleanApiToken) {
      return toast.error("URL, username, and API token are all required.");
    }
    setLoading(true);
    try {
      // The integrations row stores the username under `email` (we
      // reuse the same field for any "second auth identity" — see
      // Jira). The proxy reads it as the Basic-auth username.
      await saveConnection("jenkins", {
        email: cleanUsername,
        apiToken: cleanApiToken,
        endpointUrl: cleanUrl,
      });
      // /api/json on the Jenkins root returns instance metadata
      // when auth is valid (no specific job needed).
      const root = await proxyFetch("jenkins", "api/json");
      await saveConnection("jenkins", {
        email: cleanUsername,
        apiToken: cleanApiToken,
        endpointUrl: cleanUrl,
        username: cleanUsername,
        displayName: root?.nodeDescription || cleanUsername,
      });
      toast.success(`Connected to Jenkins as ${cleanUsername}`);
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
