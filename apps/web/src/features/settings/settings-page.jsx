"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, PageHeader } from "@/components/ui";
import { useHubLink } from "@/features/hubs";
import { cn } from "@/lib/cn";
import {
  AccountTab,
  DangerTab,
  IntegrationsTab,
  OnboardingTab,
  SnapshotsPrefsTab,
} from "./tabs";

const TABS = [
  { id: "onboarding", label: "Onboarding", Component: OnboardingTab },
  { id: "integrations", label: "Integrations", Component: IntegrationsTab },
  { id: "account", label: "Account", Component: AccountTab },
  { id: "snapshots", label: "Snapshots & privacy", Component: SnapshotsPrefsTab },
  { id: "danger", label: "Danger zone", Component: DangerTab },
];

export function SettingsPage() {
  const [tab, setTab] = useState("onboarding");
  const ActivePanel = TABS.find((t) => t.id === tab).Component;
  const link = useHubLink();

  return (
    <main className="relative z-[2] px-10 pb-14 pt-9">
      <PageHeader
        crumb="Settings · your tokens, your data"
        title="Your keys. Your terms."
        italicWord="terms"
        subtitle="Everything lives in your browser. We never see your tokens, and your metrics never leave this tab unless you export them."
        right={
          <Link href={link("")}>
            <Button variant="ghost">← Dashboard</Button>
          </Link>
        }
      />

      <div className="grid grid-cols-[220px_minmax(0,1fr)] items-start gap-8">
        <nav className="sticky top-20 flex flex-col gap-0.5">
          {TABS.map(({ id, label }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={cn(
                  "cursor-pointer px-3.5 py-2.5 text-left uppercase tracking-[0.5px] transition-colors",
                  active
                    ? "bg-accent-dim text-accent"
                    : "bg-transparent text-fg hover:bg-accent-dim/50",
                )}
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  fontWeight: 700,
                  borderLeft: active
                    ? "2px solid var(--accent)"
                    : "2px solid transparent",
                }}
              >
                {label}
              </button>
            );
          })}
        </nav>
        <div>
          <ActivePanel />
        </div>
      </div>
    </main>
  );
}
