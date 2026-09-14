"use client";

/**
 * Goals flow map — full page (Phases 2–8 of the design handoff).
 *
 * L1 goal cards on the left, L2 rows branching right via orthogonal SVG
 * connectors. One row expands in place; expanding mounts the SAME
 * `<GoalWidget>` + `<GoalTierLadder>` the rest of the app uses for a
 * classified goal (see flow-row.jsx's header comment for why that means
 * Phases 3–6 of the design are almost entirely reuse, not new UI).
 *
 * Data: the same `useGoalWidgetItems` hook the current Goals page uses —
 * this is a new presentation layer over existing, already-correct data.
 *
 * Accessibility: the canvas is `role="tree"`, each L1 is `role="group"`,
 * each row is `role="treeitem"` with a roving tabindex (only the focused
 * row's header button is in the tab order; arrow keys move focus, → / ←
 * expand/collapse, Enter/Space toggles). A polite live region announces
 * expand/collapse and filter changes.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, Minus, Plus, Sparkles } from "lucide-react";
import { Badge, Button, Card, Label, SegmentedControl } from "@/components/ui";
import { useHubLink } from "@/features/hubs";
import { useGoalWidgetItems } from "@/features/goal-widgets";
import { useAllGoalInputs } from "@/features/goal-inputs";
import { useGoalLocks } from "@/features/goal-locks";
import { useAnalystOptional, ANALYST_MODES } from "@/features/analyst";
import { cn } from "@/lib/cn";
import { layoutFlow } from "./flow-geometry";
import { FlowRow } from "./flow-row";
import { EvidenceDrawer } from "./evidence-drawer";
import { isGoalOwed, cadenceWindowsFor } from "./flow-row-meta";

const DENSITY_OPTIONS = [
  { value: "comfortable", label: "Comfortable" },
  { value: "dense", label: "Compact" },
];

function usePaneWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

export function GoalsFlowPage() {
  const { groupedItems, unclassifiedGoals, hasGoals, ready, goalsError, retryGoals } =
    useGoalWidgetItems();
  const [paneRef, paneWidth] = usePaneWidth();
  const [openId, setOpenId] = useState(null);
  const [owedOnly, setOwedOnly] = useState(false);
  const [density, setDensity] = useState("comfortable");
  const [collapsedL1Ids, setCollapsedL1Ids] = useState(() => new Set());
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [focusedId, setFocusedId] = useState(null);
  const [announcement, setAnnouncement] = useState("");
  const rowRefs = useRef(new Map());
  const analyst = useAnalystOptional();

  // Re-render when entries/locks change so "owed" (derived from cadence
  // windows) and the mini steppers inside expanded rows stay live.
  useAllGoalInputs();
  useGoalLocks();

  // Merge in unclassified ("ghost") L2s next to their classified siblings —
  // `useGoalWidgetItems().groupedItems` only includes goals that already
  // have a spec, so an L1 whose goals are ALL unclassified would otherwise
  // never appear on the map at all. `spec: null` on the merged item is what
  // FlowRow reads to render the dashed ghost row.
  const mergedGroups = useMemo(() => {
    const byL1 = new Map(groupedItems.map((g) => [g.l1.id, { l1: g.l1, items: [...g.items] }]));
    for (const g of unclassifiedGoals) {
      const l1Id = g.parentL1Id;
      if (!l1Id) continue;
      if (!byL1.has(l1Id)) {
        byL1.set(l1Id, {
          l1: { id: l1Id, title: g.parentL1Title, category: null, weightage: null },
          items: [],
        });
      }
      byL1.get(l1Id).items.push({ goal: { ...g, kind: "L2" }, spec: null });
    }
    return [...byL1.values()];
  }, [groupedItems, unclassifiedGoals]);

  const allL1Ids = useMemo(() => mergedGroups.map((g) => g.l1.id), [mergedGroups]);
  const allCollapsed = allL1Ids.length > 0 && allL1Ids.every((id) => collapsedL1Ids.has(id));

  const owedCount = useMemo(() => {
    let n = 0;
    for (const g of mergedGroups) {
      for (const it of g.items) {
        if (it.goal?.kind === "L2" && isGoalOwed(it.goal.id, it.spec)) n++;
      }
    }
    return n;
  }, [mergedGroups]);

  // Per-L1 progress: aggregate filled/total windows across every L2's own
  // cadence, plus goal-level counts (on pace / owed / unclassified) for the
  // card's badge row.
  const l1Progress = useMemo(() => {
    const map = new Map();
    for (const g of mergedGroups) {
      let filled = 0;
      let total = 0;
      let owedGoals = 0;
      let onPaceGoals = 0;
      let unclassifiedGoalsCount = 0;
      for (const it of g.items) {
        if (it.goal?.kind !== "L2") continue;
        if (!it.spec) {
          unclassifiedGoalsCount += 1;
          continue;
        }
        const cyc = cadenceWindowsFor(it.goal.id, it.spec);
        if (!cyc) {
          onPaceGoals += 1;
          continue;
        }
        filled += cyc.filledCount;
        total += cyc.total;
        const owed = (cyc.windows || []).some((w) => w.state === "owed");
        if (owed) owedGoals += 1;
        else onPaceGoals += 1;
      }
      map.set(g.l1.id, { filled, total, owedGoals, onPaceGoals, unclassifiedGoalsCount });
    }
    return map;
  }, [mergedGroups]);

  // "Owed only" HIDES (not dims) and drops groups that empty out — a dim
  // filter isn't a filter once a tree has 30+ goals (design call, PASS2 §Scale).
  // Ghost rows have no cadence, so they're never "owed" — filtered out too.
  const filteredGroups = useMemo(() => {
    if (!owedOnly) return mergedGroups;
    return mergedGroups.map((g) => ({
      l1: g.l1,
      items: g.items.filter((it) => it.goal?.kind !== "L2" || isGoalOwed(it.goal.id, it.spec)),
    }));
  }, [mergedGroups, owedOnly]);

  const layout = layoutFlow(filteredGroups, paneWidth, { openId, density, collapsedL1Ids });
  const rowIds = layout.rows.map((r) => r.id);

  function toggleRow(goalId) {
    setOpenId((prev) => {
      const next = prev === goalId ? null : goalId;
      setAnnouncement(next ? "Expanded row" : "Collapsed row");
      return next;
    });
    setFocusedId(goalId);
  }

  function toggleL1(l1Id) {
    setCollapsedL1Ids((prev) => {
      const next = new Set(prev);
      if (next.has(l1Id)) next.delete(l1Id);
      else next.add(l1Id);
      return next;
    });
  }

  function toggleAllGroups() {
    setCollapsedL1Ids(allCollapsed ? new Set() : new Set(allL1Ids));
    setAnnouncement(allCollapsed ? "Expanded all groups" : "Collapsed all groups");
  }

  function focusRow(id) {
    if (!id) return;
    setFocusedId(id);
    requestAnimationFrame(() => rowRefs.current.get(id)?.focus());
  }

  function handleTreeKeyDown(e) {
    if (rowIds.length === 0) return;
    const idx = Math.max(0, rowIds.indexOf(focusedId));
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusRow(rowIds[Math.min(rowIds.length - 1, idx + 1)]);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusRow(rowIds[Math.max(0, idx - 1)]);
    } else if (e.key === "Home") {
      e.preventDefault();
      focusRow(rowIds[0]);
    } else if (e.key === "End") {
      e.preventDefault();
      focusRow(rowIds[rowIds.length - 1]);
    } else if (e.key === "ArrowRight") {
      if (focusedId && openId !== focusedId) {
        e.preventDefault();
        toggleRow(focusedId);
      }
    } else if (e.key === "ArrowLeft") {
      if (focusedId && openId === focusedId) {
        e.preventDefault();
        toggleRow(focusedId);
      }
    }
  }

  const ghostCount = unclassifiedGoals.length;

  return (
    <div
      className="relative z-[2] flex flex-col overflow-hidden bg-bg"
      style={{ height: "calc(100vh - var(--header-height))" }}
    >
      <span aria-live="polite" className="sr-only">
        {announcement}
      </span>

      <div className="flex shrink-0 flex-wrap items-end justify-between gap-4 px-5 py-4 sm:px-8">
        <div>
          <Label>
            {layout.l1Cards.length} objective{layout.l1Cards.length === 1 ? "" : "s"} · {rowIds.length} goal
            {rowIds.length === 1 ? "" : "s"} tracked
            {ghostCount > 0 ? ` · ${ghostCount} unclassified` : ""}
          </Label>
          <h1 className="mt-1.5 text-[28px] font-extrabold leading-[1.1] tracking-[-0.02em] text-fg">Goals</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {ghostCount > 0 ? (
            <Button
              variant="tint"
              tone="lav"
              size="md"
              onClick={() => analyst?.requestOpen?.(ANALYST_MODES.ANALYSIS)}
            >
              <Sparkles size={14} />
              Analyze {ghostCount} unclassified
            </Button>
          ) : null}
          <Button variant={owedOnly ? "ink" : "soft"} size="md" onClick={() => setOwedOnly((v) => !v)}>
            Owed only
            <Badge tone="peach">{owedCount}</Badge>
          </Button>
          <SegmentedControl options={DENSITY_OPTIONS} value={density} onChange={setDensity} size="sm" />
          <Button variant="soft" size="md" onClick={toggleAllGroups}>
            {allCollapsed ? "Expand all" : "Collapse all"}
          </Button>
          <div className="flex items-center gap-0.5 rounded-[var(--radius-pill)] bg-card-alt p-1">
            <ZoomButton onClick={() => setZoom((z) => Math.max(0.6, Math.round((z - 0.1) * 10) / 10))} aria-label="Zoom out">
              <Minus size={13} />
            </ZoomButton>
            <span className="w-10 text-center text-[12px] font-semibold tabular-nums text-muted-fg">
              {Math.round(zoom * 100)}%
            </span>
            <ZoomButton onClick={() => setZoom((z) => Math.min(1.4, Math.round((z + 0.1) * 10) / 10))} aria-label="Zoom in">
              <Plus size={13} />
            </ZoomButton>
          </div>
          <Button
            variant={evidenceOpen ? "ink" : "soft"}
            size="md"
            onClick={() => setEvidenceOpen((v) => !v)}
            aria-expanded={evidenceOpen}
          >
            Evidence
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 items-stretch">
        <div
          ref={paneRef}
          className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-5"
          onKeyDown={handleTreeKeyDown}
        >
          {goalsError && !ready ? (
            <Card padding={24} className="flex flex-col items-start gap-3">
              <span className="text-[13px] text-fg">
                Couldn&apos;t load goals — {goalsError.message || "the server didn't respond"}.
              </span>
              <Button variant="soft" size="sm" onClick={() => void retryGoals()}>
                Retry
              </Button>
            </Card>
          ) : !ready ? (
            <div className="p-6 text-[13px] text-muted-fg">Loading goals&hellip;</div>
          ) : !hasGoals || layout.rows.length === 0 ? (
            <Card padding={24} className="text-center text-[13px] text-muted-fg">
              {owedOnly ? "Nothing owed right now." : "No classified goals to map yet."}
            </Card>
          ) : (
            <div
              className="relative mx-auto"
              style={{ width: layout.canvas * zoom, height: layout.height * zoom }}
            >
              <div
                role="tree"
                aria-label="Goals by L1 objective"
                className="absolute left-0 top-0"
                style={{
                  width: layout.canvas,
                  height: layout.height,
                  transform: `scale(${zoom})`,
                  transformOrigin: "0 0",
                }}
              >
                <svg
                  width={layout.canvas}
                  height={layout.height}
                  aria-hidden="true"
                  focusable="false"
                  style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}
                >
                  {layout.edges.map((e) => (
                    <path key={e.id} d={e.d} fill="none" stroke="var(--line)" strokeWidth="2" />
                  ))}
                </svg>

                {layout.l1Cards.map((c) => (
                  <L1Card
                    key={c.id}
                    card={c}
                    progress={l1Progress.get(c.id)}
                    onToggleCollapse={() => toggleL1(c.id)}
                  />
                ))}

                {layout.pills.map((p) => (
                  <div
                    key={p.id}
                    aria-hidden="true"
                    className="absolute whitespace-nowrap"
                    style={{ left: p.x, top: p.y, transform: "translate(-50%, -50%)" }}
                  >
                    <Label className="rounded-[var(--radius-pill)] bg-bg px-1.5 py-0.5">
                      {p.label ? p.label.toLowerCase().replace(/_/g, " ") : ""}
                    </Label>
                  </div>
                ))}

                {layout.rows.map((r) => (
                  <FlowRow
                    key={r.id}
                    item={{ goal: r.goal, spec: r.spec }}
                    open={r.open}
                    onToggle={toggleRow}
                    focused={focusedId ? focusedId === r.id : r.id === rowIds[0]}
                    rowRef={(el) => {
                      if (el) rowRefs.current.set(r.id, el);
                      else rowRefs.current.delete(r.id);
                    }}
                    style={{
                      left: r.left,
                      top: r.top,
                      width: r.width,
                      ...(r.open ? { maxHeight: r.height, overflowY: "auto" } : {}),
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {evidenceOpen ? <EvidenceDrawer onClose={() => setEvidenceOpen(false)} /> : null}
      </div>
    </div>
  );
}

function ZoomButton({ onClick, children, ...rest }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-6 w-6 items-center justify-center rounded-full text-muted-fg transition-colors hover:bg-card"
      {...rest}
    >
      {children}
    </button>
  );
}

function L1Card({ card, progress, onToggleCollapse }) {
  // Real destination for "edit" — the goals editor owns L1 editing.
  const link = useHubLink();
  const total = progress?.total || 0;
  const filled = progress?.filled || 0;
  const onPaceGoals = progress?.onPaceGoals || 0;
  const owedGoals = progress?.owedGoals || 0;
  const unclassifiedGoalsCount = progress?.unclassifiedGoalsCount || 0;
  const pct = total > 0 ? Math.round((filled / total) * 100) : null;

  return (
    <div
      role="group"
      aria-label={`${card.title} — ${card.count} goals`}
      className="absolute flex flex-col gap-3.5 rounded-[var(--radius-xl)] bg-card p-[22px]"
      style={{ left: card.left, top: card.top, width: card.width, boxShadow: "var(--shadow-card)" }}
    >
      <button
        type="button"
        onClick={onToggleCollapse}
        aria-expanded={!card.collapsed}
        className="flex items-center justify-between gap-1.5 border-0 bg-transparent p-0 text-left"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <ChevronDown size={13} className={cn("shrink-0 text-dim-fg transition-transform", card.collapsed ? "-rotate-90" : "")} />
          <Label className="truncate">Objective {String(card.num).slice(0, 8)}</Label>
        </span>
        {card.weightage != null ? <Badge tone="lav">{card.weightage}% weight</Badge> : null}
      </button>

      <div
        className="text-[18px] font-bold leading-[1.25] tracking-[-0.02em] text-fg"
        style={{
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
        title={card.title}
      >
        {card.title || "(untitled)"}
      </div>

      {total > 0 ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-[12.5px] font-semibold text-muted-fg">
            <span>Windows filled</span>
            <span className="tabular-nums text-fg">
              {filled} / {total}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-[var(--radius-pill)] bg-card-alt">
            <div className="h-full rounded-[var(--radius-pill)] bg-ink" style={{ width: `${pct}%` }} />
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5">
        {onPaceGoals > 0 ? <Badge tone="mint">{onPaceGoals} on pace</Badge> : null}
        {owedGoals > 0 ? <Badge tone="peach">{owedGoals} owed</Badge> : null}
        {unclassifiedGoalsCount > 0 ? <Badge tone="lemon">{unclassifiedGoalsCount} unclassified</Badge> : null}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-line pt-2.5 text-[12px] text-muted-fg">
        <span>{card.collapsed ? `${card.count} goal${card.count === 1 ? "" : "s"} · collapsed` : `${card.count} goal${card.count === 1 ? "" : "s"}`}</span>
        <Link href={link("/goals")} className={cn("shrink-0 font-bold text-fg")}>
          Edit
        </Link>
      </div>
    </div>
  );
}
