"use client";

/**
 * <PlanEditor> — the "bigger view" of a COMPOSED tracker's plan.
 *
 * Shows the cycle as the windows it will actually produce (13 weeks from
 * 1 Sep, not "weekly"), with the cadence, start and length editable at the
 * top, and every window's activities / deliverables laid out beneath so they
 * can be dragged — or arrow-moved, for keyboards — into the window they
 * belong to. A window can also frame a nested cadence (weeks inside a
 * quarter), which renders as this same editor one level down, bounded to
 * that window.
 *
 * Two places mount it: the compose modal's "Review the plan" step (accept or
 * fix what the AI generated before it's submitted), and the "Edit plan"
 * action on a live COMPOSED widget. Both hold the block in their own state
 * and hand edits back through `onChange`; this component owns no
 * persistence and does no IO. All the logic is in plan-model.js — this file
 * is layout and event wiring.
 *
 * Provenance is surfaced, not hidden: when the length is the calendar-year
 * default (the 53-cells bug) or the start is "today because nothing said
 * otherwise", the toolbar says so in the same lemon "we weren't sure" voice
 * the compose modal uses everywhere else.
 */

import { useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronDown, ChevronRight, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, IconButton, Input, Label, Select } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  PLAN_CADENCES,
  addDetailItem,
  cadenceNoun,
  describeCycle,
  detailCapacity,
  formatRange,
  insertPeriodAfter,
  isPlanCadence,
  materialisePeriods,
  moveDetailItem,
  periodLabelFor,
  removeDetailItem,
  removePeriod,
  resolvePlanBounds,
  setCadence,
  setCycleStart,
  setManagementBlock,
  setNestedBlock,
  setNestedCadence,
  setPeriodCount,
  setPeriodDueAt,
  setPeriodFocus,
  setPeriodLabel,
  swapPeriods,
} from "./plan-model";

const DAY = 86_400_000;
const MAX_DEPTH = 6;

const CADENCE_LABEL = {
  daily: "Daily",
  weekly: "Weekly",
  biweekly: "Every two weeks",
  monthly: "Monthly",
  quarterly: "Quarterly",
};

/** Cadences strictly finer than `outer` — the only ones that can nest inside it. */
function finerThan(outer) {
  const i = PLAN_CADENCES.indexOf(outer);
  return i < 0 ? [] : PLAN_CADENCES.slice(0, i);
}

const KIND_LABEL = { activities: "Activities", deliverables: "Deliverables" };

/**
 * @param {object} props
 * @param {object} props.block            A composed block (top level, nested, or management).
 * @param {(next:object)=>void} props.onChange
 * @param {object} [props.goal]           Top level only — its startDate anchors an undated plan.
 * @param {number} [props.depth]
 * @param {number} [props.containerStart] Nested only: the containing window's start (ms).
 * @param {number} [props.containerEnd]   Nested only: the containing window's end (ms, exclusive).
 */
