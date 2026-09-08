"use client";

/**
 * /[hub]/goals-v2 — RETIRED as a separate route. The flow map graduated from
 * preview to being the Goals page itself, so this only redirects the links
 * and bookmarks that pointed at the preview.
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
