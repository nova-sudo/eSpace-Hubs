"use client";

/** /[hub]/packets/:id — one frozen review packet (owner, manager or admin). */

import { useParams } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { useHubSlotGuard } from "@/features/hubs";
import { PacketPage } from "@/features/review-packet";

export const dynamic = "force-dynamic";

export default function Page() {
  const exposed = useHubSlotGuard("packets");
  const params = useParams();
  if (!exposed) return null;
  const raw = params?.id;
  const id = Array.isArray(raw) ? raw[0] : (raw ?? null);
  return (
    <AppShell>
      <PacketPage id={id} />
    </AppShell>
  );
}
