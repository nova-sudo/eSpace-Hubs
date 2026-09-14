"use client";

/**
 * Manager Hub — Build-Your-Own approvals. Renders at /[hub]/approvals.
 *
 * COMPOSED trackers a report composed themselves, held pending until you
 * approve. Each shows the proposed fields + achievement tiers; Approve
 * activates it (goes live for the report), Request changes sends it back
 * with a note. Either way the report is notified.
 *
 * Some fields read themselves from GitHub/GitLab. Those get their own block,
 * one plain-English sentence each ("Checks AGENTS.md exists in espace/hubs
 * (GitHub)"), because approving a query an AI assembled — from text that may
 * have come out of an uploaded document — is the point at which a human is
 * supposed to be able to say no. A template id would make that impossible.
 *
 * Data: GET /manager/approvals; POST /manager/reports/:id/goals/:id/approval.
 */

import { useState } from "react";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { Badge, Button, Label, PageHeader } from "@/components/ui";
import { apiPost } from "@/lib/api-client";
import { useApprovalsQueue } from "./use-approvals-queue";

const TIER_ROWS = [
  ["notAchieved", "Not achieved"],
  ["achieved", "Achieved"],
  ["overAchieved", "Over-achieved"],
  ["roleModel", "Role model"],
];

function initials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

