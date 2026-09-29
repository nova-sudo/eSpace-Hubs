"use client";

/**
 * /[hub]/checkin — RETIRED. Filling now lives on each goal card (the
 * per-widget cadence stepper on the Goals page). This route stays only
 * to redirect old bookmarks/links to Goals, with a one-time toast so the
 * jump doesn't read as a broken link.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useHubLink } from "@/features/hubs";

export const dynamic = "force-dynamic";

export default function Page() {
  const link = useHubLink();
  const router = useRouter();
  useEffect(() => {
    toast("Check-ins now live on each goal card", {
      id: "checkin-moved",
      description: "Fill this week's reading from the goal itself — nothing else changed.",
    });
    router.replace(link("/goals?from=checkin"));
  }, [router, link]);
  return (
    <main className="flex min-h-[40vh] items-center justify-center text-[13px] text-muted-fg">
      Taking you to your goals…
    </main>
  );
}
