"use client";

/**
 * "Activity" — S6. Everything that touched one account.
 *
 * Auth0 puts a History tab on the user for exactly this. Filtering the
 * global audit log by actor answers only half the question: it shows
 * what the person did and misses everything an admin or the scheduler
 * did TO them. So this reads the log twice — once as the actor, once as
 * the target — and merges the two streams by timestamp.
 *
 *   GET /admin/audit?actorUserId=<id>
 *   GET /admin/audit?targetType=user&targetId=<id>
 *
 * Both are the same keyset endpoint the audit page uses; `since` drives
 * the window chips.
 */

import { useEffect, useMemo, useState } from "react";
import { Badge, Label, Loader, SegmentedControl } from "@/components/ui";
import { apiGet } from "@/lib/api-client";
import { actionTone, changeSummary, formatDateTime } from "./admin-lib";

const WINDOWS = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "all", label: "All time" },
];

const PAGE_SIZE = 60;

function sinceIso(windowValue) {
  if (windowValue === "all") return null;
  const days = Number(windowValue);
  if (!Number.isFinite(days)) return null;
  return new Date(Date.now() - days * 86400000).toISOString();
}

export function UserActivity({ user, usersById }) {
  const [windowValue, setWindowValue] = useState("30");
  const [state, setState] = useState({ loading: true, entries: [], error: null });

  useEffect(() => {
    if (!user?.id) return undefined;
    let cancelled = false;
    setState({ loading: true, entries: [], error: null });
    (async () => {
      const since = sinceIso(windowValue);
      const common = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (since) common.set("since", since);

      const byActor = new URLSearchParams(common);
      byActor.set("actorUserId", user.id);
      const byTarget = new URLSearchParams(common);
      byTarget.set("targetType", "user");
      byTarget.set("targetId", user.id);

      const [did, done] = await Promise.all([
        apiGet(`/admin/audit?${byActor.toString()}`),
        apiGet(`/admin/audit?${byTarget.toString()}`),
      ]);
      if (cancelled) return;

      if (!did.ok && !done.ok) {
        setState({
          loading: false,
          entries: [],
          error: did.error?.message || "Couldn't load this account's activity.",
        });
        return;
      }

      // The two streams overlap whenever someone acted on themselves,
      // so dedupe on the entry id before sorting.
      const merged = new Map();
      for (const e of did.data?.entries ?? []) merged.set(e.id, e);
      for (const e of done.data?.entries ?? []) merged.set(e.id, e);
      const entries = [...merged.values()].sort(
        (a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime(),
      );
      setState({ loading: false, entries, error: null });
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, windowValue]);

  const actorName = useMemo(
    () => (id) => {
      if (!id) return "system";
      if (id === user?.id) return user?.displayName ?? "this account";
      return usersById?.get(id)?.displayName ?? id;
    },
    [user?.id, user?.displayName, usersById],
  );

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <Label>Everything that touched this account</Label>
        <SegmentedControl
          size="sm"
          onCard
          options={WINDOWS}
          value={windowValue}
          onChange={setWindowValue}
        />
      </div>

      {state.loading ? (
        <div className="flex justify-center py-8">
          <Loader />
        </div>
      ) : state.error ? (
        <p className="py-6 text-[13px] text-muted-fg">{state.error}</p>
      ) : state.entries.length === 0 ? (
        <p className="py-6 text-[13px] leading-[1.55] text-muted-fg">
          Nothing recorded in this window — neither by this account nor to it.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col">
          {state.entries.map((e, i) => (
            <li
              key={e.id}
              className={i === 0 ? "py-2.5" : "border-t border-line py-2.5"}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11.5px] tabular-nums text-muted-fg">
                  {formatDateTime(e.ts)}
                </span>
                <Badge tone={actionTone(e.action)}>{e.action}</Badge>
              </div>
              <div className="mt-1 text-[12.5px] leading-[1.5] text-fg">
                {actorName(e.actorUserId)}
                {e.actorRole ? (
                  <span className="text-muted-fg"> · {e.actorRole}</span>
                ) : null}
                <span className="text-muted-fg"> — {changeSummary(e)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!state.loading && state.entries.length >= PAGE_SIZE ? (
        <p className="mt-2 text-[12px] text-dim-fg">
          Showing the most recent {PAGE_SIZE} of each stream. Narrow the window,
          or use the audit log for the full history.
        </p>
      ) : null}
    </div>
  );
}
