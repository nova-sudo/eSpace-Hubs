"use client";

/**
 * A manager's 1:1 notes on one report — list + create / update / remove.
 *
 *   GET    /manager/reports/:userId/notes
 *   POST   /manager/reports/:userId/notes             { body, visibility }
 *   PATCH  /manager/reports/:userId/notes/:noteId     { body?, visibility? }
 *   DELETE /manager/reports/:userId/notes/:noteId
 *
 * visibility is "private" (only you) or "shared-with-report" (they can
 * read it too). Each mutation resolves { ok, error } and refreshes the
 * list on success.
 */

import { useCallback } from "react";
import { apiDelete, apiPatch, apiPost } from "@/lib/api-client";
import { useFetchOnce } from "./use-fetch-once";

export function useReportNotes(userId) {
  const base = userId ? `/manager/reports/${encodeURIComponent(userId)}/notes` : null;
  const { loading, data, error, refresh } = useFetchOnce(base);

  const run = useCallback(
    async (call) => {
      const r = await call();
      if (r.ok) refresh();
      return { ok: r.ok, error: r.ok ? null : r.error ?? "error" };
    },
    [refresh],
  );

  const create = useCallback(
    (body, visibility) => run(() => apiPost(base, { body, visibility })),
    [base, run],
  );
  const update = useCallback(
    (noteId, patch) => run(() => apiPatch(`${base}/${encodeURIComponent(noteId)}`, patch)),
    [base, run],
  );
  const remove = useCallback(
    (noteId) => run(() => apiDelete(`${base}/${encodeURIComponent(noteId)}`)),
    [base, run],
  );

  return {
    loading,
    error,
    notes: Array.isArray(data?.notes) ? data.notes : [],
    create,
    update,
    remove,
  };
}
