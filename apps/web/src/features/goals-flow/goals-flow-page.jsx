"use client";

/**
 * Goals map — one objective per row: a compact L1 node on the left, a spine,
 * and that objective's goals stacked in the lane beside it. Most objectives
 * carry a single goal, so the row reads as a pair rather than a grid.
 *
 * A goal expands IN PLACE inside its own lane; the rest of the map stays put.
 * The expanded body mounts the same `<GoalWidget>` + `<GoalTierLadder>` the
 * rest of the app uses, so this file owns layout only, never widget content.
 *
 * Layout is plain CSS grid. The previous absolute-positioned canvas (with
 * measured row heights and SVG elbows) collided whenever a card grew past the
 * height the geometry assumed; a grid cannot overlap by construction.
 *
 * Accessibility: the map is `role="tree"`, each objective is `role="group"`,
 * each goal is `role="treeitem"` with a roving tabindex (arrow keys move
 * focus, → / ← expand/collapse, Enter/Space toggles). A polite live region
 * announces expand/collapse and filter changes.
 */

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, Sparkles } from "lucide-react";
import { Badge, Button, Card, Label, SegmentedControl } from "@/components/ui";
import { useHubLink } from "@/features/hubs";
import { useGoalWidgetItems } from "@/features/goal-widgets";
import { useAllGoalInputs } from "@/features/goal-inputs";
import { useGoalLocks } from "@/features/goal-locks";
import { useAnalystOptional, ANALYST_MODES } from "@/features/analyst";
import { cn } from "@/lib/cn";
import { FlowRow } from "./flow-row";
import { EvidenceDrawer } from "./evidence-drawer";
import { isGoalOwed, cadenceWindowsFor } from "./flow-row-meta";

const DENSITY_OPTIONS = [
  { value: "comfortable", label: "Comfortable" },
  { value: "dense", label: "Compact" },
];

