"use client";

import { toast } from "sonner";

import { Button } from "@/components/ui";
import { downloadMarkdown } from "./download-markdown";
import { PACKET_TEMPLATES } from "./packet-model";

export function PacketHeader({ packet }) {
  const template = PACKET_TEMPLATES.find((t) => t.id === packet?.template);
  const name = packet?.submitter?.displayName || "Unknown";

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy the link");
    }
  }

  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="text-[22px] font-bold text-fg">{name}</h1>
        <p className="text-[13px] text-muted-fg">
          {[packet?.rangeLabel, template?.label].filter(Boolean).join(" · ")}
        </p>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="soft" onClick={copyLink}>Copy link</Button>
        {packet?.markdown ? (
          <Button size="sm" variant="soft" onClick={() => downloadMarkdown(packet.markdown, `review-packet-${packet.id}`)}>
            Download .md
          </Button>
        ) : null}
      </div>
    </header>
  );
}
