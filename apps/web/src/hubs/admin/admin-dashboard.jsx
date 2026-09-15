"use client";

/**
 * Admin hub — overview. A5. Renders at /[hub]/.
 *
 * The page used to count the hubs visible to the org, the number of
 * config-override rows, and how many roles the viewer personally held.
 * None of those is a question an admin walks in with. These are:
 * how many people are there and how many are actually active, who is
 * waiting on me, who has no second factor, and what changed today.
 *
 * Everything here comes from endpoints that already exist —
 *
 *   GET /admin/users                     the roster
 *   GET /hub-configs                     which hubs an override disabled
 *   GET /admin/audit?since=<midnight>    today's events
 *   GET /admin/audit?limit=6             the latest few, for the feed
 *
 * — and nothing is displayed that the API cannot answer. There is no
 * "active sessions" or "storage used" tile, because there is no
 * endpoint behind either.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { apiGet } from "@/lib/api-client";
import { Badge, Button, Label, Loading, PageHeader } from "@/components/ui";
import { useHubLink } from "@/features/hubs";
import { HUBS, HUB_ORDER } from "@espace-devhub/shared/hubs";
import { AdminShell } from "./admin-shell";
import {
  actionTone,
  formatDateTime,
  hubEnabled,
  startOfTodayIso,
  waitedFor,
} from "./admin-lib";
import { patchUser } from "./admin-user-actions";
import { EmptyState } from "./admin-ui";

const TODAY_LIMIT = 200;

export function AdminDashboard() {
  const link = useHubLink();
  const [state, setState] = useState({
    loading: true,
    users: null,
    configs: null,
    today: null,
    todayCapped: false,
    recent: null,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const since = startOfTodayIso();
      const [usersR, configsR, todayR, recentR] = await Promise.all([
        apiGet("/admin/users"),
        apiGet("/hub-configs"),
        apiGet(
          `/admin/audit?since=${encodeURIComponent(since)}&limit=${TODAY_LIMIT}`,
        ),
        apiGet("/admin/audit?limit=6"),
      ]);
      if (cancelled) return;
      setState({
        loading: false,
        users: usersR.ok ? (usersR.data?.users ?? []) : null,
        configs: configsR.ok ? (configsR.data?.configs ?? []) : null,
        today: todayR.ok ? (todayR.data?.entries ?? []) : null,
        todayCapped: todayR.ok ? !!todayR.data?.hasMore : false,
        recent: recentR.ok ? (recentR.data?.entries ?? []) : null,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const { users, configs, today, recent, loading, todayCapped } = state;

  const stats = useMemo(() => {
    if (!users) return null;
    const by = (s) => users.filter((u) => u.status === s);
    const pending = by("pending_admin");
    const oldestPending = [...pending].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    )[0];
    return {
      total: users.length,
      active: by("active").length,
      invited: by("invited").length,
      pending,
      oldestPending,
      noTotp: users.filter((u) => !u.hasTotp && u.status !== "disabled"),
    };
  }, [users]);

  const disabledHubs = useMemo(() => {
    if (!configs) return [];
    const byHub = new Map(configs.map((c) => [c.hubId, c]));
    return HUB_ORDER.filter((id) => !hubEnabled(byHub.get(id) ?? null)).map(
      (id) => ({ id, label: HUBS[id]?.label ?? id, config: byHub.get(id) }),
    );
  }, [configs]);

  const todayCount =
    today === null ? null : todayCapped ? `${TODAY_LIMIT}+` : today.length;
  const configChanges =
    today === null
      ? null
      : today.filter((e) =>
          ["hub_config.", "user.", "signup_code."].some((p) =>
            String(e.action).startsWith(p),
          ),
        ).length;

  function approve(user) {
    return async () => {
      const updated = await patchUser(user, { status: "active" });
      if (!updated) return;
      setState((prev) => ({
        ...prev,
        users: (prev.users ?? []).map((u) => (u.id === updated.id ? updated : u)),
      }));
    };
  }

  return (
    <AdminShell active="dashboard">
      <PageHeader
        crumb="Admin · overview"
        title="Org administration."
        subtitle="Who is here, who is waiting on you, and what changed today."
      />

      {loading ? (
        <Loading label="Loading the org" />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="Members"
              value={stats ? stats.total : null}
              badge={
                stats ? (
                  <Badge tone="mint">
                    {stats.active} active · {stats.invited} invited
                  </Badge>
                ) : null
              }
            />
            <StatTile
              label="Pending approval"
              value={stats ? stats.pending.length : null}
              badge={
                !stats ? null : stats.pending.length === 0 ? (
                  <Badge tone="mint">nobody waiting</Badge>
                ) : (
                  <Badge tone="lemon">
                    {waitedFor(stats.oldestPending?.createdAt)}
                  </Badge>
                )
              }
            />
            <StatTile
              label="Without two-factor"
              value={stats ? stats.noTotp.length : null}
              badge={
                !stats ? null : stats.noTotp.length === 0 ? (
                  <Badge tone="mint">everyone enrolled</Badge>
                ) : (
                  <Badge tone="peach">of {stats.total} members</Badge>
                )
              }
            />
            <StatTile
              label="Events today"
              value={todayCount}
              badge={
                configChanges === null ? null : (
                  <Badge tone="sky">
                    {configChanges} config change{configChanges === 1 ? "" : "s"}
                  </Badge>
                )
              }
            />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            <Panel
              title="Needs a decision"
              badge={
                stats || disabledHubs.length ? (
                  <Badge
                    tone={
                      (stats?.pending.length ?? 0) + disabledHubs.length > 0
                        ? "lemon"
                        : "mint"
                    }
                  >
                    {(stats?.pending.length ?? 0) + disabledHubs.length}
                  </Badge>
                ) : null
              }
            >
              {(stats?.pending.length ?? 0) + disabledHubs.length === 0 ? (
                <EmptyState
                  title="Nothing waiting."
                  body="No one is queued for approval and every hub is visible to the org."
                />
              ) : (
                <div>
                  {stats?.pending.map((u) => (
                    <DecisionRow
                      key={u.id}
                      title={`${u.displayName} asked to join`}
                      sub={`${u.email} · ${waitedFor(u.createdAt)}`}
                      action={
                        <Button
                          type="button"
                          variant="soft"
                          size="sm"
                          onClick={approve(u)}
                        >
                          Approve
                        </Button>
                      }
                    />
                  ))}
                  {disabledHubs.map((hub) => (
                    <DecisionRow
                      key={hub.id}
                      title={`${hub.label} is hidden from the org`}
                      sub="No one can reach it, including its admins."
                      href={link("/hub-config")}
                    />
                  ))}
                </div>
              )}
            </Panel>

            <Panel
              title="Recent changes"
              right={
                <Link
                  href={link("/audit")}
                  className="inline-flex items-center gap-1.5 text-[12.5px] font-bold text-fg"
                >
                  Audit log
                  <ArrowRight size={13} />
                </Link>
              }
            >
              {recent === null ? (
                <p className="py-4 text-[13px] text-muted-fg">
                  Couldn&apos;t read the audit log.
                </p>
              ) : recent.length === 0 ? (
                <EmptyState
                  title="Nothing recorded yet."
                  body="Privileged actions appear here as soon as someone performs one."
                />
              ) : (
                <ul>
                  {recent.map((e, i) => (
                    <li
                      key={e.id}
                      className={`flex flex-wrap items-center gap-2 py-2.5 ${i === 0 ? "" : "border-t border-line"}`}
                    >
                      <span className="w-[108px] shrink-0 text-[11.5px] tabular-nums text-dim-fg">
                        {formatDateTime(e.ts)}
                      </span>
                      <Badge tone={actionTone(e.action)}>{e.action}</Badge>
                      <span className="min-w-0 flex-1 truncate text-right text-[12px] text-muted-fg">
                        {e.actorRole ?? "system"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          {users === null ? (
            <p className="mt-4 text-[12.5px] text-muted-fg">
              The roster couldn&apos;t be read, so the member counts above are
              blank. Your session may have lost the admin role — reload, or ask
              another admin.
            </p>
          ) : null}
        </>
      )}
    </AdminShell>
  );
}

function StatTile({ label, value, badge }) {
  return (
    <div
      className="rounded-[var(--radius-xl)] bg-card p-5"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <Label>{label}</Label>
      <div className="mt-2 flex flex-wrap items-baseline gap-2">
        <span className="text-[44px] font-extrabold leading-none tracking-[-0.04em] tabular-nums text-fg">
          {value === null || value === undefined ? "—" : value}
        </span>
        {badge}
      </div>
    </div>
  );
}

function Panel({ title, badge, right, children }) {
  return (
    <div
      className="rounded-[var(--radius-xl)] bg-card p-5"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[15px] font-bold text-fg">{title}</span>
        {badge}
        <span className="flex-1" />
        {right}
      </div>
      {children}
    </div>
  );
}

function DecisionRow({ title, sub, action, href }) {
  return (
    <div className="flex items-center gap-3 border-t border-line py-3">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold text-fg">{title}</div>
        <div className="truncate text-[12px] text-muted-fg">{sub}</div>
      </div>
      {href ? (
        <Link
          href={href}
          className="inline-flex h-9 shrink-0 items-center rounded-[var(--radius-pill)] bg-card-alt px-4 text-[13px] font-semibold text-fg transition-colors hover:opacity-80"
        >
          Review
        </Link>
      ) : (
        action
      )}
    </div>
  );
}
