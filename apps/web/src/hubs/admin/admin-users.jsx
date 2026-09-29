"use client";

/**
 * Admin hub — members. Two views over one roster:
 *
 *   "Table"  (A1) the flat list. Everyone appears exactly once, because
 *                 status is a FILTER rather than a section — the old page
 *                 rendered a "Pending approvals" block above the roster
 *                 and then the roster, so a pending person showed twice.
 *                 Search, multi-select with a bulk bar that exists only
 *                 while rows are selected, and a per-row overflow menu.
 *   "Detail" (A2) the same list beside a non-modal side panel for the
 *                 selected account, tabbed Details / Access / Activity.
 *
 * The choice persists to localStorage and broadcasts a change event, so
 * a second tab follows along (admin-users-view-store.js).
 *
 * The roster is PAGINATED server-side (hub-audit §2.3): search, the
 * status pills and the reporting-line filters (`?flag=no_manager`,
 * `?flag=disabled_manager`, `?managerId=`, `?q=` — the overview and org
 * chart link here with them) all run in the API, and "Load more" follows
 * the keyset cursor. Names for the manager column, the pickers and the
 * reassign dialog come from the lightweight directory.
 *
 * API surface:
 *   GET    /admin/users?q=&status=&flag=&managerId=&cursor=   one page
 *   GET    /admin/users/directory           id/name/email/roles/manager
 *   POST   /admin/users/:id/reassign-reports  move a whole team
 *   PATCH  /admin/users/:id                 roles / status / hubs / name / …
 *   POST   /admin/users/:id/totp/reset      clear an authenticator
 *   DELETE /admin/users/:id/personal-data   wipe dashboard data
 *   GET    /admin/signup-codes  · POST · PATCH   self-serve signup codes
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { apiGet, apiPatch, apiPost } from "@/lib/api-client";
import { useSession } from "@/features/auth";
import {
  Avatar,
  Badge,
  Button,
  Checkbox,
  Field as UiField,
  Input,
  Label,
  Loading,
  PageHeader,
  SegmentedControl,
  Select,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { CAPABILITIES } from "@espace-devhub/shared/capabilities";
import { AdminNotAuthorised, AdminShell } from "./admin-shell";
import {
  ALL_ROLES,
  STATUS_FILTERS,
  formatDate,
  formatRelative,
} from "./admin-lib";
import { patchUser, resetTotp, wipeDashboardData } from "./admin-user-actions";
import {
  EmptyState,
  FilterPill,
  OverflowMenu,
  StatusBadge,
  useConfirm,
} from "./admin-ui";
import { InviteDialog } from "./admin-invite-dialog";
import { UserPanel } from "./admin-user-panel";
import { ReassignReportsDialog } from "./admin-reassign-dialog";
import { AdminApproveDialog } from "./admin-approve-dialog";
import { useUsersView } from "./admin-users-view-store";

const PAGE_SIZE = 50;

/** Reporting-line filters the overview / org chart deep-link to. */
const FLAG_LABELS = {
  no_manager: "People with no manager",
  disabled_manager: "Reports of a disabled manager",
};

const VIEW_OPTIONS = [
  { value: "table", label: "Table" },
  { value: "detail", label: "Detail" },
];

