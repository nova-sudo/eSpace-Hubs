"use client";

import { Button, Card } from "@/components/ui";
import { downloadMarkdown } from "./download-markdown";

/** v1 packets: the frozen markdown, shown as-is. */
export function PacketLegacy({ packet }) {
  const markdown = packet?.markdown ?? "";
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex justify-end">
        <Button size="sm" variant="soft" onClick={() => downloadMarkdown(markdown, `review-packet-${packet?.id ?? ""}`)}>
          Download .md
        </Button>
      </div>
      <pre className="whitespace-pre-wrap rounded-[var(--radius-lg)] bg-card-alt p-4 font-sans text-[13px] leading-[1.55] text-fg">{markdown}</pre>
    </Card>
  );
}
