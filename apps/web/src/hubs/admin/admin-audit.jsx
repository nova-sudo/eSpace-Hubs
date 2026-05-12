"use client";

/**
 * Admin Hub — audit log viewer. UI on top of:
 *   GET /api/v1/admin/audit?action=&actorUserId=&targetType=&since=&until=&limit=
 *
 * Mirrors the users-page chrome (same header, same row pattern). The
 * audit log is read-only by contract (lib/audit.ts has no
 * update/delete), so this view is list + filter + expand-for-diff.
 *
 * Filtering
 * ─────────
 * Three filters surfaced in the toolbar — the API supports more but
 * action, actor, and targetType are the ones an admin actually reaches
 * for. The other filters (targetId, since, until) are useful in
 * scripts but cluttered the UI; we can promote them later if needed.
 *
 *   action       free-text exact match. Hint: dot-namespaced verb
 *                like "user.update" or "hub_config.upsert".
 *   actor        dropdown of org users (one prefetch on mount). Sends
 *                the user's hex ObjectId.
 *   targetType   free-text exact match. Common values: user, hub,
 *                integration, snapshot.
 *
 * Pagination
 * ─────────
 * Keyset on `ts desc, _id desc`. Server returns `hasMore` + a
 * convenience `nextUntil` we feed straight back as `?until=…`. No
 * count(); the only way to know "how many total" is to scroll the
 * stream. That's fine for an audit log — it's append-only and the
 * UI cares about recency.
 *
 * Diff expand
 * ─────────
 * Audit entries carry `before` / `after` blobs scoped to just the
 * changed fields (per the admin controller's diff trimming). We
 * render them as side-by-side pretty-printed JSON. For entries
 * without a diff (read-only actions like `auth.login`), the expand
 * panel just shows the actor + IP/UA metadata.
 */

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { apiGet } from "@/lib/api-client";

const PAGE_SIZE = 50;

