"use client";

/**
 * Admin hub — audit log. A3.
 *
 *   GET /api/v1/admin/audit?action=&actorUserId=&targetType=&until=&limit=
 *
 * Four columns — When, Action, Actor, Target — which is the shape
 * GitHub, Okta, Vercel, WorkOS and Stripe all converged on. Context
 * opens INLINE on the row, the way Okta's row arrow does, instead of
 * the old pair of side-by-side JSON scroll boxes nested inside a card
 * that was itself scrolling: two nested scroll regions over a diff of
 * four fields.
 *
 * The header row now renders at every width. It used to appear only at
 * `sm` and up, so on a phone four unlabelled values ran together and
 * there was no way to tell a target from an actor. The table lives in a
 * horizontal scroller instead, so the header always sits above its own
 * column.
 *
 * Pagination is keyset on `ts desc, _id desc`; the server hands back
 * `nextUntil`, which we feed straight back as `?until=`. There is no
 * count() — for an append-only log, recency is the only axis that
 * matters.
 */

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronRight } from "lucide-react";
import { apiGet } from "@/lib/api-client";
import {
  Badge,
  Button,
  Field as UiField,
  Input,
  Label,
  Loading,
  PageHeader,
  Select,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { AdminShell } from "./admin-shell";
import {
  actionTone,
  formatDateTime,
  safeStringify,
  truncMiddle,
} from "./admin-lib";
import { EmptyState } from "./admin-ui";

const PAGE_SIZE = 50;

const COLS =
  "grid grid-cols-[142px_minmax(0,190px)_minmax(0,1fr)_minmax(0,1fr)_32px] items-center gap-3";

export function AdminAudit() {
  const [entries, setEntries] = useState([]);
  const [users, setUsers] = useState([]); // actor-filter dropdown
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

  // Empty strings drop out — the server's Zod optionals only accept
  // present-with-value.
  function buildQuery(f, until) {
    const params = new URLSearchParams();
    params.set("limit", String(PAGE_SIZE));
    if (f.action.trim()) params.set("action", f.action.trim());
    if (f.actorUserId) params.set("actorUserId", f.actorUserId);
    if (f.targetType.trim()) params.set("targetType", f.targetType.trim());
    if (until) params.set("until", until);
    return params.toString();
  }

  // The actor dropdown only needs the roster once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await apiGet("/admin/users");
      if (cancelled) return;
      if (r.ok) setUsers(r.data?.users ?? []);
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

  const filtered = Boolean(
    filters.action || filters.actorUserId || filters.targetType,
  );

  return (
    <AdminShell active="audit">
      <PageHeader
        crumb="Admin · audit log"
        title="Privileged-action history."
        subtitle="Append-only. Every audited action — invites, role changes, hub overrides, password resets, integration connect and disconnect, snapshot mutations. Newest first; filters apply server-side."
      />

      <FilterBar filters={filters} setFilters={setFilters} users={users} />

      {loading ? (
        <Loading label="Loading the audit log" />
      ) : entries.length === 0 ? (
        <div
          className="mt-4 rounded-[var(--radius-xl)] bg-card p-5"
          style={{ boxShadow: "var(--shadow-card)" }}
        >
          <EmptyState
            title={filtered ? "No entries match." : "Nothing recorded yet."}
            body={
              filtered
                ? "Loosen the action, actor or target filter — the log is filtered server-side, so an exact-match typo returns nothing."
                : "Privileged actions appear here as soon as someone performs one."
            }
            action={
              filtered ? (
                <Button
                  type="button"
                  variant="soft"
                  size="sm"
                  onClick={() =>
                    setFilters({ action: "", actorUserId: "", targetType: "" })
                  }
                >
                  Clear filters
                </Button>
              ) : null
            }
          />
        </div>
      ) : (
        <div
          className="mt-4 overflow-hidden rounded-[var(--radius-xl)] bg-card"
          style={{ boxShadow: "var(--shadow-card)" }}
        >
          <div className="overflow-x-auto">
            <div className="min-w-[840px] px-5">
              {/* Visible at every width — the header scrolls with its own
                  columns rather than disappearing below `sm`. */}
              <div className={cn(COLS, "border-b border-line py-3")}>
                <Label>When</Label>
                <Label>Action</Label>
                <Label>Actor</Label>
                <Label>Target</Label>
                <span />
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
                      ? (usersById.get(e.actorUserId)?.displayName ?? e.actorUserId)
                      : "system"
                  }
                />
              ))}
            </div>
          </div>

          <div className="border-t border-line p-4">
            {hasMore ? (
              <div className="flex justify-center">
                <Button
                  type="button"
                  variant="soft"
                  size="sm"
                  onClick={loadMore}
                  disabled={loadingMore}
                >
                  {loadingMore ? "Loading…" : "Load older"}
                </Button>
              </div>
            ) : (
              <div className="text-center text-[12px] text-dim-fg">
                End of the audit log.
              </div>
            )}
          </div>
        </div>
      )}
    </AdminShell>
  );
}

