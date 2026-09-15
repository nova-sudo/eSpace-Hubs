"use client";

/**
 * Manager Hub — Build-Your-Own approvals. Renders at /[hub]/approvals.
 *
 * COMPOSED trackers a report composed themselves, held pending until you
 * approve. Approve activates it (goes live for the report), Request
 * changes sends it back with a note. Either way the report is notified.
 *
 * The queue is a RAIL and the decision bar is PINNED AT THE TOP. As one
 * tall card per tracker, a 13-week plan put every field, period and tier
 * between you and the Approve button, then made you scroll back up for
 * the next one — and the period list had to truncate at eight, hiding
 * exactly the part worth reviewing. Here all periods fit, and asking for
 * changes opens a note without taking the approve path off the screen.
 *
 * Some fields read themselves from GitHub/GitLab. Those get their own block,
 * one plain-English sentence each ("Checks AGENTS.md exists in espace/hubs
 * (GitHub)"), because approving a query an AI assembled — from text that may
 * have come out of an uploaded document — is the point at which a human is
 * supposed to be able to say no. A template id would make that impossible.
 *
 * Data: GET /manager/approvals; POST /manager/reports/:id/goals/:id/approval.
 */

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { Avatar, Badge, Button, Card, Label, PageHeader } from "@/components/ui";
import { apiPost } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { useApprovalsQueue } from "./use-approvals-queue";
import { EmptyCard } from "./manager-ui";
import { daysWaiting, plural, waitedFor } from "./manager-format";

const TIER_ROWS = [
  ["notAchieved", "Not achieved", "peach"],
  ["achieved", "Achieved", "mint"],
  ["overAchieved", "Over-achieved", "sky"],
  ["roleModel", "Role model", "lav"],
];

const keyOf = (item) => `${item.user.id}:${item.goal.id}`;

