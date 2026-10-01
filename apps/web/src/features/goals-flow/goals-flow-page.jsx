"use client";

/**
 * The Goals page — an overview that never moves, and a detail view you pick.
 *
 * Top: one tile per objective, each carrying a ring whose THICKNESS is that
 * objective's weightage and whose number is its rolled-up progress, plus the
 * status of its weakest child. Above them, the one summary line for the whole
 * cycle: weighted progress as a numeral over a paced bar, and the status
 * counts. Clicking a tile filters everything below it to that objective;
 * clicking it again clears the filter.
 *
 * Below: the same goals in one of three shapes — Focus (a thin rail plus the
 * selected goal in full), Timeline (the year with each goal's cadence windows
 * laid across it) or Board (four status columns). The choice persists per
 * device in localStorage and is broadcast, so a second tab follows along.
 *
 * All three views are projections of ONE derived list (`goal-status.js`), so
 * a goal can't read "behind" in one and "on pace" in another. The page owns
 * filtering, selection, keyboard navigation and announcements; it never owns
 * widget content — the Focus detail mounts the app's own `<GoalWidget>` and
 * `<GoalTierLadder>`.
 *
 * Accessibility: goal rows in every view carry a roving tabindex (arrow keys
 * move focus, Home/End jump, → opens the focused goal, ← collapses its
 * objective, Enter/Space activate natively since every row is a real button),
 * and a polite live region announces selection, filtering and view changes.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Sparkles, X } from "lucide-react";
import { Badge, Button, Card, PageContainer, PageHeader, SegmentedControl } from "@/components/ui";
import { useHubLink } from "@/features/hubs";
import { useGoalWidgetItems } from "@/features/goal-widgets";
import { useAllGoalInputs } from "@/features/goal-inputs";
import { useGoalLocks } from "@/features/goal-locks";
import {
  getGoalTiersSnapshot,
  getGoalTiersServerSnapshot,
  subscribeGoalTiers,
} from "@/features/goal-tiers";
import { useAnalystOptional, ANALYST_MODES } from "@/features/analyst";
import { ASSIGNED_GROUP_LABEL } from "@/features/assigned-goals";
import { ASSIGNED_ROOT_ID } from "@espace-devhub/shared/goal-specs";
import { EvidenceDrawer } from "./evidence-drawer";
import { GoalsSummary, ObjectiveTiles } from "./goals-overview";
import { FocusView } from "./focus-view";
import { TimelineView } from "./timeline-view";
import { BoardView } from "./board-view";
import { goalStatusFor, objectiveRollup, statusCounts, weightedProgress } from "./goal-status";
import { loggedTotals } from "@/features/goal-inputs";
import { useGoalsView } from "./use-goals-view";

const DENSITY_OPTIONS = [
  { value: "comfortable", label: "Comfortable" },
  { value: "dense", label: "Compact" },
];

const VIEW_OPTIONS = [
  { value: "focus", label: "Focus" },
  { value: "timeline", label: "Timeline" },
  { value: "board", label: "Board" },
];

export function GoalsFlowPage() {
  const { groupedItems, unclassifiedGoals, hasGoals, ready, loadError, retryLoad } =
    useGoalWidgetItems();
  const link = useHubLink();
  // `/goals?goal=<id>` deep-links one goal: it opens in the Focus view and
  // scrolls into place once the rows exist. Read once, on mount.
  const searchParams = useSearchParams();
  const deepLinkedId = searchParams?.get("goal") || null;
  // `/goals?from=checkin` — where the retired check-in routes land. Open the
  // first goal that owes a window in Focus so its cadence stepper is on
  // screen, then drop the param so a reload doesn't re-apply it.
  const fromCheckin = searchParams?.get("from") === "checkin";
  const router = useRouter();
  const pathname = usePathname();
  const [view, setView] = useGoalsView();
  const [owedOnly, setOwedOnly] = useState(false);
  const [density, setDensity] = useState("comfortable");
  const [collapsedL1Ids, setCollapsedL1Ids] = useState(() => new Set());
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [objectiveId, setObjectiveId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [focusedId, setFocusedId] = useState(null);
  const [announcement, setAnnouncement] = useState("");
  const rowRefs = useRef(new Map());
  const analyst = useAnalystOptional();

  // Ticks from the stores the derived status reads synchronously — entries,
  // locks and tier verdicts. They're memo deps, not just re-render triggers:
  // without them a logged window re-rendered the page but left every status
  // memo holding its old value.
  const inputsTick = useAllGoalInputs();
  const locksTick = useGoalLocks();
  const tiersTick = useSyncExternalStore(
    subscribeGoalTiers,
    getGoalTiersSnapshot,
    getGoalTiersServerSnapshot,
  );

  // Merge in unclassified ("ghost") L2s next to their classified siblings —
  // `useGoalWidgetItems().groupedItems` only includes goals that already
  // have a spec, so an L1 whose goals are ALL unclassified would otherwise
  // never appear on the page at all. `spec: null` is what the views read to
  // mark a goal as needing classification.
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
      byL1.get(l1Id).items.push({
        goal: { ...g, kind: "L2" },
        spec: null,
        invalidSpec: g.invalidSpec === true,
      });
    }
    return [...byL1.values()];
  }, [groupedItems, unclassifiedGoals]);

  /** One row per objective: its L2s with their derived status, plus the
   *  rollup the tile's ring and badge render. */
  const rows = useMemo(
    () =>
      mergedGroups.map((g) => {
        // Goals a manager assigned you arrive under a synthetic objective
        // the server titles "Shared goals"; on this page they read as
        // "Assigned to you" ("Shared with me" is the viewer page).
        const assignedRoot = g.l1.id === ASSIGNED_ROOT_ID;
        const l2s = g.items
          .filter((it) => it.goal?.kind === "L2")
          .map((it) => ({
            ...it,
            // parentL1Rubric: the ladder falls back to the objective's written
            // rubric when the goal has none (same rule as the manager drawer).
            goal: {
              ...it.goal,
              parentL1Rubric: g.l1?.rubric || null,
              ...(assignedRoot ? { parentL1Title: ASSIGNED_GROUP_LABEL } : {}),
            },
            status: goalStatusFor(it.goal.id, it.spec),
          }));
        const l1 = assignedRoot ? { ...g.l1, title: ASSIGNED_GROUP_LABEL } : g.l1;
        return { l1, l2s, rollup: objectiveRollup(l2s.map((x) => x.status)) };
      }),
    // The status reads live stores; the ticks are what make this honest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mergedGroups, inputsTick, locksTick, tiersTick],
  );

  const allStatuses = useMemo(() => rows.flatMap((r) => r.l2s.map((x) => x.status)), [rows]);
  // The summary is the CYCLE's number, so it is deliberately computed before
  // any filter — "owed only" changes what you're looking at, not where the
  // year stands.
  const counts = useMemo(() => statusCounts(allStatuses), [allStatuses]);
  const weighted = useMemo(
    () => weightedProgress(rows.map((r) => ({ pct: r.rollup.pct, weight: r.l1.weightage }))),
    [rows],
  );
  // "N of M check-ins" under the headline, and the goals that aren't in it.
  const logged = useMemo(() => loggedTotals(allStatuses), [allStatuses]);
  const unmeasured = useMemo(() => allStatuses.filter((s) => s.pct == null).length, [allStatuses]);
  const owedCount = useMemo(() => allStatuses.filter((s) => s.owed).length, [allStatuses]);
  const totalGoals = allStatuses.length;
  const objectiveCount = rows.length;
  const ghostCount = unclassifiedGoals.length;

  // "Owed only" HIDES (not dims) and drops objectives that empty out — a dim
  // filter isn't a filter once a tree has 30+ goals. An unclassified goal has
  // no cadence, so it's never owed and is filtered out too.
  const tileRows = useMemo(() => {
    if (!owedOnly) return rows;
    return rows
      .map((r) => ({ ...r, l2s: r.l2s.filter((x) => x.status.owed) }))
      .filter((r) => r.l2s.length > 0);
  }, [rows, owedOnly]);

  // A tile filter that survives its objective disappearing (owed-only, a
  // re-import) would silently show nothing — resolve it against what's
  // actually on screen instead of keeping it in an effect.
  const activeObjectiveId = tileRows.some((r) => r.l1.id === objectiveId) ? objectiveId : null;

  const activeObjectiveTitle = activeObjectiveId
    ? rows.find((r) => r.l1.id === activeObjectiveId)?.l1.title || "objective"
    : null;

  const viewRows = useMemo(
    () => (activeObjectiveId ? tileRows.filter((r) => r.l1.id === activeObjectiveId) : tileRows),
    [tileRows, activeObjectiveId],
  );

  // Goals reachable right now, in visual order. The board has no objective
  // grouping, so collapsing doesn't hide anything there.
  const visibleGoals = useMemo(
    () =>
      viewRows.flatMap((r) =>
        view !== "board" && collapsedL1Ids.has(r.l1.id) ? [] : r.l2s,
      ),
    [viewRows, collapsedL1Ids, view],
  );
  const rowIds = useMemo(() => visibleGoals.map((x) => x.goal.id), [visibleGoals]);
  const selected =
    visibleGoals.find((x) => x.goal.id === selectedId) || visibleGoals[0] || null;
  const activeRowId = focusedId && rowIds.includes(focusedId) ? focusedId : rowIds[0];

  const allL1Ids = useMemo(() => rows.map((r) => r.l1.id), [rows]);
  const allCollapsed = allL1Ids.length > 0 && allL1Ids.every((id) => collapsedL1Ids.has(id));
  // L1s exist but none of them has an L2 — a different dead end from "no
  // goals at all", and it needs a different sentence.
  const hasL2s = rows.some((r) => r.l2s.length > 0);
  const showControls = ready && hasGoals && rows.length > 0 && hasL2s;

  const registerRow = useCallback((id, el) => {
    if (el) rowRefs.current.set(id, el);
    else rowRefs.current.delete(id);
  }, []);

  // Apply the deep link once the rows are in: select the goal in Focus and
  // scroll its row into view. `rowIds` is the full visible list at mount
  // (no filter is on yet), so a goal that isn't in it simply isn't ours.
  const deepLinkApplied = useRef(false);
  useEffect(() => {
    if (deepLinkApplied.current || !ready) return;
    // No link on arrival: done. Later `?goal=` writes come from our own
    // selection (selectGoal), which must not re-trigger the scroll.
    if (!deepLinkedId) {
      deepLinkApplied.current = true;
      return;
    }
    if (!rowIds.includes(deepLinkedId)) return;
    deepLinkApplied.current = true;
    setSelectedId(deepLinkedId);
    setFocusedId(deepLinkedId);
    setView("focus");
    requestAnimationFrame(() => {
      const el = rowRefs.current.get(deepLinkedId);
      el?.scrollIntoView?.({ block: "center", behavior: "smooth" });
      el?.focus?.({ preventScroll: true });
    });
  }, [deepLinkedId, ready, rowIds, setView]);

  const checkinApplied = useRef(false);
  useEffect(() => {
    if (checkinApplied.current || !fromCheckin || !ready) return;
    checkinApplied.current = true;
    const target = visibleGoals.find((x) => x.status.owed) || visibleGoals[0] || null;
    if (target) {
      const id = target.goal.id;
      setSelectedId(id);
      setFocusedId(id);
      setView("focus");
      requestAnimationFrame(() => {
        rowRefs.current.get(id)?.scrollIntoView?.({ block: "center", behavior: "smooth" });
      });
    }
    const params = new URLSearchParams(searchParams?.toString() || "");
    params.delete("from");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [fromCheckin, ready, visibleGoals, searchParams, pathname, router, setView]);

  function goalTitleOf(id) {
    const hit = visibleGoals.find((x) => x.goal.id === id);
    return hit?.goal?.title || hit?.spec?.title || "goal";
  }

  // The selected goal lives in the URL (`?goal=`), so a reload, a shared
  // link or the back button lands on the same goal.
  function writeGoalParam(goalId) {
    const params = new URLSearchParams(searchParams?.toString() || "");
    if (goalId) params.set("goal", goalId);
    else params.delete("goal");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function selectGoal(goalId) {
    setSelectedId(goalId);
    setFocusedId(goalId);
    writeGoalParam(goalId);
    if (view !== "focus") {
      setView("focus");
      setAnnouncement(`Opened ${goalTitleOf(goalId)} in the focus view`);
      return;
    }
    setAnnouncement(`Selected ${goalTitleOf(goalId)}`);
  }

  function changeView(next) {
    setView(next);
    setAnnouncement(
      `${VIEW_OPTIONS.find((o) => o.value === next)?.label || next} view`,
    );
  }

  /** A goal named on an objective tile: filter to its objective AND open it. */
  function openGoalFromTile(l1Id, goalId) {
    setObjectiveId(l1Id);
    setCollapsedL1Ids((prev) => {
      if (!prev.has(l1Id)) return prev;
      const next = new Set(prev);
      next.delete(l1Id);
      return next;
    });
    selectGoal(goalId);
  }

  function toggleObjective(l1Id) {
    const clearing = activeObjectiveId === l1Id;
    setObjectiveId(clearing ? null : l1Id);
    const title = rows.find((r) => r.l1.id === l1Id)?.l1.title || "objective";
    setAnnouncement(clearing ? "Objective filter cleared" : `Filtered to ${title}`);
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

  function toggleOwedOnly() {
    setOwedOnly((v) => {
      setAnnouncement(v ? "Showing all goals" : `Showing ${owedCount} goals with missed windows`);
      return !v;
    });
  }

  function focusRow(id) {
    if (!id) return;
    setFocusedId(id);
    requestAnimationFrame(() => rowRefs.current.get(id)?.focus());
  }

  function handleTreeKeyDown(e) {
    if (rowIds.length === 0) return;
    // Only a goal row rovers. Without this, an arrow key typed into a
    // widget's own number field (the Focus pane mounts the real widget
    // inside this container) would be swallowed by the list navigation.
    if (!e.target?.dataset || e.target.dataset.goalRow == null) return;
    const idx = Math.max(0, rowIds.indexOf(activeRowId));
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
      if (activeRowId) {
        e.preventDefault();
        selectGoal(activeRowId);
      }
    } else if (e.key === "ArrowLeft") {
      const owner = viewRows.find((r) => r.l2s.some((x) => x.goal.id === activeRowId));
      if (owner && view !== "board" && !collapsedL1Ids.has(owner.l1.id)) {
        e.preventDefault();
        toggleL1(owner.l1.id);
        setAnnouncement(`Collapsed ${owner.l1.title || "objective"}`);
      }
    }
  }

  function openAnalyst() {
    analyst?.requestOpen?.(ANALYST_MODES.ANALYSIS);
  }

  return (
    <PageContainer>
      <span aria-live="polite" className="sr-only">
        {announcement}
      </span>

        <PageHeader
          crumb={
            showControls
              ? `Goals · ${objectiveCount} objective${objectiveCount === 1 ? "" : "s"} · ${totalGoals} goal${
                  totalGoals === 1 ? "" : "s"
                }${ghostCount > 0 ? ` · ${ghostCount} without a tracker` : ""}`
              : "Goals"
          }
          title="Every goal, in one place."
          right={
            // An empty page has nothing to filter, collapse or classify —
            // the controls only appear once there are goals to act on.
            showControls ? (
              <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                {ghostCount > 0 ? (
                  <Button variant="tint" tone="lav" size="sm" onClick={openAnalyst}>
                    <Sparkles size={13} />
                    Classify {ghostCount}
                  </Button>
                ) : null}
                <Button
                  variant={owedOnly ? "ink" : "soft"}
                  size="sm"
                  onClick={toggleOwedOnly}
                  aria-pressed={owedOnly}
                  title="Only goals with a missed window — one that ended without an entry"
                >
                  Missed only
                  {owedCount > 0 ? <Badge tone="peach">{owedCount}</Badge> : null}
                </Button>
                <SegmentedControl as="radiogroup" ariaLabel="Density"
                  options={DENSITY_OPTIONS}
                  value={density}
                  onChange={setDensity}
                  size="sm"
                />
                {/* Kept in place (disabled) on the board, which has no
                    objective groups — so the row doesn't shift between views. */}
                <Button
                  variant="soft"
                  size="sm"
                  onClick={toggleAllGroups}
                  disabled={view === "board"}
                  title={view === "board" ? "The board has no objective groups to collapse" : undefined}
                >
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
            ) : null
          }
        />

      <div onKeyDown={handleTreeKeyDown}>
        {loadError && !ready ? (
          <Card padding={24} className="flex flex-col items-start gap-3">
            <span className="text-[13px] text-fg">
              Couldn&apos;t load your goals — {loadError.message || "the server didn't respond"}.
            </span>
            <Button variant="soft" size="sm" onClick={retryLoad}>
              Retry
            </Button>
          </Card>
        ) : !ready ? (
          <div className="p-6 text-[13px] text-muted-fg">Loading goals&hellip;</div>
        ) : !hasGoals || rows.length === 0 || !hasL2s ? (
          <Card padding={24} className="flex flex-col items-center gap-3 text-center">
            <span className="text-[15px] font-bold text-fg">
              {hasGoals && !hasL2s ? "Your objectives have no goals under them yet" : "No goals yet"}
            </span>
            <span className="max-w-[420px] text-[13px] leading-[1.5] text-muted-fg">
              {hasGoals && !hasL2s
                ? "Each objective needs at least one goal under it before there is anything to track. Add them in Settings."
                : "Add your objectives and goals by hand, or import them from your review document, then give each one a tracker."}
            </span>
            <Button as={Link} href={link("/settings?tab=goals")} variant="ink" size="sm">
              Add or import goals
            </Button>
          </Card>
        ) : (
          <div className="flex flex-col gap-4">
            <GoalsSummary weighted={weighted} logged={logged} unmeasured={unmeasured} counts={counts} />

            {tileRows.length === 0 ? (
              <Card padding={24} className="text-center text-[13px] text-muted-fg">
                Nothing missed right now.
              </Card>
            ) : (
              <>
                <ObjectiveTiles
                  rows={tileRows}
                  selectedId={activeObjectiveId}
                  onSelect={toggleObjective}
                  onSelectGoal={openGoalFromTile}
                  selectedGoalId={selected?.goal.id || null}
                  collapsedIds={collapsedL1Ids}
                />

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <SegmentedControl ariaLabel="Goals view"
                    options={VIEW_OPTIONS}
                    value={view}
                    onChange={changeView}
                    size="sm"
                  />
                  {activeObjectiveId ? (
                    <Button
                      variant="soft"
                      size="sm"
                      onClick={() => toggleObjective(activeObjectiveId)}
                      aria-label={`Clear the objective filter (${activeObjectiveTitle})`}
                    >
                      {visibleGoals.length} of {totalGoals} goals · {activeObjectiveTitle}
                      <X size={13} />
                    </Button>
                  ) : (
                    <span className="text-[12px] font-semibold text-muted-fg">
                      {visibleGoals.length} goal{visibleGoals.length === 1 ? "" : "s"} shown
                    </span>
                  )}
                </div>

                {view === "timeline" ? (
                  <TimelineView
                    rows={viewRows}
                    selectedId={selected?.goal.id || null}
                    onSelect={selectGoal}
                    collapsedIds={collapsedL1Ids}
                    onToggleGroup={toggleL1}
                    focusedId={activeRowId}
                    registerRow={registerRow}
                    density={density}
                  />
                ) : view === "board" ? (
                  <BoardView
                    items={visibleGoals}
                    selectedId={selected?.goal.id || null}
                    onSelect={selectGoal}
                    focusedId={activeRowId}
                    registerRow={registerRow}
                    density={density}
                  />
                ) : (
                  <FocusView
                    rows={viewRows}
                    selected={selected}
                    selectedId={selected?.goal.id || null}
                    onSelect={selectGoal}
                    collapsedIds={collapsedL1Ids}
                    onToggleGroup={toggleL1}
                    focusedId={activeRowId}
                    registerRow={registerRow}
                    density={density}
                    onClassify={openAnalyst}
                  />
                )}
              </>
            )}
          </div>
        )}
      </div>

      {evidenceOpen ? <EvidenceDrawer onClose={() => setEvidenceOpen(false)} /> : null}
    </PageContainer>
  );
}