function FilterBar({ filters, setFilters, users }) {
  return (
    <div
      className="flex flex-wrap items-end gap-3 rounded-[var(--radius-xl)] bg-card p-4"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <UiField label="Action" className="min-w-[180px] flex-1 sm:max-w-[220px]">
        <Input
          type="text"
          placeholder="e.g. user.update"
          value={filters.action}
          onChange={(e) => setFilters((p) => ({ ...p, action: e.target.value }))}
        />
      </UiField>
      <UiField label="Actor" className="min-w-[200px] flex-1 sm:max-w-[260px]">
        <Select
          value={filters.actorUserId}
          onChange={(e) =>
            setFilters((p) => ({ ...p, actorUserId: e.target.value }))
          }
          className="w-full"
        >
          <option value="">(any actor)</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.displayName} — {u.email}
            </option>
          ))}
        </Select>
      </UiField>
      <UiField
        label="Target type"
        className="min-w-[180px] flex-1 sm:max-w-[220px]"
      >
        <Input
          type="text"
          placeholder="e.g. user / hub / integration"
          value={filters.targetType}
          onChange={(e) =>
            setFilters((p) => ({ ...p, targetType: e.target.value }))
          }
        />
      </UiField>
      {filters.action || filters.actorUserId || filters.targetType ? (
        <Button
          type="button"
          variant="soft"
          size="sm"
          onClick={() =>
            setFilters({ action: "", actorUserId: "", targetType: "" })
          }
        >
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}

function EntryRow({ entry, expanded, onExpand, actorDisplay }) {
  const hasDiff = entry.before !== undefined || entry.after !== undefined;
  const isSystem = !entry.actorUserId;

  return (
    <div className="border-b border-line last:border-b-0">
      <button
        type="button"
        onClick={onExpand}
        aria-expanded={expanded}
        className={cn(
          COLS,
          "w-full py-2.5 text-left transition-colors hover:bg-card-alt",
        )}
      >
        <span className="text-[12px] tabular-nums text-muted-fg">
          {formatDateTime(entry.ts)}
        </span>
        <span className="min-w-0">
          <Badge tone={actionTone(entry.action)} className="max-w-full truncate">
            {entry.action}
          </Badge>
        </span>
        <span
          className={cn(
            "truncate text-[12.5px]",
            isSystem ? "text-dim-fg" : "font-semibold text-fg",
          )}
        >
          {actorDisplay}
          {entry.actorRole ? (
            <span className="font-normal text-muted-fg"> · {entry.actorRole}</span>
          ) : null}
        </span>
        <span className="truncate font-mono text-[11.5px] text-muted-fg">
          {entry.targetType
            ? `${entry.targetType}${entry.targetId ? `/${truncMiddle(entry.targetId, 16)}` : ""}`
            : "—"}
        </span>
        <span className="justify-self-center">
          {expanded ? (
            <ChevronDown size={15} className="text-fg" />
          ) : (
            <ChevronRight size={15} className="text-dim-fg" />
          )}
        </span>
      </button>

      {/* Inline on the row. One flow, no nested scroll box — the diff is
          a handful of trimmed fields, so it is shown in full. */}
      {expanded ? (
        <div className="pb-4 pl-[154px] pr-8">
          {hasDiff ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <DiffPanel label="Before" data={entry.before} />
              <DiffPanel label="After" data={entry.after} />
            </div>
          ) : (
            <p className="text-[12.5px] text-muted-fg">
              This action records no field diff — only that it happened.
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-muted-fg">
            <ContextBit label="Actor id" value={entry.actorUserId} mono />
            <ContextBit label="Target id" value={entry.targetId} mono />
            <ContextBit label="IP" value={entry.ip} mono />
            <ContextBit label="Agent" value={entry.ua} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DiffPanel({ label, data }) {
  const empty = data === null || data === undefined;
  return (
    <div className="rounded-[var(--radius-lg)] bg-card-alt p-3.5">
      <Label className="mb-1.5 block">{label}</Label>
      {empty ? (
        <div className="text-[12.5px] text-dim-fg">—</div>
      ) : (
        <pre className="m-0 whitespace-pre-wrap break-words font-mono text-[11.5px] leading-[1.55] text-fg">
          {safeStringify(data)}
        </pre>
      )}
    </div>
  );
}

function ContextBit({ label, value, mono }) {
  if (!value) return null;
  return (
    <span className="min-w-0 max-w-full break-all">
      <span className="font-semibold">{label}</span>{" "}
      <span className={mono ? "font-mono" : undefined}>{value}</span>
    </span>
  );
}