export function ManagerApprovals() {
  const { loading, items, error, refresh } = useApprovalsQueue();
  const [selectedKey, setSelectedKey] = useState(null);
  const [changesFor, setChangesFor] = useState(null); // "userId:goalId"
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(null);

  // Oldest first — the one that has been waiting longest is the one a
  // report is most likely blocked on.
  const sorted = useMemo(
    () => [...items].sort((a, b) => (a.submittedAt ?? 0) - (b.submittedAt ?? 0)),
    [items],
  );
  const selected =
    sorted.find((it) => keyOf(it) === selectedKey) ?? sorted[0] ?? null;
  const oldest = sorted[0] ? waitedFor(sorted[0].submittedAt) : null;

  async function decide(item, decision, noteText) {
    const key = keyOf(item);
    setBusy(key);
    const r = await apiPost(
      `/manager/reports/${encodeURIComponent(item.user.id)}/goals/${encodeURIComponent(
        item.goal.id,
      )}/approval`,
      { decision, note: noteText || "" },
    );
    setBusy(null);
    if (r.ok) {
      setChangesFor(null);
      setNote("");
      toast.success(
        decision === "approve"
          ? `Approved — live for ${item.user.displayName.split(" ")[0]}`
          : `Sent back to ${item.user.displayName.split(" ")[0]} with your notes`,
      );
      refresh();
    } else {
      toast.error("Couldn't submit", {
        description: r.error?.message || "Try again in a moment.",
      });
    }
  }

  return (
    <main className="mx-auto max-w-[1280px] px-4 pb-16 pt-7 sm:px-10">
      <PageHeader
        crumb="Build-Your-Own goals · pending your approval"
        title="Custom trackers, on hold."
        subtitle="When a report composes their own tracker, it stays inactive until you approve the fields and tiers. Nothing goes live behind your back."
        right={
          <span className="text-[12.5px] text-muted-fg">
            {loading
              ? "Loading…"
              : `${plural(items.length, "waiting", "waiting")}${oldest ? ` · oldest ${oldest}` : ""}`}
          </span>
        }
      />

      {error ? (
        <EmptyCard>
          Couldn&apos;t load pending approvals right now. Refresh, or check back
          in a moment.
        </EmptyCard>
      ) : loading ? (
        <EmptyCard>Loading…</EmptyCard>
      ) : items.length === 0 ? (
        <EmptyCard>
          Nothing&apos;s waiting on you. When a report builds their own tracker,
          it shows up here for approval before it goes live.
        </EmptyCard>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[270px_minmax(0,1fr)]">
          <Card padding={11}>
            {sorted.map((item) => {
              const key = keyOf(item);
              const active = key === keyOf(selected);
              const waited = waitedFor(item.submittedAt);
              const stale = daysWaiting(item.submittedAt) >= 7;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSelectedKey(key)}
                  className={cn(
                    "flex w-full gap-2.5 rounded-[var(--radius-lg)] p-2.5 text-left transition-colors",
                    active ? "bg-card-alt" : "hover:bg-card-alt",
                  )}
                >
                  <Avatar
                    name={item.user.displayName}
                    size={28}
                    tone={stale ? "lemon" : "lav"}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-bold text-fg">
                      {item.user.displayName}
                    </span>
                    <span className="mt-0.5 block text-[11.5px] leading-[1.35] text-muted-fg">
                      {item.goal.title}
                    </span>
                    {waited ? (
                      <span className="mt-1.5 block">
                        <Badge tone={stale ? "lemon" : "neutral"}>
                          waiting {waited}
                        </Badge>
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </Card>

          {selected ? (
            <ApprovalDetail
              item={selected}
              busy={busy === keyOf(selected)}
              changesOpen={changesFor === keyOf(selected)}
              note={note}
              onNote={setNote}
              onOpenChanges={() => {
                setChangesFor(keyOf(selected));
                setNote("");
              }}
              onCancelChanges={() => {
                setChangesFor(null);
                setNote("");
              }}
              onDecide={decide}
            />
          ) : null}
        </div>
      )}
    </main>
  );
}

function ApprovalDetail({
  item,
  busy,
  changesOpen,
  note,
  onNote,
  onOpenChanges,
  onCancelChanges,
  onDecide,
}) {
  const waited = waitedFor(item.submittedAt);
  return (
    <div
      className="overflow-hidden rounded-[var(--radius-xl)] bg-card"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      {/* The decision lives at the top: you never scroll a 13-week plan
          to reach it, and asking for changes never takes it away. */}
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
        <div className="min-w-[220px] flex-1">
          <div className="text-[11.5px] text-muted-fg">
            {[item.user.displayName, item.user.role, item.user.department]
              .filter(Boolean)
              .join(" · ")}
            {waited ? ` · submitted ${waited === "today" ? "today" : `${waited} ago`}` : ""}
          </div>
          <div className="mt-0.5 text-[16px] font-bold tracking-[-0.01em] text-fg">
            {item.goal.title}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            type="button"
            variant="danger"
            size="sm"
            disabled={busy}
            onClick={onOpenChanges}
          >
            Request changes
          </Button>
          <Button
            type="button"
            variant="ink"
            size="sm"
            disabled={busy}
            onClick={() => onDecide(item, "approve")}
          >
            <Check size={14} />
            {busy ? "Working…" : "Approve & activate"}
          </Button>
        </div>
      </div>

      <div className="px-5 py-5">
        {changesOpen ? (
          <div className="mb-5 rounded-[var(--radius-lg)] bg-card-alt p-3.5">
            <Label className="mb-2 block">What should they change?</Label>
            <textarea
              value={note}
              onChange={(e) => onNote(e.target.value)}
              placeholder="What should they change before this goes live?"
              autoFocus
              className="w-full rounded-[var(--radius-lg)] bg-card p-3.5 text-[13px] leading-relaxed outline-none focus:ring-2 focus:ring-ink"
              style={{ minHeight: 72, resize: "vertical" }}
            />
            <div className="mt-2.5 flex gap-2">
              <Button
                type="button"
                variant="ink"
                size="sm"
                disabled={busy}
                onClick={() => onDecide(item, "request_changes", note)}
              >
                {busy ? "Sending…" : "Send back"}
              </Button>
              <Button type="button" variant="soft" size="sm" onClick={onCancelChanges}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Badge tone="lav">Build-Your-Own tracker</Badge>
          {item.cadence ? (
            <Badge>
              {item.cadence}
              {item.periods?.length ? ` · ${item.periods.length} periods` : ""}
            </Badge>
          ) : null}
          <Badge>
            {plural(item.fields.length, "field", "fields")}
            {item.autoFields?.length ? ` · ${item.autoFields.length} auto` : ""}
          </Badge>
        </div>

        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <div>
            <Label className="mb-2 block">Fields captured each period</Label>
            {item.fields.length ? (
              <div className="flex flex-wrap gap-1.5">
                {item.fields.map((f, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] bg-card-alt px-2.5 py-1.5 text-[12px]"
                  >
                    {f.kind ? (
                      <span className="text-[11px] font-bold text-muted-fg">
                        {f.kind}
                      </span>
                    ) : null}
                    <span className="font-semibold text-fg">{f.label || "—"}</span>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-[12.5px] text-muted-fg">
                No manual fields — this tracker reads itself.
              </p>
            )}
          </div>

          <div>
            <Label className="mb-2 block">Achievement levels</Label>
            {item.tiers ? (
              <div className="grid gap-1.5 sm:grid-cols-2">
                {TIER_ROWS.map(([field, label, tone]) =>
                  item.tiers[field] ? (
                    <div
                      key={field}
                      className="rounded-[var(--radius-lg)] bg-card-alt px-3 py-2.5"
                    >
                      <Badge tone={tone}>{label}</Badge>
                      <div className="mt-1.5 text-[12px] leading-snug text-muted-fg">
                        {item.tiers[field]}
                      </div>
                    </div>
                  ) : null,
                )}
              </div>
            ) : (
              <p className="text-[12.5px] text-muted-fg">
                No ladder authored — it falls back to the goal&apos;s own tiers.
              </p>
            )}
          </div>
        </div>

        {/* Fields that read themselves. An AI picked these queries from an
            allowlist, partly out of a document someone uploaded — so the one
            place a human can catch a query that shouldn't run is right here,
            in a sentence. */}
        {item.autoFields?.length ? (
          <div className="mt-5 border-t border-line pt-4">
            <Label className="mb-2 block">
              {plural(item.autoFields.length, "field", "fields")} read
              automatically
            </Label>
            <ul className="grid gap-1.5">
              {item.autoFields.map((a, i) => (
                <li
                  key={i}
                  className="flex items-baseline gap-2 text-[12.5px] leading-snug"
                >
                  <Badge tone="lav" className="flex-none">
                    auto
                  </Badge>
                  <span className="min-w-0 flex-1">
                    {a.label ? <span className="font-bold text-fg">{a.label}</span> : null}
                    {a.label ? " — " : null}
                    <span className="text-muted-fg">{a.description}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* A plan with per-period content is the thing most worth
            reviewing — approving "13 weeks of distinct deliverables"
            without seeing them is rubber-stamping, so every period shows. */}
        {item.periods?.length ? (
          <div className="mt-5 border-t border-line pt-4">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <Label>
                {item.periods.length} {item.cadence || ""} period
                {item.periods.length === 1 ? "" : "s"}, each with its own ask
              </Label>
              <span className="text-[11.5px] text-muted-fg">all shown</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-6">
              {item.periods.map((p, i) => (
                <div
                  key={i}
                  className="rounded-[var(--radius-lg)] bg-card-alt px-2.5 py-2"
                >
                  <div className="text-[11px] font-bold text-fg">
                    {String(i + 1).padStart(2, "0")}
                    {p.dueAt ? (
                      <span className="ml-1.5 font-semibold text-dim-fg">
                        {p.dueAt}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 text-[11.5px] leading-snug text-muted-fg">
                    {p.label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
