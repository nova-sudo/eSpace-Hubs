"use client";

/**
 * Post-login hub picker. Renders ONCE per session-pick window when
 * the user has more than one hub available (`allowedHubs.length > 1`)
 * and no recent pick is stored locally.
 *
 * Mounted by HubRedirect — that component decides whether to render
 * this picker vs. redirect directly. The picker itself is just a
 * grid of cards plus the navigation handler.
 *
 * Visual design: design-system-v2 tokens — no per-hub accent colors.
 * Every card is the same white card recipe; hubs differ by content.
 *
 * On click:
 *   1. Store the pick in localStorage (24h TTL).
 *   2. router.replace(`/${hubId}`).
 */

import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { PageHeader, Card, Label, Badge } from "@/components/ui";
import { setActivePick } from "./hub-pick-store.js";

export function HubPicker({ hubs, primaryHubId }) {
  const router = useRouter();

  function pick(hubId) {
    setActivePick(hubId);
    router.replace(`/${hubId}`);
  }

  return (
    <main className="min-h-screen bg-bg text-fg">
      <div className="mx-auto grid min-h-screen max-w-5xl grid-rows-[1fr_auto] px-6 py-16">
        <div className="flex flex-col">
          <PageHeader
            crumb="Choose where to land"
            title={`You have access to ${hubs.length} hubs.`}
            subtitle="Pick one to start. You can switch any time from the header — and we'll remember this choice for the next 24 hours."
          />

          <div
            className="grid gap-4"
            style={{
              gridTemplateColumns: `repeat(${Math.min(hubs.length, 3)}, minmax(0, 1fr))`,
            }}
          >
            {hubs.map((hub) => (
              <HubCard
                key={hub.id}
                hub={hub}
                isPrimary={hub.id === primaryHubId}
                onClick={() => pick(hub.id)}
              />
            ))}
          </div>
        </div>

        <div className="mt-12 text-[12.5px] text-muted-fg">
          Pick is stored in your browser. Switching hubs from the header
          updates it.
        </div>
      </div>
    </main>
  );
}

function HubCard({ hub, isPrimary, onClick }) {
  const slots = Object.keys(hub.pages);
  return (
    <button type="button" onClick={onClick} className="group text-left">
      <Card className="flex h-full flex-col items-start gap-3 transition-transform group-hover:-translate-y-0.5">
        <div className="flex w-full items-center justify-between">
          <div className="grid h-9 w-9 place-items-center rounded-[var(--radius-md)] bg-card-alt text-[13px] font-bold text-fg">
            {hub.id[0].toUpperCase()}
          </div>
          {isPrimary ? <Badge tone="mint">Default</Badge> : null}
        </div>

        <div>
          <div className="text-[15px] font-bold leading-[1.3]">{hub.label}</div>
          <p className="mt-1 text-[13px] leading-[1.5] text-muted-fg">{hub.description}</p>
        </div>

        <div className="mt-1 flex flex-wrap gap-1.5">
          {slots.slice(0, 4).map((slot) => (
            <Label key={slot} as="span" className="rounded-[var(--radius-md)] bg-card-alt px-1.5 py-0.5">
              {slot}
            </Label>
          ))}
          {slots.length > 4 ? <Label as="span">+{slots.length - 4}</Label> : null}
        </div>

        <span className="mt-auto flex items-center gap-1 self-end text-[13px] font-bold text-fg">
          <ArrowRight size={14} className="transition-transform group-hover:translate-x-1" />
        </span>
      </Card>
    </button>
  );
}
