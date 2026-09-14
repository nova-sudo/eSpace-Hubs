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
import { ChevronDown, ChevronRight } from "lucide-react";
import { apiGet } from "@/lib/api-client";
import { Badge, Button, Input, Label, PageHeader, Select } from "@/components/ui";

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
    <main className="max-w-[1280px] mx-auto px-4 sm:px-10 pb-16 pt-7">
      <PageHeader
        crumb="Admin · audit log"
        title="Privileged-action history."
        subtitle="Append-only record of every audited action — invites, role changes, hub overrides, password resets, integration connect/disconnect, snapshot mutations. Newest first. Filters apply server-side; pagination is keyset on the entry timestamp."
      />

      <FilterBar filters={filters} setFilters={setFilters} users={users} />

      {loading ? (
        <div className="mt-6 text-[12px] text-muted-fg">Loading…</div>
      ) : entries.length === 0 ? (
        <div className="mt-6 text-[12px] text-muted-fg">No audit entries match these filters.</div>
      ) : (
        <div className="mt-5 rounded-[var(--radius-xl)] bg-card" style={{ boxShadow: "var(--shadow-card)" }}>
          <div className="hidden sm:flex items-center gap-4 border-b border-line px-4 py-2.5">
            <span className="text-[12px] font-semibold text-muted-fg" style={{ minWidth: 130 }}>When</span>
            <span className="text-[12px] font-semibold text-muted-fg" style={{ minWidth: 180 }}>Action</span>
            <span className="flex-1 text-[12px] font-semibold text-muted-fg">Actor</span>
            <span className="text-[12px] font-semibold text-muted-fg">Target</span>
          </div>
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
          <div className="p-3">
            {hasMore ? (
              <div className="flex justify-center">
                <Button type="button" variant="soft" size="sm" onClick={loadMore} disabled={loadingMore}>
                  {loadingMore ? "Loading…" : "Load older entries"}
                </Button>
              </div>
            ) : (
              <div className="text-center text-[11px] text-dim-fg">End of audit log.</div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

function FilterBar({ filters, setFilters, users }) {
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-[var(--radius-xl)] bg-card p-4" style={{ boxShadow: "var(--shadow-card)" }}>
      <div className="flex flex-col gap-1.5">
        <Label>Action</Label>
        <Input
          type="text"
          placeholder="e.g. user.update"
          value={filters.action}
          onChange={(e) => setFilters((p) => ({ ...p, action: e.target.value }))}
          className="w-[200px]"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Actor</Label>
        <Select
          value={filters.actorUserId}
          onChange={(e) => setFilters((p) => ({ ...p, actorUserId: e.target.value }))}
          style={{ minWidth: 200 }}
        >
          <option value="">(any user)</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.displayName} — {u.email}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Target type</Label>
        <Input
          type="text"
          placeholder="e.g. user / hub / integration"
          value={filters.targetType}
          onChange={(e) => setFilters((p) => ({ ...p, targetType: e.target.value }))}
          className="w-[200px]"
        />
      </div>
      {filters.action || filters.actorUserId || filters.targetType ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setFilters({ action: "", actorUserId: "", targetType: "" })}
        >
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}

function EntryRow({ entry, expanded, onExpand, actorDisplay }) {
  const hasDiff = entry.before !== undefined || entry.after !== undefined;
  return (
    <div className="border-t border-line first:border-t-0">
      <button
        type="button"
        onClick={onExpand}
        className="flex w-full items-center gap-4 px-4 py-2.5 text-left transition-colors hover:bg-card-alt"
      >
        <span className="text-[11px] text-dim-fg" style={{ minWidth: 130 }}>
          {formatTs(entry.ts)}
        </span>
        <Badge className="shrink-0" style={{ minWidth: 120 }}>{entry.action}</Badge>
        <span className="flex-1 truncate text-[12px] font-semibold">{actorDisplay}</span>
        {entry.targetType ? (
          <span className="text-[11px] text-muted-fg">
            {entry.targetType}
            {entry.targetId ? `/${truncMiddle(entry.targetId, 14)}` : ""}
          </span>
        ) : null}
        {expanded ? <ChevronDown size={14} className="text-dim-fg" /> : <ChevronRight size={14} className="text-dim-fg" />}
      </button>

      {expanded ? (
        <div className="border-t border-line px-4 py-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Meta label="Actor user id" value={entry.actorUserId} />
            <Meta label="Actor role" value={entry.actorRole} />
            <Meta label="Target type" value={entry.targetType} />
            <Meta label="Target id" value={entry.targetId} />
            <Meta label="IP" value={entry.ip} />
            <Meta label="User agent" value={entry.ua} truncate />
          </div>
          {hasDiff ? (
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
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
      <Label>{label}</Label>
      <pre className="mt-1 overflow-auto rounded-[var(--radius-lg)] bg-card-alt p-2.5 text-[11px] leading-[1.45]" style={{ maxHeight: 240 }}>
        {empty ? "—" : safeStringify(data)}
      </pre>
    </div>
  );
}

function Meta({ label, value, truncate }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className={`mt-0.5 text-[11.5px] ${truncate ? "break-all" : ""}`}>
        {value || <span className="text-dim-fg">—</span>}
      </div>
    </div>
  );
}

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
