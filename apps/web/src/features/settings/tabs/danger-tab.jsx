"use client";

import { toast } from "sonner";
import { Button, Card, Section } from "@/components/ui";
import { disconnectAll } from "@/features/integrations";
import { clearSnapshots, readSnapshots } from "@/features/snapshots";

const ACTIONS = [
  {
    title: "Export snapshots as JSON",
    body: "Download all snapshots from your account as a portable archive.",
    cta: "Export JSON",
    variant: "ghost",
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
    variant: "danger",
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
    body: "Revokes tokens from localStorage and logs out of GitHub OAuth.",
    cta: "Disconnect all",
    variant: "danger",
    onClick: () => {
      if (confirm("Disconnect all integrations?")) {
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
    variant: "danger",
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
    <Section num="01 /" title="Danger zone">
      <Card className="p-6">
        {ACTIONS.map(({ title, body, cta, variant, onClick }) => (
          <div
            key={title}
            className="grid grid-cols-[1fr_auto] items-center gap-5 border-b border-border border-dashed py-3.5 last:border-b-0"
          >
            <div>
              <div
                className="mb-0.5 font-semibold"
                style={{ fontFamily: "var(--font-display)", fontSize: 14 }}
              >
                {title}
              </div>
              <div className="text-[12.5px] leading-[1.45] text-muted-fg">{body}</div>
            </div>
            <Button variant={variant} size="sm" onClick={onClick}>
              {cta}
            </Button>
          </div>
        ))}
      </Card>
    </Section>
  );
}
