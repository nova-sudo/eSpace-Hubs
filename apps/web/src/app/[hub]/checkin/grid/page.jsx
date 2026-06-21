"use client";

/**
 * /[hub]/checkin/grid — RETIRED with the rest of the check-in page. The
 * per-widget cadence stepper covers multi-period backfill on Goals now.
 * Redirects old links to Goals.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useHubLink } from "@/features/hubs";

export const dynamic = "force-dynamic";

export default function Page() {
  const link = useHubLink();
  const router = useRouter();
  useEffect(() => {
    router.replace(link("/goals"));
  }, [router, link]);
  return null;
}