export function GoalsFlowPage() {
  const { groupedItems, unclassifiedGoals, hasGoals, ready, goalsError, retryGoals } =
    useGoalWidgetItems();
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
  // windows) and the per-row steppers stay live.
  useAllGoalInputs();
  useGoalLocks();

  // Merge in unclassified ("ghost") L2s next to their classified siblings —
  // `useGoalWidgetItems().groupedItems` only includes goals that already
  // have a spec, so an L1 whose goals are ALL unclassified would otherwise
  // never appear on the map at all. `spec: null` is what FlowRow reads to
  // render the dashed ghost row.
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
  // cadence, plus goal-level counts for the node's status line.
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
  // filter isn't a filter once a tree has 30+ goals. Ghost rows have no
  // cadence, so they're never "owed" and are filtered out too.
  const filteredGroups = useMemo(() => {
    if (!owedOnly) return mergedGroups;
    return mergedGroups
      .map((g) => ({
        l1: g.l1,
        items: g.items.filter((it) => it.goal?.kind !== "L2" || isGoalOwed(it.goal.id, it.spec)),
      }))
      .filter((g) => g.items.length > 0);
  }, [mergedGroups, owedOnly]);

  // Rows currently reachable by keyboard: every L2 in a group that isn't
  // collapsed, in visual order.
  const rowIds = useMemo(() => {
    const ids = [];
    for (const g of filteredGroups) {
      if (collapsedL1Ids.has(g.l1.id)) continue;
      for (const it of g.items) {
        if (it.goal?.kind === "L2") ids.push(it.goal.id);
      }
    }
    return ids;
  }, [filteredGroups, collapsedL1Ids]);

  const totalGoals = useMemo(
    () =>
      mergedGroups.reduce(
        (n, g) => n + g.items.filter((it) => it.goal?.kind === "L2").length,
        0,
      ),
    [mergedGroups],
  );

  function toggleRow(goalId) {
    setOpenId((prev) => {
      const next = prev === goalId ? null : goalId;
      setAnnouncement(next ? "Expanded goal" : "Collapsed goal");
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
    setAnnouncement(allCollapsed ? "Expanded all objectives" : "Collapsed all objectives");
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
  const objectiveCount = mergedGroups.length;

  return (
    <div className="relative z-[2] flex min-h-0 flex-1 flex-col bg-bg">
      <span aria-live="polite" className="sr-only">
        {announcement}
      </span>

      <div className="mx-auto flex w-full max-w-[1560px] flex-wrap items-center justify-between gap-3 px-4 pb-4 pt-5 sm:px-7">
        <div className="flex min-w-0 items-baseline gap-3">
          <h1 className="text-[26px] font-extrabold leading-none tracking-[-0.03em] text-fg">
            Goals
          </h1>
          <Label className="truncate">
            {objectiveCount} objective{objectiveCount === 1 ? "" : "s"} · {totalGoals} goal
            {totalGoals === 1 ? "" : "s"}
            {ghostCount > 0 ? ` · ${ghostCount} unclassified` : ""}
          </Label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {ghostCount > 0 ? (
            <Button
              variant="tint"
              tone="lav"
              size="sm"
              onClick={() => analyst?.requestOpen?.(ANALYST_MODES.ANALYSIS)}
            >
              <Sparkles size={13} />
              Classify {ghostCount}
            </Button>
          ) : null}
          <Button variant={owedOnly ? "ink" : "soft"} size="sm" onClick={() => setOwedOnly((v) => !v)}>
            Owed only
            <Badge tone="peach">{owedCount}</Badge>
          </Button>
          <SegmentedControl options={DENSITY_OPTIONS} value={density} onChange={setDensity} size="sm" />
          <Button variant="soft" size="sm" onClick={toggleAllGroups}>
            {allCollapsed ? "Expand all" : "Collapse all"}
          </Button>
          <Button
            variant={evidenceOpen ? "ink" : "soft"}
            size="sm"
            onClick={() => setEvidenceOpen((v) => !v)}
            aria-expanded={evidenceOpen}
          >
            Evidence
          </Button>
        </div>
      </div>

      <div
        className="mx-auto w-full max-w-[1560px] px-4 pb-16 sm:px-7"
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
        ) : !hasGoals || filteredGroups.length === 0 ? (
          <Card padding={24} className="text-center text-[13px] text-muted-fg">
            {owedOnly ? "Nothing owed right now." : "No goals to map yet."}
          </Card>
        ) : (
          <div role="tree" aria-label="Goals by objective" className="flex flex-col gap-3.5">
            {filteredGroups.map((group, i) => {
              const collapsed = collapsedL1Ids.has(group.l1.id);
              const l2s = group.items.filter((it) => it.goal?.kind === "L2");
              return (
                <div
                  key={group.l1.id}
                  role="group"
                  aria-label={`${group.l1.title || "Untitled objective"} — ${l2s.length} goals`}
                  className="grid grid-cols-1 gap-2.5 md:grid-cols-[196px_32px_minmax(0,1fr)] md:gap-0"
                >
                  <L1Node
                    l1={group.l1}
                    num={String(i + 1).padStart(2, "0")}
                    count={l2s.length}
                    progress={l1Progress.get(group.l1.id)}
                    collapsed={collapsed}
                    onToggleCollapse={() => toggleL1(group.l1.id)}
                  />
                  <Spine hidden={collapsed || l2s.length === 0} />
                  {collapsed ? (
                    <span />
                  ) : (
                    <div className="flex min-w-0 flex-col gap-2.5">
                      {l2s.map((it) => (
                        <FlowRow
                          key={it.goal.id}
                          item={it}
                          density={density}
                          open={openId === it.goal.id}
                          onToggle={toggleRow}
                          focused={focusedId ? focusedId === it.goal.id : it.goal.id === rowIds[0]}
                          rowRef={(el) => {
                            if (el) rowRefs.current.set(it.goal.id, el);
                            else rowRefs.current.delete(it.goal.id);
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {evidenceOpen ? <EvidenceDrawer onClose={() => setEvidenceOpen(false)} /> : null}
    </div>
  );
}

/** The vertical connector between an objective and its goals. Decorative. */
function Spine({ hidden }) {
  if (hidden) return <span aria-hidden="true" />;
  return (
    <div aria-hidden="true" className="relative hidden md:block">
      <span className="absolute bottom-5 left-[15px] top-5 w-[2px] bg-line" />
      <span className="absolute left-[15px] top-[34px] h-[2px] w-[17px] bg-line" />
    </div>
  );
}

/**
 * Compact objective node. Deliberately narrow: an objective usually carries
 * one goal, so the node is a label for the lane beside it, not a panel.
 */
function L1Node({ l1, num, count, progress, collapsed, onToggleCollapse }) {
  const link = useHubLink();
  const total = progress?.total || 0;
  const filled = progress?.filled || 0;
  const onPaceGoals = progress?.onPaceGoals || 0;
  const owedGoals = progress?.owedGoals || 0;
  const unclassifiedCount = progress?.unclassifiedGoalsCount || 0;
  const pct = total > 0 ? Math.round((filled / total) * 100) : 0;

  return (
    <div
      className="flex h-fit flex-col gap-2.5 self-start rounded-[var(--radius-lg)] bg-card px-3.5 py-3"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <button
        type="button"
        onClick={onToggleCollapse}
        aria-expanded={!collapsed}
        className="flex items-center gap-2 border-0 bg-transparent p-0 text-left"
      >
        <Label className="tabular-nums">{num}</Label>
        {l1.weightage != null ? <Badge tone="lav">{l1.weightage}%</Badge> : null}
        <ChevronDown
          size={13}
          className={cn("ml-auto shrink-0 text-dim-fg transition-transform", collapsed ? "-rotate-90" : "")}
        />
      </button>

      <div
        className="text-[13.5px] font-bold leading-[1.35] tracking-[-0.01em] text-fg"
        style={{
          display: "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
        title={l1.title}
      >
        {l1.title || "(untitled)"}
      </div>

      {total > 0 ? (
        <div className="flex items-center gap-2">
          <div className="h-1 flex-1 overflow-hidden rounded-[var(--radius-pill)] bg-card-alt">
            <div className="h-full rounded-[var(--radius-pill)] bg-ink" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-[11px] font-bold tabular-nums text-muted-fg">
            {filled}/{total}
          </span>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] font-semibold text-muted-fg">
        {onPaceGoals > 0 ? <StatusDot color="var(--mint-ink)" label={`${onPaceGoals} on pace`} /> : null}
        {owedGoals > 0 ? <StatusDot color="var(--peach-ink)" label={`${owedGoals} owed`} /> : null}
        {unclassifiedCount > 0 ? (
          <StatusDot color="var(--lemon-ink)" label={`${unclassifiedCount} to classify`} />
        ) : null}
        {collapsed ? <span>{count} hidden</span> : null}
        <Link href={link("/goals")} className="ml-auto shrink-0 font-bold text-fg">
          Edit
        </Link>
      </div>
    </div>
  );
}

function StatusDot({ color, label }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}