export function PlanEditor({ block, onChange, goal, depth = 0, containerStart, containerEnd }) {
  const bounds = useMemo(
    () =>
      resolvePlanBounds(block, {
        goal: depth === 0 ? goal : null,
        containerStart,
        containerEnd,
      }),
    [block, goal, depth, containerStart, containerEnd],
  );
  // Which window is being dragged from — a ref, not state, so the 53-row
  // list doesn't re-render on every dragover.
  const dragRef = useRef(null);
  const [overIndex, setOverIndex] = useState(-1);

  if (!block?.cadence || !isPlanCadence(block.cadence) || !bounds) {
    return (
      <div className="flex flex-col gap-2 rounded-[var(--radius-lg)] bg-card-alt p-4">
        <Label>No cadence yet</Label>
        <div className="text-[12.5px] leading-[1.5] text-muted-fg">
          A one-time tracker has no cycle to map. Pick a cadence to lay the plan out as windows.
        </div>
        <div className="w-[200px]">
          <CadenceSelect value="" onChange={(c) => onChange({ ...block, cadence: c })} allowEmpty />
        </div>
      </div>
    );
  }

  const periods = Array.isArray(block.periods) ? block.periods : [];
  const flat = periods.length === 0;
  const inherits = depth > 0 && bounds.startSource === "container" && bounds.lengthSource === "container";

  function ensurePeriods() {
    return flat ? materialisePeriods(block, bounds.periodCount) : block;
  }

  function handleMove(from, toIndex, position) {
    if (!from) return;
    if (from.index !== toIndex && detailCapacity(block, toIndex, from.kind) < 1) {
      toast.error(`That window already holds the most ${from.kind} it can.`);
      return;
    }
    onChange(moveDetailItem(block, from, { index: toIndex, position }));
  }

  function shift(i, kind, item, dir) {
    const to = i + dir;
    if (to < 0 || to >= bounds.windows.length) return;
    handleMove({ index: i, kind, item }, to);
  }

  const nounPlural = cadenceNoun(bounds.cadence, 2);

  return (
    <div className="flex flex-col gap-3">
      {/* ── Cycle toolbar ── */}
      <div className="flex flex-col gap-2 rounded-[var(--radius-lg)] bg-card-alt p-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <Label>Cadence</Label>
            <div className="w-[170px]">
              <CadenceSelect value={block.cadence} onChange={(c) => onChange(setCadence(block, c, bounds))} />
            </div>
          </label>
          {inherits ? null : (
            <>
              <label className="flex flex-col gap-1">
                <Label>Starts</Label>
                <Input
                  type="date"
                  value={bounds.cycleStart}
                  onChange={(e) => onChange(setCycleStart(block, e.target.value, bounds))}
                  className="h-9 w-[160px] px-3 text-[13px]"
                  aria-label="Cycle start date"
                />
              </label>
              <label className="flex flex-col gap-1">
                <Label>Length</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    max={53}
                    value={bounds.periodCount}
                    onChange={(e) => {
                      const n = Number.parseInt(e.target.value, 10);
                      if (Number.isInteger(n)) onChange(setPeriodCount(block, n, bounds));
                    }}
                    className="h-9 w-[76px] px-3 text-[13px]"
                    aria-label={`Plan length in ${nounPlural}`}
                  />
                  <span className="text-[12.5px] text-muted-fg">{nounPlural}</span>
                </div>
              </label>
            </>
          )}
          <div className="ml-auto flex flex-col items-end gap-1">
            <Badge tone={bounds.lengthSource === "default" ? "lemon" : "mint"}>{describeCycle(bounds)}</Badge>
            {inherits ? (
              <span className="text-[11.5px] text-dim-fg">Inherits the window it sits in</span>
            ) : null}
          </div>
        </div>
        {bounds.lengthSource === "default" ? (
          <div className="text-[12.5px] leading-[1.5] text-lemon-ink">
            That is a year&apos;s worth of {nounPlural}, not a length the plan stated. Set how many{" "}
            {nounPlural} it actually runs.
          </div>
        ) : null}
        {bounds.startSource === "today" ? (
          <div className="text-[12.5px] leading-[1.5] text-muted-fg">
            No start date was found, so the cycle starts this{" "}
            {cadenceNoun(bounds.cadence, 1)}. Change it if the plan begins elsewhere.
          </div>
        ) : null}
      </div>

      {/* ── Windows ── */}
      <div className="flex flex-col gap-2">
        {bounds.windows.map((w, i) => (
          <WindowRow
            key={w.key}
            index={i}
            window={w}
            period={periods[i] || null}
            block={block}
            bounds={bounds}
            flat={flat}
            depth={depth}
            isOver={overIndex === i}
            onDragStartItem={(payload) => {
              dragRef.current = payload;
            }}
            onDragEnter={() => setOverIndex(i)}
            onDragLeave={() => setOverIndex((cur) => (cur === i ? -1 : cur))}
            onDrop={() => {
              const from = dragRef.current;
              dragRef.current = null;
              setOverIndex(-1);
              handleMove(from, i);
            }}
            onShift={(kind, item, dir) => shift(i, kind, item, dir)}
            onRemoveItem={(kind, item) => onChange(removeDetailItem(block, i, kind, item))}
            onAddItem={(kind, text) => {
              const base = ensurePeriods();
              if (detailCapacity(base, i, kind) < 1) {
                toast.error(`That window already holds the most ${kind} it can.`);
                return;
              }
              onChange(addDetailItem(base, i, kind, text));
            }}
            onLabel={(text) => onChange(setPeriodLabel(ensurePeriods(), i, text))}
            onFocus={(text) => onChange(setPeriodFocus(ensurePeriods(), i, text))}
            onDueAt={(iso) => onChange(setPeriodDueAt(ensurePeriods(), i, iso))}
            onSwap={(dir) => onChange(swapPeriods(block, i, i + dir))}
            onInsertAfter={() => onChange(insertPeriodAfter(block, i, bounds))}
            onRemove={() => onChange(removePeriod(ensurePeriods(), i, bounds))}
            onNestedCadence={(c) => onChange(setNestedCadence(block, i, c, bounds))}
            onNestedChange={(nb) => onChange(setNestedBlock(block, i, nb))}
          />
        ))}
      </div>

      {/* ── Management half ── */}
      {depth === 0 && block.management ? (
        <div className="mt-2 flex flex-col gap-2 border-t border-line pt-3">
          <div className="flex items-center justify-between gap-2">
            <Label>Management plan</Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onChange(setManagementBlock(block, null))}
            >
              Remove management plan
            </Button>
          </div>
          <PlanEditor
            block={block.management}
            onChange={(mb) => onChange(setManagementBlock(block, mb))}
            depth={1}
            containerStart={Date.parse(bounds.cycleStart)}
            containerEnd={Date.parse(bounds.cycleEnd) + DAY}
          />
        </div>
      ) : null}
    </div>
  );
}

