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
import { useGoalWidgetItems } from "@/features/goal-widgets";
import { useAllGoalInputs } from "@/features/goal-inputs";
import { useGoalLocks } from "@/features/goal-locks";
import { useAnalystOptional, ANALYST_MODES } from "@/features/analyst";
import { layoutFlow } from "./flow-geometry";
import { FlowRow } from "./flow-row";
import { EvidenceDrawer } from "./evidence-drawer";
import { isGoalOwed } from "./flow-row-meta";

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

function TitleBarButton({ onClick, active, children, ...rest }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="whitespace-nowrap rounded-[var(--radius-sub)] border px-2.5 py-1.5"
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.6px",
        cursor: "pointer",
        borderColor: active ? "var(--accent)" : "var(--border)",
        background: active ? "var(--accent)" : "transparent",
        color: active ? "var(--accent-on)" : "var(--muted-fg)",
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

export function GoalsFlowPage() {
  const { groupedItems, unclassifiedGoals, hasGoals, ready } = useGoalWidgetItems();
  const [paneRef, paneWidth] = usePaneWidth();
  const [openId, setOpenId] = useState(null);
  const [owedOnly, setOwedOnly] = useState(false);
  const [density, setDensity] = useState("comfortable");
  const [collapsedL1Ids, setCollapsedL1Ids] = useState(() => new Set());
  const [evidenceOpen, setEvidenceOpen] = useState(false);
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
    <div className="relative z-[2] flex h-[calc(100vh-var(--header-height,61px))] flex-col px-6 pb-6 pt-6">
      <span aria-live="polite" className="sr-only">
        {announcement}
      </span>

      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3 border-b border-border pb-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[19px] font-semibold" style={{ letterSpacing: "-0.4px" }}>
            Goals
          </h1>
          <span
            className="text-muted-fg"
            style={{ fontFamily: "var(--font-mono)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.6px" }}
          >
            flow map &middot; {layout.l1Cards.length} L1 &middot; {rowIds.length} tracked
            {ghostCount > 0 ? ` · ${ghostCount} unclassified` : ""}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {ghostCount > 0 ? (
            <TitleBarButton onClick={() => analyst?.requestOpen?.(ANALYST_MODES.ANALYSIS)} active>
              Analyze {ghostCount} unclassified
            </TitleBarButton>
          ) : null}
          <TitleBarButton onClick={() => setOwedOnly((v) => !v)} active={owedOnly}>
            Owed only &middot; {owedCount}
          </TitleBarButton>
          <TitleBarButton onClick={() => setDensity((d) => (d === "dense" ? "comfortable" : "dense"))}>
            {density === "dense" ? "Comfortable" : "Dense"}
          </TitleBarButton>
          <TitleBarButton onClick={toggleAllGroups}>
            {allCollapsed ? "Expand all" : "Collapse all"}
          </TitleBarButton>
          <TitleBarButton onClick={() => setEvidenceOpen((v) => !v)} active={evidenceOpen} aria-expanded={evidenceOpen}>
            Evidence
          </TitleBarButton>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 items-stretch gap-0">
        <div
          ref={paneRef}
          className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
          onKeyDown={handleTreeKeyDown}
        >
          {!ready ? (
            <div className="p-6 text-[13px] text-muted-fg">Loading goals&hellip;</div>
          ) : !hasGoals || layout.rows.length === 0 ? (
            <div className="rounded-[var(--radius-tile)] border border-dashed border-border-strong bg-card-alt p-6 text-center text-[13px] text-muted-fg">
              {owedOnly ? "Nothing owed right now." : "No classified goals to map yet."}
            </div>
          ) : (
            <div
              role="tree"
              aria-label="Goals by L1 objective"
              className="relative mx-auto"
              style={{ width: layout.canvas, height: layout.height }}
            >
              <svg
                width={layout.canvas}
                height={layout.height}
                aria-hidden="true"
                focusable="false"
                style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}
              >
                {layout.edges.map((e) => (
                  <path
                    key={e.id}
                    d={e.d}
                    fill="none"
                    stroke={e.open ? "var(--border-strong)" : "var(--border)"}
                    strokeWidth="1"
                  />
                ))}
              </svg>

              {layout.l1Cards.map((c) => (
                <L1Card key={c.id} card={c} onToggleCollapse={() => toggleL1(c.id)} />
              ))}

              {layout.pills.map((p) => (
                <div
                  key={p.id}
                  aria-hidden="true"
                  className="absolute whitespace-nowrap bg-bg px-1.5 py-0.5"
                  style={{ left: p.x, top: p.y, transform: "translate(-50%, -50%)" }}
                >
                  <span
                    className="text-muted-fg"
                    style={{ fontFamily: "var(--font-mono)", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.5px" }}
                  >
                    {p.label}
                  </span>
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
          )}
        </div>

        {evidenceOpen ? <EvidenceDrawer onClose={() => setEvidenceOpen(false)} /> : null}
      </div>
    </div>
  );
}

function L1Card({ card, onToggleCollapse }) {
  return (
    <div
      role="group"
      aria-label={`${card.title} — ${card.count} goals`}
      className="absolute rounded-[var(--radius-tile)] border border-border bg-card p-3"
      style={{ left: card.left, top: card.top, width: card.width }}
    >
      <button
        type="button"
        onClick={onToggleCollapse}
        aria-expanded={!card.collapsed}
        className="mb-1.5 flex w-full items-center gap-1.5 border-0 bg-transparent p-0 text-left"
        style={{ cursor: "pointer", color: "inherit" }}
      >
        <span
          aria-hidden="true"
          className="text-muted-fg"
          style={{ fontFamily: "var(--font-mono)", fontSize: 11, width: 8 }}
        >
          {card.collapsed ? "▸" : "▾"}
        </span>
        <span
          className="min-w-0 flex-1 truncate text-muted-fg"
          style={{ fontFamily: "var(--font-mono)", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.5px" }}
        >
          L1 {card.category ? `· ${card.category}` : ""}
        </span>
      </button>
      <div className="mb-2 text-[13px] font-semibold leading-[1.3]" style={{ letterSpacing: "-0.1px" }}>
        {card.title || "(untitled)"}
      </div>
      <div className="flex items-center justify-between gap-2 text-muted-fg" style={{ fontFamily: "var(--font-mono)", fontSize: 9 }}>
        <span>
          {card.count} goal{card.count === 1 ? "" : "s"}
          {card.weightage != null ? ` · ${card.weightage}% weight` : ""}
        </span>
      </div>
    </div>
  );
}