export function ManagerApprovals() {
  const { loading, items, error, refresh } = useApprovalsQueue();
  const [changesFor, setChangesFor] = useState(null); // "userId:goalId"
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(null);

  async function decide(item, decision, noteText) {
    const key = `${item.user.id}:${item.goal.id}`;
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
    <main className="max-w-[1280px] mx-auto px-4 sm:px-10 pb-16 pt-7">
      <PageHeader
        crumb="Build-Your-Own goals · pending your approval"
        title="Custom trackers, on hold."
        subtitle="When a report composes their own tracker, it stays inactive until you approve the fields and tiers. Nothing goes live behind your back."
      />

      <Label>{loading ? "Loading…" : `${items.length} pending`}</Label>

      <div className="mt-3 grid gap-3">
        {error ? (
          <EmptyCard>
            Couldn't load pending approvals right now. Refresh, or check back
            in a moment.
          </EmptyCard>
        ) : loading ? (
          <EmptyCard>Loading…</EmptyCard>
        ) : items.length === 0 ? (
          <EmptyCard>
            Nothing's waiting on you. When a report builds their own tracker,
            it shows up here for approval before it goes live.
          </EmptyCard>
        ) : (
          items.map((item) => {
            const key = `${item.user.id}:${item.goal.id}`;
            const showChanges = changesFor === key;
            const isBusy = busy === key;
            return (
              <div
                key={key}
                className="rounded-[var(--radius-xl)] bg-card p-5"
                style={{ boxShadow: "var(--shadow-card)" }}
              >
                <div className="flex items-center gap-2 text-[11.5px] text-muted-fg">
                  <span className="grid h-5 w-5 flex-none place-items-center rounded-full bg-card-alt text-[11px] font-bold">
                    {initials(item.user.displayName)}
                  </span>
                  {[item.user.displayName, item.user.role, item.user.department]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
                <h3 className="mt-2 text-[16px] font-bold">{item.goal.title}</h3>

                {/* composed spec preview */}
                <div className="mt-3 overflow-hidden rounded-[var(--radius-lg)] bg-card-alt">
                  <div className="flex items-center gap-2 px-3 py-2.5">
                    <Badge tone="lav">Build-Your-Own tracker</Badge>
                    {item.cadence ? (
                      <span className="ml-auto text-[11px] text-muted-fg">
                        cadence · {item.cadence}
                      </span>
                    ) : null}
                  </div>
                  {item.fields.length ? (
                    <div className="flex flex-wrap gap-2 px-3 pb-3">
                      {item.fields.map((f, i) => (
                        <span
                          key={i}
                          className="inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-card px-2.5 py-1.5 text-[12.5px]"
                        >
                          {f.kind ? <Badge tone="lav">{f.kind}</Badge> : null}
                          {f.label || "—"}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {/* Fields that read themselves. An AI picked these queries
                      from an allowlist, partly out of a document someone
                      uploaded — so the one place a human can catch a query
                      that shouldn't run is right here, in a sentence. */}
                  {item.autoFields?.length ? (
                    <div className="border-t border-line px-3 py-2.5">
                      <div className="mb-1.5 text-[11px] text-dim-fg">
                        {item.autoFields.length} field
                        {item.autoFields.length === 1 ? "" : "s"} read automatically
                      </div>
                      <ul className="grid gap-1.5">
                        {item.autoFields.map((a, i) => (
                          <li key={i} className="flex items-baseline gap-2 text-[12px] leading-snug">
                            <Badge tone="lav" className="mt-0.5 flex-none">
                              auto
                            </Badge>
                            <span className="min-w-0 flex-1">
                              {a.label ? <span className="font-bold">{a.label}</span> : null}
                              {a.label ? " — " : null}
                              <span className="text-muted-fg">{a.description}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {/* A plan with per-period content is the thing most worth
                      reviewing — approving "13 weeks of distinct
                      deliverables" without seeing them is rubber-stamping. */}
                  {item.periods?.length ? (
                    <div className="border-t border-line px-3 py-2.5">
                      <div className="mb-1.5 text-[11px] text-dim-fg">
                        {item.periods.length} periods, each with its own ask
                      </div>
                      <ol className="grid gap-1">
                        {item.periods.slice(0, 8).map((p, i) => (
                          <li key={i} className="flex items-baseline gap-2 text-[12px] leading-snug">
                            <span className="flex-none text-[11px] text-dim-fg">
                              {String(i + 1).padStart(2, "0")}
                            </span>
                            <span className="min-w-0 flex-1 text-muted-fg">{p.label}</span>
                            {p.dueAt ? (
                              <span className="flex-none text-[11px] text-dim-fg">{p.dueAt}</span>
                            ) : null}
                          </li>
                        ))}
                      </ol>
                      {item.periods.length > 8 ? (
                        <div className="mt-1.5 text-[11px] text-dim-fg">
                          + {item.periods.length - 8} more
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {item.tiers ? (
                    <div className="grid grid-cols-2 gap-px border-t border-line bg-line">
                      {TIER_ROWS.map(([field, label]) =>
                        item.tiers[field] ? (
                          <div key={field} className="bg-card-alt px-3 py-2">
                            <div className="text-[11px] text-dim-fg">{label}</div>
                            <div className="mt-1 text-[12px] leading-snug text-muted-fg">
                              {item.tiers[field]}
                            </div>
                          </div>
                        ) : null,
                      )}
                    </div>
                  ) : null}
                </div>

                {showChanges ? (
                  <div className="mt-4">
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="What should they change before this goes live?"
                      autoFocus
                      className="w-full rounded-[var(--radius-lg)] bg-card-alt p-3.5 text-[13px] leading-relaxed outline-none focus:ring-2 focus:ring-ink"
                      style={{ minHeight: 72, resize: "vertical" }}
                    />
                    <div className="mt-2 flex gap-2">
                      <Button
                        type="button"
                        variant="ink"
                        size="sm"
                        disabled={isBusy}
                        onClick={() => decide(item, "request_changes", note)}
                      >
                        {isBusy ? "Sending…" : "Send back"}
                      </Button>
                      <Button
                        type="button"
                        variant="soft"
                        size="sm"
                        onClick={() => {
                          setChangesFor(null);
                          setNote("");
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 flex gap-2.5">
                    <Button
                      type="button"
                      variant="ink"
                      size="sm"
                      disabled={isBusy}
                      onClick={() => decide(item, "approve")}
                    >
                      <Check size={14} />
                      {isBusy ? "Approving…" : "Approve & activate"}
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      disabled={isBusy}
                      onClick={() => {
                        setChangesFor(key);
                        setNote("");
                      }}
                    >
                      Request changes
                    </Button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </main>
  );
}

function EmptyCard({ children }) {
  return (
    <div
      className="rounded-[var(--radius-xl)] bg-card p-6 text-[13px] leading-[1.6] text-muted-fg"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      {children}
    </div>
  );
}
