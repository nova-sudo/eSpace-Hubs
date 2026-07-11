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
 * Visual design: full-bleed neutral surface (sand, not a hub theme).
 * Each card carries its hub's accent so the user can scan by colour
 * before reading the label.
 *
 * On click:
 *   1. Store the pick in localStorage (24h TTL).
 *   2. router.replace(`/${hubId}`).
 */

import { useRouter } from "next/navigation";
import { setActivePick } from "./hub-pick-store.js";

export function HubPicker({ hubs, primaryHubId }) {
  const router = useRouter();

  function pick(hubId) {
    setActivePick(hubId);
    router.replace(`/${hubId}`);
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#f5f1e8",
        color: "#1c1c1c",
      }}
    >
      <div className="mx-auto grid min-h-screen max-w-5xl grid-rows-[1fr_auto] px-6 py-16">
        <div className="flex flex-col">
          <div
            className="mb-4 inline-flex w-fit items-center gap-2 rounded-full border border-[rgba(28,28,28,0.12)] px-3 py-1"
            style={{ fontFamily: "var(--font-mono)", fontSize: 10.5 }}
          >
            <span
              className="block h-1.5 w-1.5 rounded-full"
              style={{ background: "#8a6b3c" }}
            />
            <span className="uppercase tracking-[0.5px] text-[#5a4a2c]">
              Choose where to land
            </span>
          </div>

          <h1
            className="mb-3 font-semibold"
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 40,
              lineHeight: 1.08,
              letterSpacing: "-0.7px",
            }}
          >
            You have access to{" "}
            <span style={{ fontStyle: "italic" }}>{hubs.length} hubs</span>.
          </h1>
          <p
            className="mb-10 max-w-xl text-[14.5px] leading-[1.55]"
            style={{ color: "#5a4a2c" }}
          >
            Pick one to start. You can switch any time from the header — and
            we'll remember this choice for the next 24 hours.
          </p>

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
          className="mt-12 border-t border-[rgba(28,28,28,0.08)] pt-4 text-[11px]"
          style={{ fontFamily: "var(--font-mono)", color: "#7a6a4c" }}
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
      className="group relative flex flex-col items-start gap-3 overflow-hidden rounded-lg border-2 p-5 text-left transition-all hover:-translate-y-0.5"
      style={{
        background: "var(--card)",
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
        <p className="mt-1 text-[12.5px] leading-[1.5] text-[#5a4a2c]">
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
            className="rounded-sm border border-dashed border-[rgba(28,28,28,0.16)] px-1.5 py-0.5 text-[#7a6a4c]"
          >
            {slot}
          </span>
        ))}
        {Object.keys(hub.pages).length > 4 ? (
          <span className="text-[#7a6a4c]">
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
