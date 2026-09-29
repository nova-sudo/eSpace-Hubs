"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ChevronRight } from "lucide-react";
import { Button, Field, Input } from "@/components/ui";
import {
  describeConnectionError,
  disconnectProvider,
  PROVIDERS,
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
 *      (server encrypts and persists). We await the returned envelope so
 *      the credential is server-side before step 2 — and STOP with the
 *      real reason when the save itself failed (otherwise step 2 would
 *      hit the proxy with nothing on file and report "not connected"
 *      to a user who is standing in Settings trying to connect).
 *   2. proxyFetch() — hits /api/v1/integrations/proxy/<provider>/<path>.
 *      The API reads the just-saved encrypted token, decrypts in-process,
 *      forwards upstream. Confirms the token actually works.
 *   3. saveConnection() again — enriches the row with the provider's
 *      profile info (username, displayName, etc.) for the header chip.
 *
 * On any failure we disconnectProvider() to wipe both local and server
 * copies so the user can retry cleanly, and toast a human sentence from
 * describeConnectionError() — never the raw "gitlab 401: …" line.
 *
 * `onConnected` lets the parent (a Reconnect flow) collapse the form.
 */
export function GitLabTokenForm({ onConnected }) {
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const { config: engagementCfg } = useMyEngagementConfig();
  // Resolved per-user — eSpace devs see eSpace's GitLab base URL,
  // Crealogix devs see Crealogix's. Env fallback covers early mount
  // before the hook resolves.
  const gitlabUrl = engagementCfg?.gitlabBaseUrl || ENV_FALLBACK_GITLAB_URL;
  const scopeList = PROVIDERS.gitlab.scopeList;
  const tokenPageUrl = PROVIDERS.gitlab.tokenPageUrl(gitlabUrl);

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
        "The GitLab URL for your organisation isn't set up yet. Ask your admin to configure it.",
      );
    }
    setLoading(true);
    try {
      // Save + await the mirror — the API needs the encrypted token on
      // disk before the proxy call below can use it.
      const saved = await saveConnection("gitlab", {
        accessToken: cleanToken,
        endpointUrl: gitlabUrl,
      });
      if (!saved.ok) throw saved.error;
      const me = await proxyFetch("gitlab", "user");
      await saveConnection("gitlab", {
        accessToken: cleanToken,
        endpointUrl: gitlabUrl,
        username: me.username,
        displayName: me.name,
        avatarUrl: me.avatar_url,
      });
      toast.success(`Connected to GitLab as @${me.username}`);
      setToken("");
      onConnected?.();
    } catch (err) {
      disconnectProvider("gitlab");
      toast.error(
        describeConnectionError(err, {
          provider: "gitlab",
          label: "GitLab",
          url: gitlabUrl,
        }),
      );
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
            {tokenPageUrl ? (
              <>
                <a
                  className="underline hover:text-fg"
                  href={tokenPageUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Create one on your GitLab
                </a>{" "}
                (the link pre-fills the name and scopes)
              </>
            ) : (
              <>
                Create at{" "}
                <code className="font-mono text-[11px]">User settings</code>{" "}
                <ChevronRight size={11} className="inline-block align-[-1px] text-dim-fg" />{" "}
                <code className="font-mono text-[11px]">Access tokens</code>
              </>
            )}
            . Scopes:{" "}
            {scopeList.map((s, i) => (
              <span key={s}>
                <code className="font-mono text-[11px]">{s}</code>
                {i < scopeList.length - 1 ? ", " : ""}
              </span>
            ))}
            .
          </>
        }
      >
        <Input
          type="password"
          autoComplete="new-password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="glpat-..."
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
export function JiraTokenForm({ onConnected }) {
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
        "The Jira URL for your organisation isn't set up yet. Ask your admin to configure it.",
      );
    }
    setLoading(true);
    try {
      // Persist into the SAME columns either way — server-side proxy
      // reads engagement at request time and decides v2 vs v3.
      const saved = await saveConnection("jira", {
        email: cleanIdentity,
        apiToken: cleanSecret,
        endpointUrl: jiraUrl,
      });
      if (!saved.ok) throw saved.error;
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
      setSecret("");
      onConnected?.();
    } catch (err) {
      disconnectProvider("jira");
      toast.error(
        describeConnectionError(err, {
          provider: "jira",
          label: "Jira",
          url: jiraUrl,
        }),
      );
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
          autoComplete="off"
          placeholder={idPlaceholder}
        />
      </Field>
      <Field
        label={secretLabel}
        hint={
          isEspace ? (
            <>
              The password you use for Jira itself. It&apos;s stored
              encrypted on our server and only ever sent to your
              company&apos;s Jira to read your tickets.
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
          autoComplete="new-password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder={secretPlaceholder}
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
 *   - URL: the Jenkins base, e.g. https://jenkins.eng.example.com.
 *     Trailing slashes are tolerated; the proxy strips one before
 *     joining the rest-of-path.
 *   - Username: Jenkins username, NOT email. Forms the Basic-auth
 *     identity (the API token alone isn't sufficient).
 *   - API token: generated at <jenkins>/me/configure → API Token →
 *     Add new Token. Different from a password — Jenkins lets you
 *     revoke individual tokens without changing the account password.
 *
 * Why no `endpointUrl: NEXT_PUBLIC_JENKINS_URL` shortcut like GitLab:
 *   Jenkins instances are typically per-team, not org-wide. We
 *   default the field to the engagement's Jenkins URL when set but
 *   always let the user override it. No localhost placeholder — a
 *   real user has no Jenkins on their laptop and the old default only
 *   ever produced "connection refused".
 */
export function JenkinsTokenForm({ onConnected }) {
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
      const saved = await saveConnection("jenkins", {
        email: cleanUsername,
        apiToken: cleanApiToken,
        endpointUrl: cleanUrl,
      });
      if (!saved.ok) throw saved.error;
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
      setApiToken("");
      onConnected?.();
    } catch (err) {
      disconnectProvider("jenkins");
      toast.error(
        describeConnectionError(err, {
          provider: "jenkins",
          label: "Jenkins",
          url: cleanUrl,
        }),
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <Field
        label="Jenkins URL"
        hint="Base URL of your Jenkins controller, e.g. https://jenkins.example.com."
      >
        <Input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          autoComplete="off"
          placeholder="https://jenkins.example.com"
        />
      </Field>
      <Field
        label="Username"
        hint="Your Jenkins login — not your email. Jenkins API tokens are bound to a specific user."
      >
        <Input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="off"
          placeholder="your-jenkins-username"
        />
      </Field>
      <Field
        label="API token"
        hint={
          <>
            Generate at{" "}
            <code className="font-mono text-[11px]">
              &lt;your-jenkins&gt;/me/configure
            </code>{" "}
            <ChevronRight size={11} className="inline-block align-[-1px] text-dim-fg" />{" "}
            API Token{" "}
            <ChevronRight size={11} className="inline-block align-[-1px] text-dim-fg" />{" "}
            Add new Token. Revocable independently of your password.
          </>
        }
      >
        <Input
          type="password"
          autoComplete="new-password"
          value={apiToken}
          onChange={(e) => setApiToken(e.target.value)}
          placeholder="11ab2c3d4e5f6789..."
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
