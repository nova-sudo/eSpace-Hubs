"use client";

import { MonoLabel, DitherField } from "@/components/ui";
import { useCombinedEventsSince } from "@/features/integrations";
import { totalEvents, dailyActivity } from "@/features/integrations";
import { isoDaysAgo, weekLabel } from "@/lib/date";

/**
 * Overview hero: left-aligned headline + body, right-side 280×180 Signal
 * card showing live 14-day event count with a left-to-right dither fade.
 *
 * Rendered inside a <Section> so it owns no outer padding.
 */
export function Hero() {
  // Signal card always looks at the last 14 days — independent of the
  // dashboard's date-range toolbar, because the hero is an "at a glance"
  // vibe check, not a period comparison.
  const fourteenDaysAgo = isoDaysAgo(14);
  const { data: events } = useCombinedEventsSince(fourteenDaysAgo);
  const buckets = dailyActivity(events || [], 14);
  const total = totalEvents(buckets);

  // Sunday-anchored calendar week (Sun → Sat). Mirrors the team's Sun → Thu
  // work week — Mon-anchored math would split a single work week across two
  // Wnn labels, which is confusing in the hero overline.
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - today.getDay());
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const fmtShort = (d) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const rangeLabel = `${weekLabel(today)} · ${fmtShort(start)} — ${fmtShort(end)}`;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_280px] items-end gap-6">
      <div>
        <MonoLabel>{rangeLabel} · L1 → L2 track</MonoLabel>
        <h1
          className="mt-2 font-semibold"
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "clamp(48px, 6.5vw, 92px)",
            lineHeight: 0.94,
            letterSpacing: "-2.5px",
            textWrap: "balance",
            margin: 0,
          }}
        >
          <span className="text-muted-fg">Measure.</span>{" "}
          <span className="text-muted-fg">Merge.</span>{" "}
          <span>Make the </span>
          <em className="accent">case</em>
          <span>.</span>
        </h1>
        <p className="mt-3 max-w-[620px] text-[15px] leading-[1.5] text-muted-fg">
          A quiet dashboard for loud performance seasons. Pulls your Jira,
          GitLab and GitHub into one receipts-ready view — so review time
          writes itself.
        </p>
      </div>

      {/* Signal tile — 280 × 180 white card, dither masked left-to-right */}
      <div className="relative h-[180px] w-[280px] overflow-hidden rounded-[var(--radius-tile)] border border-border bg-card">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-[60%] text-accent opacity-55"
          style={{
            maskImage:
              "linear-gradient(to left, rgba(0,0,0,1) 40%, rgba(0,0,0,0) 100%)",
            WebkitMaskImage:
              "linear-gradient(to left, rgba(0,0,0,1) 40%, rgba(0,0,0,0) 100%)",
          }}
        >
          <DitherField
            width={180}
            height={180}
            cell={5}
            color="currentColor"
            falloff={(u, v) =>
              Math.max(0, 1.1 - Math.sqrt((u - 0.55) ** 2 + (v - 0.4) ** 2) * 1.7)
            }
            jitter={0.4}
            seed={11}
          />
        </div>
        <div className="relative z-[1] flex h-full flex-col justify-between p-4">
          <div
            className="uppercase tracking-[0.5px] text-[10px] font-semibold text-muted-fg"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            SIGNAL · 14D
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <div
              className="font-semibold text-fg"
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 44,
                letterSpacing: "-1.2px",
                lineHeight: 1,
              }}
            >
              {total || "—"}
            </div>
            <div
              className="text-right text-[10px] uppercase tracking-[0.5px] text-muted-fg"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              events
              <br />
              tracked
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
