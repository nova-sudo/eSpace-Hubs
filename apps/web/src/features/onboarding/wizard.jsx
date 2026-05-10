"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button, Card, Field, Input, MonoLabel } from "@/components/ui";
import { saveConnection } from "@/features/integrations";
import { startGitHubOAuth } from "@/lib/oauth-pkce";

const STEPS = ["jira", "gitlab", "github"];
const LABELS = { jira: "Jira", gitlab: "GitLab", github: "GitHub" };

export function Wizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [jira, setJira] = useState({ url: "", email: "", token: "" });
  const [gitlab, setGitlab] = useState({ url: "", token: "" });
  const [loading, setLoading] = useState(false);

  async function handleContinue() {
    if (step === 0) {
      if (!jira.email || !jira.token) {
        toast.error("Email and API token required.");
        return;
      }
      setLoading(true);
      try {
        saveConnection("jira", { email: jira.email, apiToken: jira.token });
        const res = await fetch("/api/jira/myself", {
          headers: {
            "x-devhub-api-token": jira.token,
            "x-devhub-email": jira.email,
          },
        });
        if (!res.ok) throw new Error(`Jira rejected credentials (${res.status})`);
        const me = await res.json();
        saveConnection("jira", {
          email: jira.email,
          apiToken: jira.token,
          username: me.emailAddress || me.name || jira.email,
          displayName: me.displayName,
        });
        toast.success("Jira connected");
        setStep(1);
      } catch (e) {
        toast.error(e.message);
      } finally {
        setLoading(false);
      }
    } else if (step === 1) {
      if (!gitlab.token) {
        toast.error("GitLab PAT required.");
        return;
      }
      setLoading(true);
      try {
        saveConnection("gitlab", { accessToken: gitlab.token });
        const res = await fetch("/api/gitlab/user", {
          headers: { "x-devhub-token": gitlab.token },
        });
        if (!res.ok) throw new Error(`GitLab rejected the token (${res.status})`);
        const me = await res.json();
        saveConnection("gitlab", {
          accessToken: gitlab.token,
          username: me.username,
          displayName: me.name,
          avatarUrl: me.avatar_url,
        });
        toast.success("GitLab connected");
        setStep(2);
      } catch (e) {
        toast.error(e.message);
      } finally {
        setLoading(false);
      }
    } else {
      try {
        await startGitHubOAuth();
      } catch (e) {
        toast.error(e.message);
      }
    }
  }

  return (
    <Card className="sticky top-20 p-6">
      <div className="mb-4 flex items-center justify-between">
        <MonoLabel>Connect · step {step + 1} of 3</MonoLabel>
        <div className="flex gap-1">
          {STEPS.map((s, i) => (
            <span
              key={s}
              className="h-[3px] w-[18px] rounded-sm"
              style={{
                background: i <= step ? "var(--accent)" : "var(--border)",
              }}
            />
          ))}
        </div>
      </div>

      <h3
        className="mb-1 font-semibold"
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 22,
          letterSpacing: "-0.4px",
        }}
      >
        Connect {LABELS[STEPS[step]]}
      </h3>
      <p className="mb-4 text-[12.5px] leading-[1.5] text-muted-fg">
        {step === 0 &&
          "Your Atlassian email plus a personal API token (create one at id.atlassian.com → security → API tokens)."}
        {step === 1 &&
          "A GitLab personal access token with read_api scope, created at your GitLab instance → preferences → access tokens."}
        {step === 2 &&
          "We'll redirect you to GitHub to authorize. You can revoke any time at github.com/settings/applications."}
      </p>

      {step === 0 ? (
        <div className="flex flex-col gap-3">
          <Field label="Atlassian workspace URL">
            <Input
              placeholder="https://your-company.atlassian.net"
              value={jira.url}
              onChange={(e) => setJira({ ...jira, url: e.target.value })}
              mono
            />
          </Field>
          <Field label="Email">
            <Input
              placeholder="you@espace.com.eg"
              value={jira.email}
              onChange={(e) => setJira({ ...jira, email: e.target.value })}
            />
          </Field>
          <Field
            label="API token"
            hint="Stays in your browser. Never sent to our server except as a proxied Authorization header."
          >
            <Input
              type="password"
              placeholder="ATATT3xFfGF0T..."
              value={jira.token}
              onChange={(e) => setJira({ ...jira, token: e.target.value })}
              mono
            />
          </Field>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="flex flex-col gap-3">
          <Field label="GitLab URL">
            <Input
              placeholder="https://git.your-company.net"
              value={gitlab.url}
              onChange={(e) => setGitlab({ ...gitlab, url: e.target.value })}
              mono
            />
          </Field>
          <Field
            label="Personal access token"
            hint="read_api scope is enough. Don't grant write."
          >
            <Input
              type="password"
              placeholder="glpat-xxxxxxxxxxxxxxxxxxxx"
              value={gitlab.token}
              onChange={(e) => setGitlab({ ...gitlab, token: e.target.value })}
              mono
            />
          </Field>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="mb-4 rounded-[var(--radius-sub)] border border-dashed border-border bg-card-alt px-4 py-3.5">
          <MonoLabel>Redirect</MonoLabel>
          <div className="mt-1 text-[13px]">
            You&apos;ll be bounced to{" "}
            <span
              className="text-accent"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              github.com/login/oauth/authorize
            </span>{" "}
            to grant <strong>repo</strong> + <strong>read:user</strong>. You&apos;ll
            come right back here.
          </div>
        </div>
      ) : null}

      <div className="mt-2 flex justify-between">
        <Button
          variant="ghost"
          size="sm"
          disabled={step === 0}
          onClick={() => setStep(step - 1)}
        >
          ← Back
        </Button>
        <Button onClick={handleContinue} disabled={loading}>
          {loading
            ? "Verifying…"
            : step < 2
              ? step === 0
                ? "Test & continue →"
                : "Continue →"
              : "Authorize & finish"}
        </Button>
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-dashed border-border pt-3.5">
        <span className="text-[11.5px] text-muted-fg">Only connect what you use.</span>
        <button
          onClick={() => router.push("/")}
          className="cursor-pointer border-none bg-transparent uppercase tracking-[0.5px] text-dim-fg hover:text-fg"
          style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, fontWeight: 600 }}
        >
          Skip for now →
        </button>
      </div>
    </Card>
  );
}
