"use client";

import { toast } from "sonner";
import { Button, Card, Section } from "@/components/ui";
import { disconnectAll } from "@/features/integrations";
import { clearSnapshots, readSnapshots } from "@/features/snapshots";

const ACTIONS = [
  {
    title: "Export snapshots as JSON",
    body: "Download all local snapshots as a portable archive.",
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
    body: "Deletes all weekly snapshots from this browser. Current metrics stay.",
    cta: "Clear snapshots",
    variant: "danger",
    onClick: () => {
      if (confirm("Delete all snapshots? This cannot be undone.")) {
        clearSnapshots();
        toast.success("Snapshots cleared");
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
    title: "Reset everything",
    body: "Wipes all local state including preferences. You'll see the onboarding screen next load.",
    cta: "Reset",
    variant: "danger",
    onClick: () => {
      if (confirm("Reset everything? This wipes all local data.")) {
        localStorage.clear();
        location.href = "/onboarding";
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
