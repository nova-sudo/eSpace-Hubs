"use client";

/**
 * Past cycles — read-only viewer over the archived goal trees
 * (goal_cycles). A replace import freezes the outgoing tree here
 * automatically, so January's new-cycle import stops destroying last
 * year's id→title mapping (F2 v1, audit critical #218). Expanding an
 * archive lazily fetches its full tree.
 */

import { useEffect, useState } from "react";
import { MonoLabel, Pill } from "@/components/ui";
import { apiGet } from "@/lib/api-client";

function fmtWhen(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function PastCycles() {
  const [cycles, setCycles] = useState(null); // null = loading
  const [openId, setOpenId] = useState(null);
  const [trees, setTrees] = useState({}); // id -> {l1s} | "loading" | "error"

  useEffect(() => {
    let cancelled = false;
    void apiGet("/goals/cycles").then((r) => {
      if (cancelled) return;
      setCycles(r.ok && Array.isArray(r.data?.cycles) ? r.data.cycles : []);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggleOpen(id) {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    if (trees[id]) return;
    setTrees((t) => ({ ...t, [id]: "loading" }));
    const r = await apiGet(`/goals/cycles/${encodeURIComponent(id)}`);
    setTrees((t) => ({
      ...t,
      [id]: r.ok && r.data?.tree ? r.data.tree : "error",
    }));
  }

  // Nothing archived (or still loading) → render nothing; the section
  // only exists once there's history to show.
  if (!cycles || cycles.length === 0) return null;

  return (
    <section className="mt-8">
      <MonoLabel>Past cycles</MonoLabel>
      <p className="mt-1 text-[12.5px] leading-[1.5] text-muted-fg">
        Trees archived by replace imports — read-only, so last cycle&apos;s
        goals stay inspectable after a new import.
      </p>
      <ul className="mt-3 flex flex-col gap-2">
        {cycles.map((c) => {
          const open = openId === c.id;
          const tree = trees[c.id];
          return (
            <li
              key={c.id}
              className="rounded-[var(--radius-sub)] border border-border bg-card-alt"
            >
              <button
                type="button"
                onClick={() => void toggleOpen(c.id)}
                aria-expanded={open}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
              >
                <span
                  aria-hidden="true"
                  className="text-dim-fg"
                  style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
                >
                  {open ? "▾" : "▸"}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg">
                  {c.label}
                </span>
                <Pill tone="muted" mono>
                  {c.l1Count} L1 · {c.l2Count} L2
                </Pill>
                <span
                  className="shrink-0 text-dim-fg"
                  style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
                >
                  {fmtWhen(c.archivedAt)}
                </span>
              </button>
              {open ? (
                <div className="border-t border-dashed border-border px-4 py-3">
                  {tree === "loading" || !tree ? (
                    <div className="text-[12px] text-muted-fg">Loading…</div>
                  ) : tree === "error" ? (
                    <div className="text-[12px] text-bad">
                      Couldn&apos;t load this archive — try again.
                    </div>
                  ) : (
                    <ul className="flex flex-col gap-2.5">
                      {(tree.l1s || []).map((l1) => (
                        <li key={l1.id}>
                          <div className="flex items-baseline gap-2 text-[12.5px] font-medium text-fg">
                            {l1.code ? (
                              <span
                                className="text-accent"
                                style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700 }}
                              >
                                {l1.code}
                              </span>
                            ) : null}
                            {l1.title || "(untitled L1)"}
                            {l1.weightage > 0 ? (
                              <span className="text-dim-fg" style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}>
                                {l1.weightage}%
                              </span>
                            ) : null}
                          </div>
                          {(l1.l2s || []).length > 0 ? (
                            <ul className="mt-1 flex flex-col gap-0.5 pl-4">
                              {l1.l2s.map((l2) => (
                                <li key={l2.id} className="text-[12px] text-muted-fg">
                                  {l2.code ? (
                                    <span
                                      className="mr-1.5"
                                      style={{ fontFamily: "var(--font-mono)", fontSize: 9.5 }}
                                    >
                                      {l2.code}
                                    </span>
                                  ) : null}
                                  {l2.title || "(untitled L2)"}
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
            </li>
          );
        })}
      </ul>
    </section>
  );
}
