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
 * Visual design: Nothing UI canvas (design tokens, not a hub theme).
 * Each card carries its own hub's accent so the user can scan by
 * colour before reading the label.
 *
 * On click:
 *   1. Store the pick in localStorage (24h TTL).
 *   2. router.replace(`/${hubId}`).
 */

import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui";
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
            italicWord={`${hubs.length} hubs`}
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

        <div
          className="mt-12 border-t border-border pt-4 text-[11px] text-muted-fg"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Pick is stored in your browser. Switching hubs from the header
          updates it.
        </div>
      </div>
    </main>
  );
}

function HubCard({ hub, isPrimary, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex flex-col items-start gap-3 overflow-hidden rounded-lg border-2 bg-card p-5 text-left transition-all hover:-translate-y-0.5"
      style={{
        borderColor: hub.theme.accent,
        boxShadow: `0 1px 0 0 ${hub.theme.accentSurface}, 0 0 0 0 ${hub.theme.accentSurface}`,
      }}
    >
      <div className="flex w-full items-center justify-between">
        <div
          className="grid h-9 w-9 place-items-center rounded-md font-bold"
          style={{
            background: hub.theme.accentSurface,
            color: hub.theme.accent,
            fontFamily: "var(--font-mono)",
            fontSize: 12,
          }}
        >
          {hub.id[0].toUpperCase()}
        </div>
        {isPrimary ? (
          <span
            className="rounded-full px-2 py-0.5 uppercase tracking-[0.4px]"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9.5,
              fontWeight: 700,
              background: hub.theme.accentSurface,
              color: hub.theme.accent,
            }}
          >
            Default
          </span>
        ) : null}
      </div>

      <div>
        <div
          className="text-[18px] font-semibold"
          style={{ letterSpacing: "-0.3px" }}
        >
          {hub.label}
        </div>
        <p className="mt-1 text-[12.5px] leading-[1.5] text-muted-fg">
          {hub.description}
        </p>
      </div>

      <div
        className="mt-1 flex flex-wrap gap-1.5"
        style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
      >
        {Object.keys(hub.pages).slice(0, 4).map((slot) => (
          <span
            key={slot}
            className="rounded-sm border border-dashed border-border text-muted-fg px-1.5 py-0.5"
          >
            {slot}
          </span>
        ))}
        {Object.keys(hub.pages).length > 4 ? (
          <span className="text-muted-fg">
            +{Object.keys(hub.pages).length - 4}
          </span>
        ) : null}
      </div>

      <span
        className="absolute right-4 bottom-4 transition-transform group-hover:translate-x-1"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 14,
          color: hub.theme.accent,
        }}
      >
        →
      </span>
    </button>
  );
}