function CadenceSelect({ value, onChange, options = PLAN_CADENCES, allowEmpty = false, emptyLabel = "Choose…" }) {
  return (
    <Select value={value || ""} onChange={(e) => onChange(e.target.value)} size="sm" aria-label="Cadence">
      {allowEmpty ? <option value="">{emptyLabel}</option> : null}
      {options.map((c) => (
        <option key={c} value={c}>
          {CADENCE_LABEL[c] || c}
        </option>
      ))}
    </Select>
  );
}

/** One cycle window: its heading, brief, mapped items, and any nested cadence. */
function WindowRow({
  index,
  window: w,
  period,
  block,
  bounds,
  flat,
  depth,
  isOver,
  onDragStartItem,
  onDragEnter,
  onDragLeave,
  onDrop,
  onShift,
  onRemoveItem,
  onAddItem,
  onLabel,
  onFocus,
  onDueAt,
  onSwap,
  onInsertAfter,
  onRemove,
  onNestedCadence,
  onNestedChange,
}) {
  const activities = period?.detail?.activities || [];
  const deliverables = period?.detail?.deliverables || [];
  const hasContent = activities.length > 0 || deliverables.length > 0 || !!period?.detail?.focus || !!period?.nested;
  // Long plans (weekly = up to 53 rows) open only the rows that say
  // something; the header stays a drop target either way.
  const [open, setOpen] = useState(hasContent || index === 0 || bounds.windows.length <= 6);
  const total = bounds.windows.length;
  const nestedOptions = finerThan(bounds.cadence);
  const canNest = depth < MAX_DEPTH && nestedOptions.length > 0;

  return (
    <div
      className={cn(
        "rounded-[var(--radius-lg)] bg-card-alt p-3 transition-shadow",
        isOver ? "ring-2 ring-ink" : "",
      )}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        onDragEnter();
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) onDragLeave();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? "Collapse window" : "Expand window"}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-fg hover:bg-card"
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <Badge tone={w.state === "current" ? "sky" : "neutral"}>{w.label}</Badge>
        <input
          value={period?.label ?? ""}
          placeholder={periodLabelFor(bounds.cadence, index + 1)}
          onChange={(e) => onLabel(e.target.value)}
          aria-label={`Window ${index + 1} title`}
          className="h-8 min-w-[160px] flex-1 rounded-[var(--radius-md)] bg-card px-2.5 text-[13px] font-semibold text-fg outline-none placeholder:font-normal placeholder:text-dim-fg focus:ring-2 focus:ring-ink"
        />
        <span className="text-[12px] text-muted-fg">{formatRange(w.start, w.end - DAY)}</span>
        {!flat && !open && (activities.length || deliverables.length) ? (
          <span className="text-[11.5px] text-dim-fg">
            {activities.length + deliverables.length} mapped
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-0.5">
          <IconButton label="Move window earlier" size="sm" onCard onClick={() => onSwap(-1)} disabled={flat || index === 0}>
            <ArrowUp size={13} />
          </IconButton>
          <IconButton label="Move window later" size="sm" onCard onClick={() => onSwap(1)} disabled={flat || index >= total - 1}>
            <ArrowDown size={13} />
          </IconButton>
          <IconButton label="Insert a window after this one" size="sm" onCard onClick={onInsertAfter} disabled={total >= 53}>
            <Plus size={13} />
          </IconButton>
          <IconButton label="Remove this window (its content moves to the previous one)" size="sm" onCard onClick={onRemove} disabled={total <= 1}>
            <X size={13} />
          </IconButton>
        </div>
      </div>

      {open ? (
        <div className="mt-2.5 flex flex-col gap-2.5 pl-9">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={period?.detail?.focus ?? ""}
              placeholder="Focus — what this window is for"
              onChange={(e) => onFocus(e.target.value)}
              aria-label={`Window ${index + 1} focus`}
              className="h-8 min-w-[220px] flex-1 rounded-[var(--radius-md)] bg-card px-2.5 text-[12.5px] text-fg outline-none placeholder:text-dim-fg focus:ring-2 focus:ring-ink"
            />
            <label className="flex items-center gap-1.5 text-[12px] text-muted-fg">
              Due
              <input
                type="date"
                value={period?.dueAt ?? ""}
                onChange={(e) => onDueAt(e.target.value)}
                aria-label={`Window ${index + 1} due date`}
                className="h-8 rounded-[var(--radius-md)] bg-card px-2 text-[12px] text-fg outline-none focus:ring-2 focus:ring-ink"
              />
            </label>
          </div>

          <ItemList
            kind="activities"
            items={activities}
            windowIndex={index}
            total={total}
            onDragStartItem={onDragStartItem}
            onShift={onShift}
            onRemoveItem={onRemoveItem}
            onAddItem={onAddItem}
          />
          <ItemList
            kind="deliverables"
            items={deliverables.map((d) => d.label)}
            windowIndex={index}
            total={total}
            onDragStartItem={onDragStartItem}
            onShift={onShift}
            onRemoveItem={onRemoveItem}
            onAddItem={onAddItem}
          />

          {period?.fields?.length ? (
            <span className="text-[11.5px] text-dim-fg">
              Asks {period.fields.length} field{period.fields.length === 1 ? "" : "s"} of its own
            </span>
          ) : null}

          {canNest ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Label>Inside this {cadenceNoun(bounds.cadence, 1)}</Label>
                <div className="w-[190px]">
                  <CadenceSelect
                    value={period?.nested?.cadence || ""}
                    onChange={(c) => onNestedCadence(c || null)}
                    options={nestedOptions}
                    allowEmpty
                    emptyLabel="No nested cadence"
                  />
                </div>
              </div>
              {period?.nested?.cadence ? (
                <div className="rounded-[var(--radius-lg)] bg-card p-3">
                  <PlanEditor
                    block={period.nested}
                    onChange={onNestedChange}
                    depth={depth + 1}
                    containerStart={w.start}
                    containerEnd={w.end}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** The mapped items of one kind in one window — draggable chips plus an inline "add". */
function ItemList({ kind, items, windowIndex, total, onDragStartItem, onShift, onRemoveItem, onAddItem }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const deliverable = kind === "deliverables";

  function commit() {
    const text = draft.trim();
    if (text) onAddItem(kind, text);
    setDraft("");
    setAdding(false);
  }

  return (
    <div className="flex flex-col gap-1">
      <Label>{KIND_LABEL[kind]}</Label>
      <div className="flex flex-wrap items-center gap-1.5">
        {items.map((text, j) => (
          <span
            key={`${j}-${text}`}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", text);
              onDragStartItem({ index: windowIndex, kind, item: j });
            }}
            title={text}
            className={cn(
              "inline-flex max-w-full cursor-grab items-center gap-1 rounded-[var(--radius-pill)] py-1 pl-2.5 pr-1 text-[12.5px] active:cursor-grabbing",
              deliverable ? "bg-sky text-sky-ink" : "bg-card text-fg",
            )}
          >
            <span className="truncate">{text}</span>
            <span className="flex items-center">
              <button
                type="button"
                aria-label={`Move "${text}" to the previous window`}
                disabled={windowIndex === 0}
                onClick={() => onShift(kind, j, -1)}
                className="inline-flex h-5 w-5 items-center justify-center rounded-full hover:bg-card-alt disabled:opacity-30"
              >
                <ArrowLeft size={11} />
              </button>
              <button
                type="button"
                aria-label={`Move "${text}" to the next window`}
                disabled={windowIndex >= total - 1}
                onClick={() => onShift(kind, j, 1)}
                className="inline-flex h-5 w-5 items-center justify-center rounded-full hover:bg-card-alt disabled:opacity-30"
              >
                <ArrowRight size={11} />
              </button>
              <button
                type="button"
                aria-label={`Remove "${text}"`}
                onClick={() => onRemoveItem(kind, j)}
                className="inline-flex h-5 w-5 items-center justify-center rounded-full hover:bg-card-alt"
              >
                <X size={11} />
              </button>
            </span>
          </span>
        ))}
        {adding ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              } else if (e.key === "Escape") {
                setDraft("");
                setAdding(false);
              }
            }}
            onBlur={commit}
            placeholder={deliverable ? "Deliverable" : "Activity"}
            aria-label={`New ${deliverable ? "deliverable" : "activity"}`}
            className="h-7 w-[200px] rounded-[var(--radius-pill)] bg-card px-2.5 text-[12.5px] text-fg outline-none placeholder:text-dim-fg focus:ring-2 focus:ring-ink"
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-pill)] px-2.5 text-[12px] font-semibold text-muted-fg hover:bg-card"
          >
            <Plus size={12} /> Add
          </button>
        )}
      </div>
    </div>
  );
}
