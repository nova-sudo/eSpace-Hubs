"use client";

import useSWR from "swr";

import { apiGet } from "@/lib/api-client";

async function fetchPacket(path) {
  const res = await apiGet(path);
  if (!res.ok) throw new Error(res.error?.message || "Couldn't load the review packet.");
  return res.data;
}

/** One stored review packet — owner, their manager or an admin may read it. */
export function useReviewPacket(id) {
  const { data, error, isLoading } = useSWR(id ? `/review-packets/${encodeURIComponent(id)}` : null, fetchPacket);
  return { loading: Boolean(id) && isLoading, packet: data?.packet ?? null, error: error ?? null };
}