export function AdminAudit() {
  const [entries, setEntries] = useState([]);
  const [users, setUsers] = useState([]); // for actor-filter dropdown
  const [hasMore, setHasMore] = useState(false);
  const [nextUntil, setNextUntil] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filters, setFilters] = useState({
    action: "",
    actorUserId: "",
    targetType: "",
  });
  const [openEntryId, setOpenEntryId] = useState(null);

  // Build a query string from a filter snapshot + an optional `until`
  // for pagination. Empty strings drop out — Zod's optional on the
  // server only accepts present-with-value.
  function buildQuery(f, until) {
    const params = new URLSearchParams();
    params.set("limit", String(PAGE_SIZE));
    if (f.action.trim()) params.set("action", f.action.trim());
    if (f.actorUserId) params.set("actorUserId", f.actorUserId);
    if (f.targetType.trim()) params.set("targetType", f.targetType.trim());
    if (until) params.set("until", until);
    return params.toString();
  }

  // Initial load + reload whenever filters change.
  // Users dropdown only fetches once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await apiGet("/admin/users");
      if (cancelled) return;
      if (r.ok) {
        setUsers(r.data?.users ?? []);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setOpenEntryId(null);
    (async () => {
      const r = await apiGet(`/admin/audit?${buildQuery(filters, null)}`);
      if (cancelled) return;
      if (!r.ok) {
        toast.error(r.error?.message || "Couldn't load audit log.");
        setLoading(false);
        return;
      }
      setEntries(r.data?.entries ?? []);
      setHasMore(!!r.data?.hasMore);
      setNextUntil(r.data?.nextUntil ?? null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [filters]);

  async function loadMore() {
    if (!nextUntil || loadingMore) return;
    setLoadingMore(true);
    const r = await apiGet(`/admin/audit?${buildQuery(filters, nextUntil)}`);
    setLoadingMore(false);
    if (!r.ok) {
      toast.error(r.error?.message || "Couldn't load more entries.");
      return;
    }
    setEntries((prev) => [...prev, ...(r.data?.entries ?? [])]);
    setHasMore(!!r.data?.hasMore);
    setNextUntil(r.data?.nextUntil ?? null);
  }

  const usersById = useMemo(() => {
    const map = new Map();
    for (const u of users) map.set(u.id, u);
    return map;
  }, [users]);

  return (
    <main className="relative z-[2] mx-auto max-w-5xl px-10 pb-14 pt-10">
      <header className="mb-8">
        <div
          className="mb-2 uppercase tracking-[0.5px] text-muted-fg"
          style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
        >
          Admin · audit log
        </div>
        <h1
          className="font-semibold"
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 28,
            letterSpacing: "-0.5px",
          }}
        >
          Privileged-action history.
        </h1>
        <p className="mt-2 max-w-2xl text-[13.5px] leading-[1.55] text-muted-fg">
          Append-only record of every audited action — invites, role
          changes, hub overrides, password resets, integration
          connect/disconnect, snapshot mutations. Newest first. Filters
          apply server-side; pagination is keyset on the entry
          timestamp.
        </p>
      </header>

      <FilterBar filters={filters} setFilters={setFilters} users={users} />

      {loading ? (
        <div
          className="mt-6 text-muted-fg"
          style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}
        >
          Loading…
        </div>
      ) : entries.length === 0 ? (
        <div
          className="mt-6 text-muted-fg"
          style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}
        >
          No audit entries match these filters.
        </div>
      ) : (
        <div className="mt-5 flex flex-col gap-1.5">
          {entries.map((e) => (
            <EntryRow
              key={e.id}
              entry={e}
              expanded={openEntryId === e.id}
              onExpand={() =>
                setOpenEntryId(openEntryId === e.id ? null : e.id)
              }
              actorDisplay={
                e.actorUserId
                  ? usersById.get(e.actorUserId)?.displayName ?? e.actorUserId
                  : "system"
              }
            />
          ))}
          {hasMore ? (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.5px",
                  textTransform: "uppercase",
                  background: "transparent",
                  color: "var(--accent)",
                  border: "1px solid var(--accent)",
                  borderRadius: "var(--radius-sub, 3px)",
                  padding: "8px 16px",
                  cursor: loadingMore ? "wait" : "pointer",
                }}
              >
                {loadingMore ? "Loading…" : "Load older entries"}
              </button>
            </div>
          ) : (
            <div
              className="mt-3 text-center text-muted-fg"
              style={{ fontFamily: "var(--font-mono)", fontSize: 10.5 }}
            >
              End of audit log.
            </div>
          )}
        </div>
      )}
    </main>
  );
}

function FilterBar({ filters, setFilters, users }) {
  return (
    <div
      className="flex flex-wrap items-end gap-3 rounded-md border bg-card p-4"
      style={{ borderColor: "var(--border-strong)" }}
    >
      <div className="flex flex-col gap-1.5">
        <FilterLabel>Action</FilterLabel>
        <input
          type="text"
          placeholder="e.g. user.update"
          value={filters.action}
          onChange={(e) =>
            setFilters((p) => ({ ...p, action: e.target.value }))
          }
          style={{ ...inputStyle, width: 200 }}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <FilterLabel>Actor</FilterLabel>
        <select
          value={filters.actorUserId}
          onChange={(e) =>
            setFilters((p) => ({ ...p, actorUserId: e.target.value }))
          }
          style={{ ...inputStyle, minWidth: 200 }}
        >
          <option value="">(any user)</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.displayName} — {u.email}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <FilterLabel>Target type</FilterLabel>
        <input
          type="text"
          placeholder="e.g. user / hub / integration"
          value={filters.targetType}
          onChange={(e) =>
            setFilters((p) => ({ ...p, targetType: e.target.value }))
          }
          style={{ ...inputStyle, width: 200 }}
        />
      </div>
      {(filters.action || filters.actorUserId || filters.targetType) ? (
        <button
          type="button"
          onClick={() =>
            setFilters({ action: "", actorUserId: "", targetType: "" })
          }
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            color: "var(--muted-fg)",
            background: "transparent",
            border: "1px solid var(--border-strong)",
            borderRadius: "var(--radius-sub, 3px)",
            padding: "8px 12px",
            cursor: "pointer",
          }}
        >
          Clear filters
        </button>
      ) : null}
    </div>
  );
}

