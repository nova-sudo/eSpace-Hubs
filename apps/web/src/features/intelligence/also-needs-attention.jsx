"use client";

/**
 * The quiet list under the Focus hero — the next few goals that also need the
 * user, after the hero's top-priority one. Deliberately calm: a dot, a title,
 * its kind, a status word, and a compact action. Caps at 3 rows with a
 * "See all N →" into the full board so the Focus page never becomes a wall.
 *
 * Reads `queue.slice(1)` (the hero owns queue[0]); presentation only.
 */

import Link from "next/link";
import { SPEC_KIND_META } from "@/features/goal-specs";
import { isInlineFillable } from "@/features/goal-editors";
import { useHubLink } from "@/features/hubs";
import { statusDisplay } from "./status";

const MAX_ROWS = 3;

export function AlsoNeedsAttention({ rest, totalAttention, seeAllHref }) {
  const link = useHubLink();
  if (!Array.isArray(rest) || rest.length === 0) return null;

  const rows = rest.slice(0, MAX_ROWS);
  const label = String(rest.length).padStart(2, "0");

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between border-b border-border pb-2.5">
        <span
          className="uppercase tracking-[2px] text-muted-fg"
          style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
        >
          Also needs attention · {label}
        </span>
        <Link
          href={seeAllHref || link("/goals")}
          className="uppercase tracking-[1px] text-accent hover:underline"
          style={{ fontFamily: "var(--font-mono)", fontSize: 9 }}
        >
          See all {totalAttention} →
        </Link>
      </div>

      {rows.map((card) => {
        const meta = statusDisplay(card.health);
        const kindLabel = SPEC_KIND_META[card.spec?.widget]?.label ?? "Goal";
        const context = [kindLabel, card.l1?.category || card.l1?.title]
          .filter(Boolean)
          .join(" · ");
        const cta = isInlineFillable(card.spec?.widget) ? "Fill ▾" : "Open →";
        return (
          <Link
            key={card.goal.id}
            href={link("/goals")}
            className="flex items-center gap-3.5 border-b border-border px-1 py-[15px] transition-colors hover:bg-[color-mix(in_srgb,var(--fg)_3%,transparent)]"
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: meta?.dot }}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-semibold text-fg" title={card.goal.title}>
                {card.goal.title}
              </div>
              <div
                className="mt-[3px] uppercase tracking-[0.5px] text-dim-fg"
                style={{ fontFamily: "var(--font-mono)", fontSize: 9 }}
              >
                {context}
              </div>
            </div>
            <span
              className="shrink-0 uppercase tracking-[0.5px]"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 9,
                fontWeight: 700,
                color: card.health?.status === "behind" ? "var(--bad)" : "var(--muted-fg)",
              }}
            >
              {meta?.label}
            </span>
            <span
              className="w-14 shrink-0 text-right text-accent"
              style={{ fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700 }}
            >
              {cta}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
