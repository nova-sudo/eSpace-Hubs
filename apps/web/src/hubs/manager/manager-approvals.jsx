"use client";

/**
 * Manager Hub — Build-Your-Own approvals. Renders at /[hub]/approvals.
 *
 * COMPOSED trackers a report composed themselves, held pending until you
 * approve. Each shows the proposed fields + achievement tiers; Approve
 * activates it (goes live for the report), Request changes sends it back
 * with a note. Either way the report is notified.
 *
 * Data: GET /manager/approvals; POST /manager/reports/:id/goals/:id/approval.
 */

import { useState } from "react";
import { toast } from "sonner";
import { MonoLabel, PageHeader } from "@/components/ui";
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
    <main className="relative z-[2] mx-auto max-w-4xl px-10 pb-16 pt-9">
      <PageHeader
        crumb="Build-Your-Own goals · pending your approval"
        title="Custom trackers, on hold."
        italicWord="hold"
        subtitle="When a report composes their own tracker, it stays inactive until you approve the fields and tiers. Nothing goes live behind your back."
      />

      <div className="mt-2">
        <MonoLabel>{loading ? "Loading…" : `${items.length} pending`}</MonoLabel>

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
                  className="rounded-md border border-border bg-card p-5"
                >
                  <div
                    className="flex items-center gap-2 text-muted-fg"
                    style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.03em" }}
                  >
                    <span
                      className="grid h-5 w-5 flex-none place-items-center rounded-full bg-panel-2"
                      style={{ fontSize: 9, fontWeight: 700 }}
                    >
                      {initials(item.user.displayName)}
                    </span>
                    {[item.user.displayName, item.user.role, item.user.department]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                  <h3 className="mt-2 text-[16px] font-semibold">
                    {item.goal.title}
                  </h3>

                  {/* composed spec preview */}
                  <div className="mt-3 overflow-hidden rounded-md border border-dashed border-border-strong">
                    <div className="flex items-center gap-2 border-b border-dashed border-border bg-card-alt px-3 py-2">
                      <span
                        className="uppercase text-accent"
                        style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, letterSpacing: "0.08em", fontWeight: 700 }}
                      >
                        Build-Your-Own tracker
                      </span>
                      {item.cadence ? (
                        <span
                          className="ml-auto text-muted-fg"
                          style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
                        >
                          cadence · {item.cadence}
                        </span>
                      ) : null}
                    </div>
                    {item.fields.length ? (
                      <div className="flex flex-wrap gap-2 p-3">
                        {item.fields.map((f, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-[12.5px]"
                          >
                            {f.kind ? (
                              <span
                                className="rounded px-1.5 py-0.5 text-accent"
                                style={{
                                  fontFamily: "var(--font-mono)",
                                  fontSize: 9,
                                  letterSpacing: "0.06em",
                                  textTransform: "uppercase",
                                  fontWeight: 700,
                                  background: "var(--accent-dim)",
                                }}
                              >
                                {f.kind}
                              </span>
                            ) : null}
                            {f.label || "—"}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {item.tiers ? (
                      <div
                        className="grid gap-px border-t border-dashed border-border"
                        style={{ gridTemplateColumns: "repeat(2, 1fr)", background: "var(--border)" }}
                      >
                        {TIER_ROWS.map(([field, label]) =>
                          item.tiers[field] ? (
                            <div key={field} className="bg-card px-3 py-2">
                              <div
                                className="uppercase text-dim-fg"
                                style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.06em" }}
                              >
                                {label}
                              </div>
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
                        className="w-full rounded-md border border-border bg-card-alt px-3 py-2.5 text-[13px] leading-relaxed"
                        style={{ minHeight: 72, resize: "vertical", fontFamily: "var(--font-sans)" }}
                      />
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => decide(item, "request_changes", note)}
                          className="rounded-md px-3.5 py-2 text-[13px] font-semibold text-accent-on disabled:opacity-60"
                          style={{ background: "var(--accent)" }}
                        >
                          {isBusy ? "Sending…" : "Send back"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setChangesFor(null);
                            setNote("");
                          }}
                          className="rounded-md border px-3.5 py-2 text-[13px] font-semibold"
                          style={{ borderColor: "var(--border-strong)" }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 flex gap-2.5">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => decide(item, "approve")}
                        className="inline-flex items-center gap-2 rounded-md px-3.5 py-2 text-[13px] font-semibold text-accent-on disabled:opacity-60"
                        style={{ background: "var(--accent)" }}
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                        {isBusy ? "Approving…" : "Approve & activate"}
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => {
                          setChangesFor(key);
                          setNote("");
                        }}
                        className="rounded-md border px-3.5 py-2 text-[13px] font-semibold"
                        style={{ borderColor: "var(--border-strong)" }}
                      >
                        Request changes
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </main>
  );
}

function EmptyCard({ children }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-card p-6 text-[13px] leading-[1.6] text-muted-fg">
      {children}
    </div>
  );
}