function EntryRow({ entry, expanded, onExpand, actorDisplay }) {
  const hasDiff = entry.before !== undefined || entry.after !== undefined;
  return (
    <div
      className="rounded-sm border bg-card"
      style={{ borderColor: "var(--border)" }}
    >
      <button
        type="button"
        onClick={onExpand}
        className="flex w-full items-center gap-4 px-4 py-2.5 text-left transition-colors hover:bg-accent-dim/10"
      >
        <span
          className="text-muted-fg"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            minWidth: 130,
            letterSpacing: "0.2px",
          }}
        >
          {formatTs(entry.ts)}
        </span>
        <span
          className="text-accent"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            fontWeight: 600,
            minWidth: 180,
          }}
        >
          {entry.action}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11.5,
            flex: 1,
          }}
        >
          {actorDisplay}
        </span>
        {entry.targetType ? (
          <span
            className="text-muted-fg"
            style={{ fontFamily: "var(--font-mono)", fontSize: 10.5 }}
          >
            {entry.targetType}
            {entry.targetId ? `/${truncMiddle(entry.targetId, 14)}` : ""}
          </span>
        ) : null}
        <span
          className="text-muted-fg"
          style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
        >
          {expanded ? "▾" : "▸"}
        </span>
      </button>

      {expanded ? (
        <div
          className="border-t px-4 py-4"
          style={{ borderColor: "var(--border)" }}
        >
          <div className="grid grid-cols-2 gap-4">
            <Meta label="Actor user id" value={entry.actorUserId} />
            <Meta label="Actor role" value={entry.actorRole} />
            <Meta label="Target type" value={entry.targetType} />
            <Meta label="Target id" value={entry.targetId} />
            <Meta label="IP" value={entry.ip} />
            <Meta label="User agent" value={entry.ua} truncate />
          </div>
          {hasDiff ? (
            <div className="mt-4 grid grid-cols-2 gap-4">
              <DiffPanel label="before" data={entry.before} />
              <DiffPanel label="after" data={entry.after} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function DiffPanel({ label, data }) {
  const empty = data === null || data === undefined;
  return (
    <div>
      <div
        className="mb-1 uppercase tracking-[0.4px] text-muted-fg"
        style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
      >
        {label}
      </div>
      <pre
        className="overflow-auto rounded-sm border p-2"
        style={{
          borderColor: "var(--border)",
          background: "var(--card-alt, var(--card))",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          lineHeight: 1.45,
          maxHeight: 240,
          margin: 0,
        }}
      >
        {empty ? "—" : safeStringify(data)}
      </pre>
    </div>
  );
}

function Meta({ label, value, truncate }) {
  return (
    <div>
      <div
        className="uppercase tracking-[0.4px] text-muted-fg"
        style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11.5,
          marginTop: 2,
          wordBreak: truncate ? "break-all" : "normal",
        }}
      >
        {value || <span className="text-dim-fg">—</span>}
      </div>
    </div>
  );
}

function FilterLabel({ children }) {
  return (
    <span
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        letterSpacing: "0.5px",
        color: "var(--muted-fg)",
        textTransform: "uppercase",
      }}
    >
      {children}
    </span>
  );
}

const inputStyle = {
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  padding: "8px 10px",
  background: "var(--card)",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-sub, 3px)",
  outline: "none",
};

function formatTs(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function truncMiddle(s, max) {
  if (typeof s !== "string" || s.length <= max) return s;
  const half = Math.floor((max - 1) / 2);
  return `${s.slice(0, half)}…${s.slice(-half)}`;
}

function safeStringify(v) {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
