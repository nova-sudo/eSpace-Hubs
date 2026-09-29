"use client";

/**
 * Admin hub — approvals with no manager. Renders at /[hub]/approvals on
 * the admin hub (hub-audit §1.3).
 *
 * The Build-Your-Own approval gate is hard: a tracker never goes live
 * unreviewed. When its owner has no manager — or their manager's account
 * is disabled — the tracker waits here instead, and any admin decides it
 * with the same two verbs a manager has: Approve (it goes live) or
 * Request changes (sent back with a note). The owner is notified either
 * way. Assigning the person a manager moves the item to that manager's
 * queue, so the lasting fix is on the Members page.
 *
 *   GET  /admin/approvals
 *   POST /admin/approvals/:userId/:goalId   { decision, note }
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { apiGet, apiPost } from "@/lib/api-client";
import { Avatar, Badge, Button, Label, Loading, PageHeader } from "@/components/ui";
import { useHubLink } from "@/features/hubs";
import { AdminShell } from "./admin-shell";
import { formatDate, waitedFor } from "./admin-lib";
import { EmptyState } from "./admin-ui";

const TIER_ROWS = [
  ["notAchieved", "Not achieved", "peach"],
  ["achieved", "Achieved", "mint"],
  ["overAchieved", "Over-achieved", "sky"],
  ["roleModel", "Role model", "lav"],
];

const REASON = {
  no_manager: { label: "No manager", tone: "lemon" },
  manager_disabled: { label: "Manager disabled", tone: "peach" },
};

const keyOf = (it) => `${it.user.id}:${it.goal.id}`;

export function AdminApprovals() {
  const link = useHubLink();
  const [state, setState] = useState({ loading: true, error: null, items: [] });
  const [busy, setBusy] = useState(null);
  const [changesFor, setChangesFor] = useState(null);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    const r = await apiGet("/admin/approvals");
    setState(
      r.ok
        ? { loading: false, error: null, items: r.data?.items ?? [] }
        : { loading: false, error: r.error?.message || "Couldn't load approvals.", items: [] },
    );
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const oldest = useMemo(
    () => (state.items[0] ? waitedFor(state.items[0].submittedAt ? new Date(state.items[0].submittedAt).toISOString() : null) : null),
    [state.items],
  );

  async function decide(item, decision) {
    const key = keyOf(item);
    setBusy(key);
    const r = await apiPost(
      `/admin/approvals/${encodeURIComponent(item.user.id)}/${encodeURIComponent(item.goal.id)}`,
      { decision, note: decision === "request_changes" ? note : "" },
    );
    setBusy(null);
    if (!r.ok) {
      toast.error("Couldn't submit", { description: r.error?.message || "Try again in a moment." });
      if (r.error?.code === "has_manager" || r.error?.code === "not_pending") void load();
      return;
    }
    const first = item.user.displayName.split(" ")[0];
    toast.success(
      decision === "approve" ? `Approved — live for ${first}` : `Sent back to ${first} with your note`,
    );
    setChangesFor(null);
    setNote("");
    setState((s) => ({ ...s, items: s.items.filter((it) => keyOf(it) !== key) }));
  }

  return (
    <AdminShell active="approvals">
      <PageHeader
        crumb="Admin · approvals"
        title="Trackers with no manager to approve them."
        subtitle="Build-Your-Own trackers never go live unreviewed. When the owner has no active manager, the decision is yours. Assign them a manager on the Members page and future ones go to that manager instead."
        right={
          <span className="text-[12.5px] text-muted-fg">
            {state.loading
              ? "Loading…"
              : `${state.items.length} waiting${oldest ? ` · oldest ${oldest}` : ""}`}
          </span>
        }
      />

      {state.loading ? (
        <Loading label="Loading approvals" />
      ) : state.error ? (
        <Panel>
          <EmptyState
            title="Couldn't load approvals."
            body={state.error}
            action={
              <Button type="button" variant="soft" size="sm" onClick={() => void load()}>
                Try again
              </Button>
            }
          />
        </Panel>
      ) : state.items.length === 0 ? (
        <Panel>
          <EmptyState
            title="Nothing waiting."
            body="Everyone who submitted a tracker has a manager reviewing it."
          />
        </Panel>
      ) : (
        <div className="flex flex-col gap-4">
          {state.items.map((item) => {
            const key = keyOf(item);
            const reason = REASON[item.reason] ?? REASON.no_manager;
            const open = changesFor === key;
            return (
              <Panel key={key}>
                <div className="flex flex-wrap items-start gap-3">
                  <Avatar name={item.user.displayName} size={32} tone="lav" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[14.5px] font-bold text-fg">{item.goal.title}</div>
                    <div className="mt-0.5 text-[12.5px] text-muted-fg">
                      {item.user.displayName} · {item.user.email}
                      {item.submittedAt ? ` · submitted ${formatDate(new Date(item.submittedAt).toISOString())}` : ""}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Badge tone={reason.tone}>{reason.label}</Badge>
                      {item.cadence ? <Badge>{item.cadence}</Badge> : null}
                      {item.periods.length ? <Badge>{item.periods.length} periods</Badge> : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Link
                      href={link(`/users?q=${encodeURIComponent(item.user.email)}`)}
                      className="text-[12.5px] font-semibold text-muted-fg hover:text-fg"
                    >
                      Assign a manager
                    </Link>
                    <Button
                      type="button"
                      variant="soft"
                      size="sm"
                      disabled={busy === key}
                      onClick={() => {
                        setChangesFor(open ? null : key);
                        setNote("");
                      }}
                    >
                      Request changes
                    </Button>
                    <Button
                      type="button"
                      variant="ink"
                      size="sm"
                      disabled={busy === key}
                      onClick={() => void decide(item, "approve")}
                    >
                      Approve
                    </Button>
                  </div>
                </div>

                {open ? (
                  <div className="mt-4 rounded-[var(--radius-lg)] bg-card-alt p-3">
                    <label className="block">
                      <Label>What should change?</Label>
                      <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        rows={3}
                        maxLength={2000}
                        className="mt-2 w-full resize-y rounded-[var(--radius-md)] bg-card px-3 py-2 text-[13px] text-fg outline-none"
                        placeholder="They'll see this with the tracker sent back to them."
                      />
                    </label>
                    <div className="mt-2 flex justify-end gap-2">
                      <Button type="button" variant="ghost" size="sm" onClick={() => setChangesFor(null)}>
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        variant="ink"
                        size="sm"
                        disabled={busy === key || !note.trim()}
                        onClick={() => void decide(item, "request_changes")}
                      >
                        Send back
                      </Button>
                    </div>
                  </div>
                ) : null}

                <div className="mt-4 grid gap-4 md:grid-cols-3">
                  <Block title="What they'll log">
                    {item.fields.length === 0 ? (
                      <span className="text-muted-fg">No fields.</span>
                    ) : (
                      item.fields.map((f, i) => (
                        <div key={`${f.label}-${i}`} className="truncate">
                          {f.label || f.kind}
                          <span className="text-muted-fg"> · {f.kind}</span>
                        </div>
                      ))
                    )}
                  </Block>
                  <Block title="Plan">
                    {item.periods.length === 0 ? (
                      <span className="text-muted-fg">One continuous tracker.</span>
                    ) : (
                      item.periods.slice(0, 12).map((p, i) => (
                        <div key={`${p.label}-${i}`} className="truncate">
                          {p.label}
                          {p.dueAt ? <span className="text-muted-fg"> · due {p.dueAt}</span> : null}
                        </div>
                      ))
                    )}
                    {item.periods.length > 12 ? (
                      <div className="text-muted-fg">+{item.periods.length - 12} more</div>
                    ) : null}
                  </Block>
                  <Block title="Achievement levels">
                    {item.tiers ? (
                      TIER_ROWS.filter(([k]) => item.tiers[k]).map(([k, label, tone]) => (
                        <div key={k} className="flex items-start gap-2">
                          <Badge tone={tone}>{label}</Badge>
                          <span className="min-w-0 flex-1">{item.tiers[k]}</span>
                        </div>
                      ))
                    ) : (
                      <span className="text-muted-fg">No levels set.</span>
                    )}
                  </Block>
                </div>
              </Panel>
            );
          })}
        </div>
      )}
    </AdminShell>
  );
}

function Panel({ children }) {
  return (
    <div className="rounded-[var(--radius-xl)] bg-card p-5" style={{ boxShadow: "var(--shadow-card)" }}>
      {children}
    </div>
  );
}

function Block({ title, children }) {
  return (
    <div className="min-w-0">
      <Label>{title}</Label>
      <div className="mt-2 flex flex-col gap-1.5 text-[12.5px] leading-snug text-fg">{children}</div>
    </div>
  );
}
