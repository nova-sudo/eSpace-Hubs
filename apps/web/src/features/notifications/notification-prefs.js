"use client";

/**
 * Hook over GET/PUT /api/v1/notifications/preferences — the caller's
 * muted kinds, email opt-in and the server's `unmutable` floor. SWR-cached
 * (CLAUDE.md: SWR for all remote data); nothing else in the app reads
 * these (the server applies them).
 *
 * Saves are optimistic and serialised by a sequence number: only the
 * latest save's response is written back, and a failed save rolls back
 * ONLY the field it toggled (not a whole stale snapshot), so a second
 * quick toggle is never undone by the first one's failure or late reply.
 * Unmutable kinds are never sent as muted.
 */

import { useCallback, useRef, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { apiGet, apiPut } from "@/lib/api-client";
import { nextMuted, withoutUnmutable } from "./prefs-model";

export const NOTIFICATION_PREFS_KEY = "/notifications/preferences";

async function fetchPrefs() {
  const r = await apiGet(NOTIFICATION_PREFS_KEY);
  if (!r.ok) throw new Error(r.error?.message || "Couldn't load preferences.");
  const unmutable = Array.isArray(r.data?.unmutable) ? r.data.unmutable : [];
  return {
    muted: withoutUnmutable(Array.isArray(r.data?.muted) ? r.data.muted : [], unmutable),
    email: r.data?.email !== false,
    unmutable,
  };
}

export function useNotificationPrefs() {
  const { data, error, isLoading, mutate } = useSWR(NOTIFICATION_PREFS_KEY, fetchPrefs, {
    revalidateOnFocus: false,
  });
  const [saving, setSaving] = useState(false);
  const seq = useRef(0);

  /**
   * Optimistic save. `apply(cur)` produces the optimistic value, `undo(cur)`
   * reverses only this change on failure.
   */
  const commit = useCallback(
    async (patch, apply, undo) => {
      const mine = ++seq.current;
      setSaving(true);
      await mutate((cur) => (cur ? apply(cur) : cur), { revalidate: false });
      const r = await apiPut(NOTIFICATION_PREFS_KEY, patch);
      const latest = mine === seq.current;
      if (latest) setSaving(false);
      if (!r.ok) {
        await mutate((cur) => (cur ? undo(cur) : cur), { revalidate: false });
        toast.error(r.error?.message || "Couldn't save notification preferences.");
        return false;
      }
      // A newer save is in flight — its response is the one to trust.
      if (latest) {
        await mutate(
          (cur) =>
            cur
              ? {
                  ...cur,
                  muted: Array.isArray(r.data?.muted)
                    ? withoutUnmutable(r.data.muted, cur.unmutable)
                    : cur.muted,
                  email: r.data?.email !== false,
                }
              : cur,
          { revalidate: false },
        );
      }
      return true;
    },
    [mutate],
  );

  const setEmail = useCallback(
    (email) =>
      commit(
        { email },
        (cur) => ({ ...cur, email }),
        (cur) => ({ ...cur, email: !email }),
      ),
    [commit],
  );

  const toggleKind = useCallback(
    (kind) => {
      const cur = data;
      if (!cur || cur.unmutable.includes(kind)) return Promise.resolve(false);
      const mute = !cur.muted.includes(kind);
      const muted = nextMuted(cur.muted, kind, mute, cur.unmutable);
      return commit(
        { muted },
        (c) => ({ ...c, muted: nextMuted(c.muted, kind, mute, c.unmutable) }),
        (c) => ({ ...c, muted: nextMuted(c.muted, kind, !mute, c.unmutable) }),
      );
    },
    [data, commit],
  );

  return {
    loading: isLoading && !data,
    error: !data && error ? error.message : null,
    muted: data?.muted ?? [],
    email: data?.email ?? true,
    unmutable: data?.unmutable ?? [],
    saving,
    setEmail,
    toggleKind,
    reload: () => mutate(),
  };
}