export function AdminUsers() {
  const { user: sessionUser } = useSession();
  const [view, setView] = useUsersView();
  const confirm = useConfirm();

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const flag = searchParams.get("flag") || "";
  const managerFilter = searchParams.get("managerId") || "";

  const [users, setUsers] = useState([]);
  const [directory, setDirectory] = useState([]);
  const [counts, setCounts] = useState({ all: 0 });
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [query, setQuery] = useState(() => searchParams.get("q") || "");
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [activeUserId, setActiveUserId] = useState(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [reassign, setReassign] = useState(null); // { manager, disabling }
  const [approving, setApproving] = useState(null); // a pending_admin member
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);

  const canManage = sessionUser?.capabilities?.includes(
    CAPABILITIES.ADMIN_USERS_MANAGE,
  );

  // Typing shouldn't fire a request per keystroke.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(id);
  }, [query]);

  const pageQuery = useCallback(
    (cursor) => {
      const p = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (debouncedQuery) p.set("q", debouncedQuery);
      if (statusFilter !== "all") p.set("status", statusFilter);
      if (flag) p.set("flag", flag);
      if (managerFilter) p.set("managerId", managerFilter);
      if (cursor) p.set("cursor", cursor);
      return `/admin/users?${p.toString()}`;
    },
    [debouncedQuery, statusFilter, flag, managerFilter],
  );

  /**
   * Re-read the first page for the current filters. `initial` also drives
   * the page-level loading and error states; a background refresh (after
   * an invite, say) leaves the list on screen and only toasts on failure.
   */
  const loadUsers = useCallback(
    async ({ initial = false } = {}) => {
      const gen = ++generation.current;
      const r = await apiGet(pageQuery(null));
      if (gen !== generation.current) return null;
      if (!r.ok) {
        const message = r.error?.message || "Couldn't load users.";
        toast.error(message);
        if (initial) {
          setLoadError(message);
          setLoading(false);
        }
        return null;
      }
      const next = r.data?.users ?? [];
      setUsers(next);
      setCounts(r.data?.counts ?? { all: next.length });
      setNextCursor(r.data?.hasMore ? (r.data?.nextCursor ?? null) : null);
      setLoadError(null);
      setLoading(false);
      return next;
    },
    [pageQuery],
  );

  const loadDirectory = useCallback(async () => {
    const r = await apiGet("/admin/users/directory");
    if (r.ok) setDirectory(r.data?.users ?? []);
  }, []);

  useEffect(() => {
    void loadUsers({ initial: true });
  }, [loadUsers]);

  useEffect(() => {
    void loadDirectory();
  }, [loadDirectory]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    const gen = generation.current;
    setLoadingMore(true);
    const r = await apiGet(pageQuery(nextCursor));
    setLoadingMore(false);
    if (gen !== generation.current) return;
    if (!r.ok) {
      toast.error(r.error?.message || "Couldn't load more members.");
      return;
    }
    setUsers((prev) => [...prev, ...(r.data?.users ?? [])]);
    setNextCursor(r.data?.hasMore ? (r.data?.nextCursor ?? null) : null);
  }

  function clearLinkFilters() {
    const p = new URLSearchParams(searchParams.toString());
    p.delete("flag");
    p.delete("managerId");
    p.delete("q");
    const qs = p.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  // Name lookups for every member, not just the loaded page.
  const usersById = useMemo(() => {
    const map = new Map();
    for (const u of directory) map.set(u.id, u);
    for (const u of users) map.set(u.id, u);
    return map;
  }, [directory, users]);

  const reportCount = useMemo(() => {
    const m = new Map();
    for (const u of directory) {
      if (u.managerId) m.set(u.managerId, (m.get(u.managerId) ?? 0) + 1);
    }
    return m;
  }, [directory]);

  // Filtering happens server-side; the loaded rows ARE the visible rows.
  const visible = users;

  // Never act on a row the admin can't see: whenever the filter or the
  // search narrows the list, drop anything that fell out of it.
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const allowed = new Set(visible.map((u) => u.id));
      const next = new Set([...prev].filter((id) => allowed.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [visible]);

  function applyUpdate(updated) {
    if (!updated) return;
    // PATCH returns the plain public row; keep the page row's resolved
    // manager name unless the manager itself changed.
    setUsers((prev) =>
      prev.map((u) => {
        if (u.id !== updated.id) return u;
        const mgr = updated.managerId ? usersById.get(updated.managerId) : null;
        return {
          ...u,
          ...updated,
          managerName:
            updated.managerId === u.managerId ? u.managerName : (mgr?.displayName ?? null),
          managerStatus:
            updated.managerId === u.managerId ? u.managerStatus : (mgr?.status ?? null),
        };
      }),
    );
    setDirectory((prev) =>
      prev.map((d) =>
        d.id === updated.id
          ? {
              ...d,
              displayName: updated.displayName,
              status: updated.status,
              roles: updated.roles,
              managerId: updated.managerId,
            }
          : d,
      ),
    );
  }

  /**
   * A status change moves someone between filter chips, and the chip counts
   * come from the server — lift the row, then re-read the counts.
   */
  function applyStatusChange(updated) {
    if (!updated) return;
    applyUpdate(updated);
    void loadUsers();
  }

  /** After a team move: re-read both the page and the directory. */
  function refreshAll() {
    void loadUsers();
    void loadDirectory();
  }

  function toggleSelected(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openUser(id) {
    setActiveUserId(id);
    setView("detail");
  }

  const selected = useMemo(
    () => [...selectedIds].map((id) => usersById.get(id)).filter(Boolean),
    [selectedIds, usersById],
  );

  /* ── bulk actions ──────────────────────────────────────────── */

  async function runBulk(targets, fn, summary) {
    if (targets.length === 0) return;
    setBusy(true);
    let changed = 0;
    for (const target of targets) {
      const updated = await fn(target);
      if (updated) {
        applyUpdate(updated);
        changed += 1;
      }
    }
    setBusy(false);
    setSelectedIds(new Set());
    if (changed > 0) {
      toast.success(summary(changed));
      void loadUsers(); // counts on the filter chips
    }
  }

  function bulkSetStatus(status) {
    // Disabling yourself is refused server-side; drop self from the batch
    // rather than sending a request that is guaranteed to fail.
    const targets = selected.filter(
      (u) => u.status !== status && !(status === "disabled" && u.id === sessionUser?.id),
    );
    if (targets.length === 0) {
      toast.info("Nothing to change in that selection.");
      return;
    }
    const run = () =>
      runBulk(
        targets,
        (u) => patchUser(u, { status }, { silent: true }),
        (n) =>
          status === "disabled"
            ? `Disabled ${n} member${n === 1 ? "" : "s"}.`
            : `Activated ${n} member${n === 1 ? "" : "s"}.`,
      );

    if (status === "disabled") {
      confirm({
        title: `Disable ${targets.length} member${targets.length === 1 ? "" : "s"}?`,
        body: "They are signed out of the app and can't sign back in until an admin re-activates them. Their data is untouched.",
        confirmLabel: "Disable",
        onConfirm: run,
      });
      return;
    }
    void run();
  }

  function bulkAddRole(role) {
    const targets = selected.filter((u) => !u.roles.includes(role));
    if (targets.length === 0) {
      toast.info(`Everyone selected already holds "${role}".`);
      return;
    }
    void runBulk(
      targets,
      (u) => patchUser(u, { roles: [...u.roles, role] }, { silent: true }),
      (n) => `Added "${role}" to ${n} member${n === 1 ? "" : "s"}.`,
    );
  }

  function bulkResetTotp() {
    const targets = selected.filter((u) => u.hasTotp && u.id !== sessionUser?.id);
    if (targets.length === 0) {
      toast.info("Nobody in that selection has an authenticator to reset.");
      return;
    }
    confirm({
      title: `Reset two-factor for ${targets.length} member${targets.length === 1 ? "" : "s"}?`,
      body: "Their authenticator apps stop working immediately and they re-enrol at next sign-in. Confirm out-of-band that each request is genuine.",
      confirmLabel: "Reset two-factor",
      onConfirm: () =>
        runBulk(
          targets,
          (u) => resetTotp(u, { silent: true }),
          (n) => `Two-factor reset for ${n} member${n === 1 ? "" : "s"}.`,
        ),
    });
  }

  /* ── per-row actions ───────────────────────────────────────── */

  function rowMenuItems(u) {
    const isSelf = u.id === sessionUser?.id;
    return [
      { label: "Edit access", onSelect: () => openUser(u.id) },
      u.status === "pending_admin"
        ? {
            label: "Approve…",
            onSelect: () => setApproving(u),
          }
        : null,
      u.hasTotp && !isSelf
        ? {
            label: "Reset two-factor",
            danger: true,
            onSelect: () =>
              confirm({
                title: `Reset two-factor for ${u.displayName}?`,
                body: "Their authenticator app stops working immediately and they re-enrol at next sign-in. Confirm out-of-band that the request really came from them.",
                confirmLabel: "Reset two-factor",
                onConfirm: async () => applyUpdate(await resetTotp(u)),
              }),
          }
        : null,
      {
        label: "Wipe dashboard data",
        danger: true,
        onSelect: () =>
          confirm({
            title: `Wipe all dashboard data for ${u.displayName}?`,
            body: "Deletes their goals, snapshots, AI verdicts and goal specs, context and inputs. The account, its integrations and its sessions are left alone. This cannot be undone.",
            confirmLabel: "Wipe dashboard data",
            onConfirm: () => wipeDashboardData(u),
          }),
      },
      (reportCount.get(u.id) ?? 0) > 0
        ? {
            label: `Reassign ${reportCount.get(u.id)} report${reportCount.get(u.id) === 1 ? "" : "s"}…`,
            onSelect: () => setReassign({ manager: u, disabling: false }),
          }
        : null,
      u.status === "disabled"
        ? {
            label: "Re-activate",
            onSelect: async () => applyStatusChange(await patchUser(u, { status: "active" })),
          }
        : {
            label: "Disable account",
            danger: true,
            disabled: isSelf,
            onSelect: () =>
              // A manager with a team gets the reassign dialog instead of
              // the plain confirm — disabling them strands their queue.
              (reportCount.get(u.id) ?? 0) > 0
                ? setReassign({ manager: u, disabling: true })
                : confirm({
                    title: `Disable ${u.displayName}?`,
                    body: "They are signed out and can't sign back in until an admin re-activates them. Their data is untouched.",
                    confirmLabel: "Disable",
                    onConfirm: async () =>
                      applyStatusChange(await patchUser(u, { status: "disabled" })),
                  }),
          },
    ];
  }

  if (!canManage) {
    return (
      <AdminNotAuthorised
        active="users"
        crumb="Admin · members"
        capability={CAPABILITIES.ADMIN_USERS_MANAGE}
      />
    );
  }

  const activeUser = activeUserId ? usersById.get(activeUserId) : null;

  return (
    <AdminShell active="users">
      <PageHeader
        crumb="Admin · members"
        title="Members of your org."
        subtitle="Everyone with an account here, once. Status is a filter, so a person waiting for approval shows up in the same list as everybody else."
        right={
          <div className="flex items-center gap-2">
            <SegmentedControl ariaLabel="Users view"
              size="sm"
              options={VIEW_OPTIONS}
              value={view}
              onChange={setView}
            />
            <Button
              type="button"
              variant="ink"
              size="sm"
              onClick={() => setInviteOpen(true)}
            >
              Invite
            </Button>
          </div>
        }
      />

      {inviteOpen ? (
        <InviteDialog
          users={directory}
          onClose={() => setInviteOpen(false)}
          onSuccess={(opts) => {
            if (!opts?.keepOpen) setInviteOpen(false);
            void loadUsers();
          }}
        />
      ) : null}

      {/* Status as a filter, plus a name/email search — at any org size
          above a screenful, the old page had neither. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {STATUS_FILTERS.map((f) => (
          <FilterPill
            key={f.value}
            label={f.label}
            count={f.value === "all" ? (counts.all ?? 0) : (counts[f.value] ?? 0)}
            active={statusFilter === f.value}
            onClick={() => setStatusFilter(f.value)}
          />
        ))}
        {flag || managerFilter ? (
          <span className="inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] bg-ink px-3 py-1.5 text-[12px] font-semibold text-ink-on">
            {FLAG_LABELS[flag] ??
              `Reports of ${usersById.get(managerFilter)?.displayName ?? "one manager"}`}
            <button
              type="button"
              onClick={clearLinkFilters}
              aria-label="Clear this filter"
              className="ml-1 opacity-80 hover:opacity-100"
            >
              ×
            </button>
          </span>
        ) : null}
        <div className="relative ml-auto min-w-[200px] flex-1 sm:max-w-[280px] sm:flex-none">
          <Search
            size={15}
            aria-hidden="true"
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-dim-fg"
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search members by name or email"
            placeholder="Search name or email"
            className="h-9 bg-card pl-9 text-[13px]"
          />
        </div>
      </div>

      {loading ? (
        <Loading label="Loading members" />
      ) : loadError ? (
        <div
          className="rounded-[var(--radius-xl)] bg-card p-5"
          style={{ boxShadow: "var(--shadow-card)" }}
        >
          <EmptyState
            title="Couldn't load the roster."
            body={loadError}
            action={
              <Button
                type="button"
                variant="soft"
                size="sm"
                onClick={() => {
                  setLoading(true);
                  void loadUsers({ initial: true });
                }}
              >
                Try again
              </Button>
            }
          />
        </div>
      ) : users.length === 0 && !debouncedQuery && !flag && !managerFilter && statusFilter === "all" ? (
        <div
          className="rounded-[var(--radius-xl)] bg-card p-5"
          style={{ boxShadow: "var(--shadow-card)" }}
        >
          <EmptyState
            title="No members yet."
            body="Invite the first person, or mint a signup code below so they can join themselves."
            action={
              <Button
                type="button"
                variant="ink"
                size="sm"
                onClick={() => setInviteOpen(true)}
              >
                Invite
              </Button>
            }
          />
        </div>
      ) : view === "detail" ? (
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <CompactList
            users={visible}
            activeUserId={activeUserId}
            sessionUserId={sessionUser?.id}
            onPick={setActiveUserId}
          />
          <div className="xl:sticky xl:top-[88px]">
            {activeUser ? (
              <UserPanel
                key={activeUser.id}
                user={activeUser}
                isSelf={activeUser.id === sessionUser?.id}
                allUsers={directory}
                usersById={usersById}
                onUpdate={applyUpdate}
                onClose={() => setActiveUserId(null)}
                confirm={confirm}
              />
            ) : (
              <div
                className="rounded-[var(--radius-xl)] bg-card p-5"
                style={{ boxShadow: "var(--shadow-card)" }}
              >
                <EmptyState
                  title="Pick a member."
                  body="Their details, access and full activity history open here — the list stays readable while you edit."
                />
              </div>
            )}
          </div>
        </div>
      ) : (
        <MembersTable
          users={visible}
          total={counts.all ?? users.length}
          sessionUserId={sessionUser?.id}
          usersById={usersById}
          selectedIds={selectedIds}
          onToggleSelected={toggleSelected}
          onSelectAll={(checked) =>
            setSelectedIds(checked ? new Set(visible.map((u) => u.id)) : new Set())
          }
          onOpen={openUser}
          rowMenuItems={rowMenuItems}
          busy={busy}
          onBulkStatus={bulkSetStatus}
          onBulkAddRole={bulkAddRole}
          onBulkResetTotp={bulkResetTotp}
          onClearSelection={() => setSelectedIds(new Set())}
        />
      )}

      {nextCursor && !loading && !loadError ? (
        <div className="mt-4 flex justify-center">
          <Button
            type="button"
            variant="soft"
            size="sm"
            disabled={loadingMore}
            onClick={() => void loadMore()}
          >
            {loadingMore ? "Loading…" : `Load more (${users.length} of ${
              statusFilter === "all" ? (counts.all ?? "?") : (counts[statusFilter] ?? "?")
            })`}
          </Button>
        </div>
      ) : null}

      {approving ? (
        <AdminApproveDialog
          user={approving}
          directory={directory}
          onClose={() => setApproving(null)}
          onApproved={(updated) => {
            setApproving(null);
            applyUpdate(updated);
            toast.success(`Approved ${updated.displayName}.`, {
              description: updated.managerId
                ? `They report to ${usersById.get(updated.managerId)?.displayName ?? "their manager"}.`
                : "No manager — their approvals go to admins.",
            });
            // The filter chips' counts come from the server — re-read them
            // (and the directory, for report counts).
            refreshAll();
          }}
        />
      ) : null}

      {reassign ? (
        <ReassignReportsDialog
          manager={reassign.manager}
          directory={directory}
          disabling={reassign.disabling}
          onClose={() => setReassign(null)}
          onDone={({ disabledUser }) => {
            setReassign(null);
            if (disabledUser) applyUpdate(disabledUser);
            refreshAll();
          }}
        />
      ) : null}

      {/* Self-serve signup configuration. Codes an admin distributes
          out-of-band to people who should be able to /signup into this
          org without an individual invite. */}
      <SignupCodesPanel />

      {confirm.dialog}
    </AdminShell>
  );
}

/* ══════════════════════════ A1 — the table ══════════════════════════ */

const COLS =
  "grid grid-cols-[28px_minmax(0,1.7fr)_158px_minmax(0,0.9fr)_128px_92px_40px] items-center gap-3";

function MembersTable({
  users,
  total,
  sessionUserId,
  usersById,
  selectedIds,
  onToggleSelected,
  onSelectAll,
  onOpen,
  rowMenuItems,
  busy,
  onBulkStatus,
  onBulkAddRole,
  onBulkResetTotp,
  onClearSelection,
}) {
  const allSelected = users.length > 0 && users.every((u) => selectedIds.has(u.id));
  const anySelected = selectedIds.size > 0;

  return (
    <div
      className="overflow-hidden rounded-[var(--radius-xl)] bg-card"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      {/* The bulk bar exists only while rows are selected — it is not a
          permanently-disabled toolbar taking up a row of chrome. */}
      {anySelected ? (
        <BulkBar
          count={selectedIds.size}
          busy={busy}
          onStatus={onBulkStatus}
          onAddRole={onBulkAddRole}
          onResetTotp={onBulkResetTotp}
          onClear={onClearSelection}
        />
      ) : null}

      <div className="overflow-x-auto">
        <div className="min-w-[860px] px-5">
          <div className={cn(COLS, "border-b border-line py-3")}>
            <span onClick={(e) => e.stopPropagation()}>
              <Checkbox
                checked={allSelected}
                onChange={() => onSelectAll(!allSelected)}
                label={allSelected ? "Clear selection" : "Select every visible member"}
              />
            </span>
            <Label>Member</Label>
            <Label>Status</Label>
            <Label>Roles</Label>
            <Label>Manager</Label>
            <Label>Last seen</Label>
            <span />
          </div>

          {users.length === 0 ? (
            <EmptyState
              title="Nobody matches."
              body={`None of the ${total} member${total === 1 ? "" : "s"} in this org matches the current filter and search.`}
            />
          ) : (
            users.map((u) => (
              <MemberRow
                key={u.id}
                user={u}
                isSelf={u.id === sessionUserId}
                selected={selectedIds.has(u.id)}
                managerName={
                  u.managerId
                    ? `${u.managerName ?? usersById.get(u.managerId)?.displayName ?? "—"}${
                        u.managerStatus === "disabled" ? " (disabled)" : ""
                      }`
                    : "—"
                }
                onToggleSelected={() => onToggleSelected(u.id)}
                onOpen={() => onOpen(u.id)}
                menuItems={rowMenuItems(u)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function BulkBar({ count, busy, onStatus, onAddRole, onResetTotp, onClear }) {
  const [role, setRole] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-2 bg-ink px-5 py-2.5">
      <span className="text-[12.5px] font-bold text-ink-on">
        {count} selected
      </span>
      <span className="flex-1" />
      <Select
        value={role}
        size="sm"
        aria-label="Add a role to every selected member"
        onChange={(e) => {
          const next = e.target.value;
          setRole("");
          if (next) onAddRole(next);
        }}
        disabled={busy}
        className="min-w-[132px]"
      >
        <option value="">Add role…</option>
        {ALL_ROLES.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </Select>
      <Button
        type="button"
        variant="soft"
        size="sm"
        disabled={busy}
        onClick={onResetTotp}
      >
        Reset two-factor
      </Button>
      <Button
        type="button"
        variant="soft"
        size="sm"
        disabled={busy}
        onClick={() => onStatus("active")}
      >
        Activate
      </Button>
      <Button
        type="button"
        variant="soft"
        size="sm"
        disabled={busy}
        onClick={() => onStatus("disabled")}
      >
        Disable
      </Button>
      <Button type="button" variant="soft" size="sm" onClick={onClear}>
        Clear
      </Button>
    </div>
  );
}

function MemberRow({
  user,
  isSelf,
  selected,
  managerName,
  onToggleSelected,
  onOpen,
  menuItems,
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Open ${user.displayName}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        COLS,
        "cursor-pointer border-b border-line py-2.5 transition-colors last:border-b-0 hover:bg-card-alt",
        selected && "bg-card-alt",
        user.status === "disabled" && "opacity-60",
      )}
    >
      {/* The row is itself activatable, so the two controls inside it have
          to keep their clicks and keystrokes to themselves. */}
      <span
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <Checkbox
          checked={selected}
          onChange={onToggleSelected}
          label={`Select ${user.displayName}`}
        />
      </span>

      <div className="flex min-w-0 items-center gap-2.5">
        <Avatar name={user.displayName} size={28} tone={isSelf ? "sky" : "lav"} />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-bold text-fg">
            {user.displayName}
            {isSelf ? <span className="text-muted-fg"> (you)</span> : null}
          </div>
          <div className="truncate text-[11.5px] text-muted-fg">{user.email}</div>
        </div>
      </div>

      <span>
        <StatusBadge status={user.status} />
      </span>

      <span className="truncate text-[12px] text-muted-fg">
        {user.roles.join(" · ")}
      </span>
      <span className="truncate text-[12px] text-muted-fg">{managerName}</span>
      <span className="text-[12px] text-muted-fg">
        {formatRelative(user.lastLoginAt)}
      </span>

      <span
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        className="justify-self-end"
      >
        <OverflowMenu items={menuItems} label={`Actions for ${user.displayName}`} />
      </span>
    </div>
  );
}

/* ══════════════════════ A2 — the list beside the panel ══════════════════════ */

function CompactList({ users, activeUserId, sessionUserId, onPick }) {
  return (
    <div
      className="rounded-[var(--radius-xl)] bg-card px-5"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      {users.length === 0 ? (
        <EmptyState
          title="Nobody matches."
          body="Clear the search or pick another status filter."
        />
      ) : (
        users.map((u, i) => {
          const active = u.id === activeUserId;
          return (
            <button
              key={u.id}
              type="button"
              onClick={() => onPick(u.id)}
              aria-current={active ? "true" : undefined}
              className={cn(
                "flex w-full items-center gap-2.5 py-2.5 text-left transition-colors",
                i > 0 && "border-t border-line",
                active && "bg-card-alt",
                u.status === "disabled" && "opacity-60",
              )}
            >
              <Avatar
                name={u.displayName}
                size={28}
                tone={u.id === sessionUserId ? "sky" : "lav"}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-bold text-fg">
                  {u.displayName}
                </div>
                <div className="truncate text-[11.5px] text-muted-fg">{u.email}</div>
              </div>
              <StatusBadge status={u.status} />
              <ChevronRight size={15} className="shrink-0 text-dim-fg" />
            </button>
          );
        })
      )}
    </div>
  );
}

/* ══════════════════════════ signup codes ══════════════════════════ */

function SignupCodesPanel() {
  const [codes, setCodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [newExpires, setNewExpires] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await apiGet("/admin/signup-codes");
      if (cancelled) return;
      if (!r.ok) {
        toast.error(r.error?.message || "Couldn't load signup codes.");
        setLoading(false);
        return;
      }
      setCodes(r.data?.codes ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleMint(e) {
    e.preventDefault();
    if (!newCode.trim()) return;
    setSubmitting(true);
    const body = { code: newCode.trim() };
    if (newExpires) {
      // datetime-local gives a tz-less string; read it as the admin's own
      // timezone and send an offset-bearing ISO stamp.
      body.expiresAt = new Date(newExpires).toISOString();
    }
    const r = await apiPost("/admin/signup-codes", body);
    setSubmitting(false);
    if (!r.ok) {
      toast.error(r.error?.message || "Couldn't mint code.");
      return;
    }
    setCodes((prev) => [r.data.code, ...prev]);
    setNewCode("");
    setNewExpires("");
    toast.success(`Code "${r.data.code.code}" minted.`);
  }

  async function handleToggle(code) {
    const target = code.disabledAt ? false : true;
    const r = await apiPatch(
      `/admin/signup-codes/${encodeURIComponent(code.code)}`,
      { disabled: target },
    );
    if (!r.ok) {
      toast.error(r.error?.message || "Couldn't update code.");
      return;
    }
    setCodes((prev) => prev.map((c) => (c.code === code.code ? r.data.code : c)));
    toast.success(
      target ? `Code "${code.code}" disabled.` : `Code "${code.code}" re-enabled.`,
    );
  }

  return (
    <section
      className="mt-4 overflow-hidden rounded-[var(--radius-xl)] bg-card"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-4 px-5 py-3.5 text-left transition-colors hover:bg-card-alt"
      >
        <div className="flex items-baseline gap-3">
          <span className="text-[14.5px] font-bold text-fg">Signup codes</span>
          <span className="text-[12px] text-muted-fg">
            {loading
              ? "loading…"
              : `${codes.filter((c) => !c.disabledAt).length} active · ${codes.length} total`}
          </span>
        </div>
        {expanded ? (
          <ChevronDown size={15} className="text-dim-fg" />
        ) : (
          <ChevronRight size={15} className="text-dim-fg" />
        )}
      </button>

      {expanded ? (
        <div className="border-t border-line px-5 py-4">
          <p className="mb-3.5 text-[12.5px] leading-[1.55] text-muted-fg">
            Distribute these out-of-band to people who should be able to create
            an account at <span className="font-mono">/signup</span>. Every
            signup attempt validates the code; disabled and expired codes are
            rejected.
          </p>

          <form className="mb-4 flex flex-wrap items-end gap-2" onSubmit={handleMint}>
            <UiField label="Code" className="min-w-[180px] flex-1">
              <Input
                value={newCode}
                onChange={(e) => setNewCode(e.target.value)}
                placeholder="ESPACE-2026"
                disabled={submitting}
                className="font-mono tracking-[0.05em]"
              />
            </UiField>
            <UiField label="Expires (optional)" className="min-w-[180px] flex-1">
              <Input
                type="datetime-local"
                value={newExpires}
                onChange={(e) => setNewExpires(e.target.value)}
                disabled={submitting}
              />
            </UiField>
            <Button
              type="submit"
              variant="ink"
              size="sm"
              disabled={!newCode.trim() || submitting}
            >
              {submitting ? "Minting…" : "Mint code"}
            </Button>
          </form>

          {codes.length === 0 ? (
            <div className="text-[12.5px] text-muted-fg">
              No codes yet. Mint one above to enable self-serve signup.
            </div>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {codes.map((c) => (
                <SignupCodeRow
                  key={c.code}
                  code={c}
                  onToggle={() => handleToggle(c)}
                />
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}

function SignupCodeRow({ code, onToggle }) {
  const isDisabled = !!code.disabledAt;
  const isExpired =
    code.expiresAt && new Date(code.expiresAt).getTime() <= Date.now();
  const dim = isDisabled || isExpired;
  return (
    <li
      className={cn(
        "flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-lg)] bg-card-alt px-3.5 py-2.5",
        dim && "opacity-55",
      )}
    >
      <div className="flex flex-wrap items-center gap-3">
        <code className="font-mono text-[13px] font-bold tracking-[0.04em] text-fg">
          {code.code}
        </code>
        <Label>used {code.usedCount}×</Label>
        {isExpired ? <Badge tone="peach">Expired</Badge> : null}
        {isDisabled ? <Badge>Disabled</Badge> : null}
        {code.expiresAt && !isExpired ? (
          <Label>expires {formatDate(code.expiresAt)}</Label>
        ) : null}
      </div>
      <Button type="button" variant="soft" size="sm" onClick={onToggle}>
        {isDisabled ? "Enable" : "Disable"}
      </Button>
    </li>
  );
}
