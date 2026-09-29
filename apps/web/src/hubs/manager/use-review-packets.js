"use client";

/**
 * A report's submitted review packets, newest first:
 * GET /manager/reports/:userId/review-packets. Shared by the board rail's
 * packet card and the board header's one-click download.
 */

import { EMPTY_LIST, useFetchOnce } from "./use-fetch-once";

export function useReviewPackets(userId) {
  const { loading, data, error } = useFetchOnce(
    userId ? `/manager/reports/${encodeURIComponent(userId)}/review-packets` : null,
  );
  return {
    loading,
    error,
    packets: Array.isArray(data?.packets) ? data.packets : EMPTY_LIST,
  };
}

/** Save a packet's frozen markdown as a file — the document itself, as submitted. */
export function downloadPacketMarkdown(packet, personName) {
  if (!packet?.markdown || typeof document === "undefined") return;
  const blob = new Blob([packet.markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const slug = String(personName ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const day = (packet.submittedAt || "").slice(0, 10) || "latest";
  const a = document.createElement("a");
  a.href = url;
  a.download = `review-packet-${slug ? `${slug}-` : ""}${day}.md`;
  a.click();
  // Deferred: revoking synchronously can cancel the download in Safari
  // and Firefox before it has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
