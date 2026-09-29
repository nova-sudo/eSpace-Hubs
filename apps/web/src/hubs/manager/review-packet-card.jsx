"use client";

/**
 * The report's submitted review packet — the frozen evidence document
 * both sides of the review argue from (F1). Shows the LATEST version's
 * meta, its narrative + per-goal tier rows and the frozen markdown behind
 * a disclosure; older versions render as a meta-only history line.
 *
 * It sits in the board's rail now, so it leads with the one line that
 * matters at a glance ("Submitted · 2 Sep · 12 goals") and keeps the
 * document itself one click away.
 *
 * Data: GET /manager/reports/:userId/review-packets.
 */

import { Download } from "lucide-react";
import { Badge, Button, Card, Label } from "@/components/ui";
import { TIER_LABELS } from "@/features/goal-tiers";
import { downloadPacketMarkdown, useReviewPackets } from "./use-review-packets";

function fmtWhen(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function ReviewPacketCard({ userId, personName }) {
  const state = useReviewPackets(userId);

  if (state.loading) return null;
  const [latest, ...history] = state.packets;

  if (!latest) {
    return (
      <Card padding={18}>
        <Label>Review packet</Label>
        <p className="mt-2 text-[12.5px] leading-[1.5] text-muted-fg">
          Nothing submitted yet — when they compile their evidence and hit
          &ldquo;Submit for review&rdquo;, the frozen document lands here.
        </p>
      </Card>
    );
  }

  return (
    <Card padding={18}>
      <div className="flex items-center gap-2">
        <Label>Review packet</Label>
        <span className="flex-1" />
        <Badge tone="mint">Submitted</Badge>
      </div>

      <div className="mt-2 text-[12.5px] leading-[1.5] text-fg">
        {[
          fmtWhen(latest.submittedAt),
          latest.level,
          latest.rangeLabel,
          `${latest.goalCount} goals`,
          latest.starredCount ? `${latest.starredCount} starred proof` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </div>

      {latest.narrative?.trim() ? (
        <p className="mt-2 text-[12.5px] leading-[1.55] text-muted-fg">
          {latest.narrative.trim()}
        </p>
      ) : null}

      {latest.markdown ? (
        <>
          {/* #238: managers couldn't export a report's packet — HR wants
              the file, not a scroll box. Plain blob download; the
              markdown is already the frozen document. */}
          <Button
            type="button"
            variant="soft"
            size="sm"
            className="mt-3"
            onClick={() => downloadPacketMarkdown(latest, personName)}
          >
            <Download size={13} /> Download .md
          </Button>
        </>
      ) : null}

      <details className="mt-3 border-t border-line pt-3">
        <summary className="cursor-pointer text-[12.5px] font-bold text-fg">
          Read the frozen document
        </summary>

        {Array.isArray(latest.goals) && latest.goals.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-1.5">
            {latest.goals.map((g) => (
              <li key={g.goalId} className="flex items-baseline gap-2 text-[12px]">
                <span className="min-w-0 flex-1 truncate text-fg" title={g.title}>
                  {g.title || "(untitled)"}
                  {g.l1Title ? (
                    <span className="ml-1.5 text-[11px] text-muted-fg">· {g.l1Title}</span>
                  ) : null}
                </span>
                {g.reading ? (
                  <span className="shrink-0 text-[11px] text-muted-fg">{g.reading}</span>
                ) : null}
                <span
                  className={`shrink-0 text-[11px] font-bold ${g.tier ? "text-fg" : "text-muted-fg"}`}
                >
                  {g.tier ? (TIER_LABELS[g.tier] ?? g.tier) : "ungraded"}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        {latest.markdown ? (
          <pre className="mt-3 max-h-[420px] overflow-auto whitespace-pre-wrap rounded-[var(--radius-lg)] bg-card-alt p-3 text-[11px] leading-[1.55] text-fg">
            {latest.markdown}
          </pre>
        ) : null}
      </details>

      {history.length > 0 ? (
        <div className="mt-3 border-t border-line pt-3 text-[11.5px] text-muted-fg">
          {history.length} earlier version{history.length === 1 ? "" : "s"} · last{" "}
          {fmtWhen(history[0].submittedAt)}
        </div>
      ) : null}
    </Card>
  );
}
