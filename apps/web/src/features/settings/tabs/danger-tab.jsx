"use client";

import { toast } from "sonner";
import { Button, Card, Section } from "@/components/ui";
import { disconnectAll, PROVIDERS } from "@/features/integrations";
import { clearSnapshots, readSnapshots } from "@/features/snapshots";
import { useMyEngagementConfig, useSession } from "@/features/auth";

/**
 * Where to actually revoke a token once our copy is gone. Disconnecting
 * here deletes the encrypted credential from the user's account; the
 * token itself stays valid at the provider until revoked there.
 */
function RevokeLinks() {
  const { config } = useMyEngagementConfig();
  const { user } = useSession();
  const isEspace = (user?.engagement ?? "espace") === "espace";
  const gitlabUrl = config?.gitlabBaseUrl || process.env.NEXT_PUBLIC_GITLAB_URL;
  const links = [
    { label: "GitHub", href: "https://github.com/settings/applications" },
    gitlabUrl
      ? {
          label: "GitLab",
          href: `${gitlabUrl.replace(/\/$/, "")}/-/user_settings/personal_access_tokens`,
        }
      : { label: "GitLab", text: "User settings → Access tokens" },
    isEspace
      ? { label: "Jira", text: "change your Jira password if you think it leaked" }
      : {
          label: "Jira",
          href: "https://id.atlassian.com/manage-profile/security/api-tokens",
        },
  ];
  return (
    <span>
      Revoke at the source:{" "}
      {links.map((l, i) => (
        <span key={l.label}>
          {l.href ? (
            <a className="font-semibold underline" href={l.href} target="_blank" rel="noreferrer">
              {l.label}
            </a>
          ) : (
            <span>
              {l.label} ({l.text})
            </span>
          )}
          {i < links.length - 1 ? " · " : ""}
        </span>
      ))}
      .
    </span>
  );
}

const ACTIONS = [
  {
    title: "Export snapshots as JSON",
    body: "Download all snapshots from your account as a portable archive.",
    cta: "Export JSON",
    danger: false,
    onClick: () => {
      const data = JSON.stringify(readSnapshots(), null, 2);
      const blob = new Blob([data], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `espace-devhub-snapshots-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Snapshots exported");
    },
  },
  {
    title: "Clear snapshot history",
    // Honest scope: this fires DELETE /snapshots per week — a permanent,
    // account-wide deletion across every device, and the compliance
    // stream (trends, evidence readings, the manager's view) goes with
    // it. It is NOT a browser-local cleanup.
    body: "Permanently deletes all weekly snapshots from your account — every device. Trend history and compliance readings go with them.",
    cta: "Clear snapshots",
    danger: true,
    onClick: () => {
      if (
        confirm(
          "Permanently delete ALL snapshots from your account? Trend history and compliance readings are lost on every device. This cannot be undone.",
        )
      ) {
        clearSnapshots();
        toast.success("Snapshots deleted from your account");
      }
    },
  },
  {
    title: "Disconnect all providers",
    // Honest scope: DELETE /integrations/:id for every provider — the
    // encrypted credential is removed from the account (so from every
    // device). Nothing is revoked upstream; see RevokeLinks.
    body: (
      <>
        Deletes your saved credentials for{" "}
        {Object.values(PROVIDERS)
          .map((p) => p.label)
          .join(", ")}{" "}
        from your account on every device. The tokens themselves stay valid at
        each provider until you revoke them there. <RevokeLinks />
      </>
    ),
    cta: "Disconnect all",
    danger: true,
    onClick: () => {
      if (
        confirm(
          "Disconnect all providers? Saved credentials are deleted from your account on every device; widgets go blank until you reconnect. Tokens stay valid at each provider until you revoke them there.",
        )
      ) {
        disconnectAll();
        toast.success("All providers disconnected");
      }
    },
  },
  {
    title: "Reset this device",
    // Honest scope: localStorage.clear() wipes DEVICE state only —
    // preferences, drafts, cached readings, settle-locks (which can
    // change displayed tiers until re-settled). Goals, snapshots, and
    // grades are server-side and survive; onboarding is a server-side
    // flag and does NOT re-show.
    body: "Wipes app data stored on this device — preferences, drafts, cached readings. Your goals, snapshots, and grades live in your account and are not deleted.",
    cta: "Reset device",
    danger: true,
    onClick: () => {
      if (
        confirm(
          "Reset this device? Local preferences, drafts, and cached readings are wiped. Your account data (goals, snapshots, grades) is kept.",
        )
      ) {
        localStorage.clear();
        location.href = "/";
      }
    },
  },
];

export function DangerTab() {
  return (
    <Section title="Danger zone">
      <div className="flex flex-col gap-3">
        {ACTIONS.map(({ title, body, cta, danger, onClick }) =>
          danger ? (
            <Card key={title} tone="peach" className="flex items-center justify-between gap-5 p-5">
              <div>
                <div className="text-[14.5px] font-bold">{title}</div>
                <div className="mt-0.5 text-[12.5px] leading-[1.45]">{body}</div>
              </div>
              <Button variant="danger" size="sm" onClick={onClick}>
                {cta}
              </Button>
            </Card>
          ) : (
            <Card key={title} className="flex items-center justify-between gap-5 p-5">
              <div>
                <div className="text-[14.5px] font-bold text-fg">{title}</div>
                <div className="mt-0.5 text-[12.5px] leading-[1.45] text-muted-fg">{body}</div>
              </div>
              <Button variant="soft" size="sm" onClick={onClick}>
                {cta}
              </Button>
            </Card>
          ),
        )}
      </div>
    </Section>
  );
}
