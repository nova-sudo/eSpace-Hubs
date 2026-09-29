"use client";

/**
 * Past cycles — read-only viewer over the archived goal trees
 * (goal_cycles). A replace import freezes the outgoing tree here
 * automatically, so January's new-cycle import stops destroying last
 * year's id→title mapping (F2 v1, audit critical #218). Expanding an
 * archive lazily fetches its full tree.
 */

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge, Button, Card, Label } from "@/components/ui";
import { apiGet } from "@/lib/api-client";

function fmtWhen(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Duplicated from goal-tiers rather than imported: goals is a product
 *  surface, the labels are four fixed strings, and this viewer renders
 *  FROZEN history — a future rename upstream must not rewrite it. */
const TIER_LABELS = {
  not_achieved: "Not achieved",
  achieved: "Achieved",
  over_achieved: "Over achieved",
  role_model: "Role model",
};

function TierChip({ row }) {
  if (!row?.tier) return null;
  const good = row.tier === "over_achieved" || row.tier === "role_model";
  const bad = row.tier === "not_achieved";
  const tone = bad ? "peach" : good ? "mint" : "neutral";
  return (
    <Badge
      tone={tone}
      className="ml-1.5"
      title={
        `${TIER_LABELS[row.tier] || row.tier} — ${row.source === "manager" ? "manager verdict" : "AI grade"} at archive time` +
        (row.note ? `: ${row.note}` : "")
      }
    >
      {TIER_LABELS[row.tier] || row.tier}
      {row.source === "manager" ? " · M" : ""}
    </Badge>
  );
}

export function PastCycles() {
  const [cycles, setCycles] = useState(null); // null = loading
  const [listError, setListError] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [trees, setTrees] = useState({}); // id -> {l1s} | "loading" | "error"
  const [reports, setReports] = useState({}); // id -> {goalId: row} | null

  // A failed list used to be treated as "nothing archived" and the section
  // vanished — indistinguishable from an empty history. Keep the error.
  const loadList = useCallback(async () => {
    setListError(null);
    const r = await apiGet("/goals/cycles");
    if (r.ok) {
      setCycles(Array.isArray(r.data?.cycles) ? r.data.cycles : []);
    } else {
      setCycles([]);
      setListError(r.error?.message || "the server didn't respond");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const r = await apiGet("/goals/cycles");
      if (cancelled) return;
      if (r.ok) {
        setCycles(Array.isArray(r.data?.cycles) ? r.data.cycles : []);
      } else {
        setCycles([]);
        setListError(r.error?.message || "the server didn't respond");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function loadTree(id) {
    setTrees((t) => ({ ...t, [id]: "loading" }));
    const r = await apiGet(`/goals/cycles/${encodeURIComponent(id)}`);
    setTrees((t) => ({
      ...t,
      [id]: r.ok && r.data?.tree ? r.data.tree : "error",
    }));
    setReports((p) => ({ ...p, [id]: r.ok ? r.data?.report || null : null }));
  }

  async function toggleOpen(id) {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    if (trees[id] && trees[id] !== "error") return;
    await loadTree(id);
  }

  // Still loading → nothing yet. Empty AND no error → the section doesn't
  // exist until there's history. An error keeps the section so it can say so.
  if (!cycles) return null;
  if (cycles.length === 0 && !listError) return null;

  return (
    <section className="mt-8">
      <Label>Past cycles</Label>
      <p className="mt-1 text-[12.5px] leading-[1.5] text-muted-fg">
        Trees archived by replace imports — read-only, so last cycle&apos;s
        goals stay inspectable after a new import.
      </p>
      {listError ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-[var(--radius-lg)] bg-peach px-3 py-2 text-[12.5px] text-peach-ink">
          <span>Couldn&apos;t load past cycles — {listError}.</span>
          <Button size="sm" variant="soft" onClick={() => void loadList()}>
            Retry
          </Button>
        </div>
      ) : null}
      <ul className="mt-3 flex flex-col gap-2">
        {cycles.map((c) => {
          const open = openId === c.id;
          const tree = trees[c.id];
          const report = reports[c.id] || {};
          return (
            <li key={c.id}>
            <Card radius="lg" padding={0} className="overflow-hidden">
              <button
                type="button"
                onClick={() => void toggleOpen(c.id)}
                aria-expanded={open}
                className="flex w-full items-center gap-3 px-3.5 py-3 text-left"
              >
                {open ? (
                  <ChevronDown size={14} className="shrink-0 text-muted-fg" />
                ) : (
                  <ChevronRight size={14} className="shrink-0 text-muted-fg" />
                )}
                <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-fg">
                  {c.label}
                </span>
                <Badge tone="neutral">
                  {c.l1Count} L1 · {c.l2Count} L2
                </Badge>
                <span className="shrink-0 text-[11.5px] text-muted-fg">
                  {fmtWhen(c.archivedAt)}
                </span>
              </button>
              {open ? (
                <div className="border-t border-line px-4 py-3">
                  {tree === "loading" || !tree ? (
                    <div className="text-[12px] text-muted-fg">Loading…</div>
                  ) : tree === "error" ? (
                    <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-lg)] bg-peach px-3 py-2 text-[12px] text-peach-ink">
                      <span>Couldn&apos;t load this archive.</span>
                      <Button size="sm" variant="soft" onClick={() => void loadTree(c.id)}>
                        Retry
                      </Button>
                    </div>
                  ) : (
                    <ul className="flex flex-col gap-2.5">
                      {(tree.l1s || []).map((l1) => (
                        <li key={l1.id}>
                          <div className="flex items-baseline gap-2 text-[12.5px] font-medium text-fg">
                            {l1.code ? (
                              <span className="font-mono text-[11px] font-bold text-muted-fg">
                                {l1.code}
                              </span>
                            ) : null}
                            {l1.title || "(untitled L1)"}
                            <TierChip row={report[l1.id]} />
                            {l1.weightage > 0 ? (
                              <span className="text-[11px] text-muted-fg">{l1.weightage}%</span>
                            ) : null}
                          </div>
                          {(l1.l2s || []).length > 0 ? (
                            <ul className="mt-1 flex flex-col gap-0.5 pl-4">
                              {l1.l2s.map((l2) => (
                                <li key={l2.id} className="text-[12px] text-muted-fg">
                                  {l2.code ? (
                                    <span className="mr-1.5 font-mono text-[11px]">{l2.code}</span>
                                  ) : null}
                                  {l2.title || "(untitled L2)"}
                                  <TierChip row={report[l2.id]} />
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
            </Card>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
