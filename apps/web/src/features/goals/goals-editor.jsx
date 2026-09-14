"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Download,
  FlaskConical,
  GripVertical,
  Plus,
  Trash2,
} from "lucide-react";
import { Badge, Button, Card, Field, IconButton, Input, Label, Section, Select } from "@/components/ui";
import { cn } from "@/lib/cn";
import { dueStatus } from "@/lib/date";
import {
  addL1,
  addL2,
  GOAL_CATEGORIES,
  GOAL_PRIORITIES,
  loadTestGoals,
  removeL1,
  removeL2,
  updateL1,
  updateL2,
} from "./goals-store";
import { useGoals } from "./use-goals";
import { GoalsImport } from "./goals-import";
import { PastCycles } from "./past-cycles";

/**
 * L1 / L2 goal tree editor.
 *
 * Mirrors Zoho People's KRA module. A user has many L1 goals; each L1 has
 * N L2 sub-goals. The tree lives in localStorage — no backend, no auth.
 *
 * We deliberately do NOT capture `status`/`progress` — the AI Analyst
 * classifies each goal and a widget derives progress from the
 * integrations (or via the user answering a per-goal manual widget).
 *
 * Every L2 field the AI sees during classification is set here. Richer
 * data → better widget choices. The rubric + description pair is the
 * single biggest signal the AI uses to pick between an AUTO code metric
 * and a MANUAL counter / milestone / etc.
 */
export function GoalsEditor() {
  const { goals, total, weights } = useGoals();
  const [importing, setImporting] = useState(false);

  // Replace the entire tree with the curated test set. Guarded by a
  // confirm prompt when there's existing data — the action is destructive
  // (existing goals are wiped) and otherwise too easy to misclick.
  function handleLoadTest() {
    const hasData = goals.l1s.length > 0;
    if (
      hasData &&
      !confirm(
        "Replace your current goal tree with the test set?\n\n" +
          "13 test L2s will be loaded — one per widget kind plus a delegated " +
          "and a context-required case. Your existing goals will be wiped.",
      )
    ) {
      return;
    }
    loadTestGoals();
  }

  const weightTone = weights.total === 100 ? "mint" : weights.total > 100 ? "peach" : "neutral";

  return (
    <div className="flex flex-col gap-6">
      <Section
        title="Your goals"
        right={
          <div className="flex items-center gap-2">
            <Label>
              {total.l1s} L1 · {total.l2s} L2
            </Label>
            <Badge tone={weightTone}>
              {weights.total}% weighted
              {weights.remaining > 0 ? ` · ${weights.remaining}% left` : ""}
            </Badge>
          </div>
        }
      >
        <p className="max-w-xl text-[13px] leading-[1.5] text-muted-fg">
          Fill in every field the AI will see. Rubric + description are
          the biggest signals for widget choice — the more specific, the
          better the tracking.
        </p>
      </Section>

      <div className="flex items-center gap-2">
        <Button variant="soft" size="sm" onClick={addL1}>
          <Plus size={14} /> Add L1
        </Button>
        <Button
          variant={importing ? "ink" : "soft"}
          size="sm"
          onClick={() => setImporting((v) => !v)}
        >
          <Download size={14} />
          {importing ? "Hide import" : "Import from Zoho"}
        </Button>
        <div className="ml-auto">
          <Button variant="soft" size="sm" onClick={handleLoadTest}>
            <FlaskConical size={14} /> Load test goals
          </Button>
        </div>
      </div>

      {importing ? <GoalsImport onClose={() => setImporting(false)} /> : null}

      <div className="flex flex-col gap-4">
        {goals.l1s.map((l1, i) => (
          <L1Card key={l1.id} l1={l1} index={i} />
        ))}
        {goals.l1s.length === 0 ? <EmptyHint /> : null}
      </div>

      {/* Archived prior trees (F2 v1) — replace imports freeze the
          outgoing tree here instead of destroying it. */}
      <PastCycles />
    </div>
  );
}

function EmptyHint() {
  return (
    <Card className="text-center">
      <div className="text-[15px] font-bold text-fg">No goals yet</div>
      <p className="mt-1 text-[13px] text-muted-fg">
        Add an L1 objective to start mapping your goal tree.
      </p>
      <div className="mt-4 flex justify-center">
        <Button size="sm" onClick={addL1}>
          <Plus size={14} /> Add L1
        </Button>
      </div>
    </Card>
  );
}

/* ────────────────────────────── L1 ────────────────────────────── */

function L1Card({ l1, index }) {
  const l2Weight = l1.l2s.reduce((s, l2) => s + (Number(l2.weightage) || 0), 0);
  return (
    <Card>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <GripVertical size={16} className="text-dim-fg" />
          <Label>L1 · {String(index + 1).padStart(2, "0")}</Label>
        </div>
        <Button
          variant="danger"
          size="sm"
          onClick={() => {
            if (confirm(`Remove L1 "${l1.title || "untitled"}" and all its L2s?`)) {
              removeL1(l1.id);
            }
          }}
        >
          <Trash2 size={14} /> Delete
        </Button>
      </div>

      <div className="grid grid-cols-[1fr_160px_160px] gap-3">
        <Field label="Code (optional)">
          <Input
            value={l1.code}
            onChange={(e) => updateL1(l1.id, { code: e.target.value })}
            placeholder="R-L0-3-PSCS-L1-06"
          />
        </Field>
        <Field label="Category">
          <CategorySelect
            value={l1.category}
            onChange={(v) => updateL1(l1.id, { category: v })}
          />
        </Field>
        <Field label="Weightage %">
          <Input
            type="number"
            min={0}
            max={100}
            value={l1.weightage}
            onChange={(e) =>
              updateL1(l1.id, { weightage: clampPct(e.target.value) })
            }
          />
        </Field>
      </div>

      <Field label="Goal statement" className="mt-2">
        <Input
          value={l1.title}
          onChange={(e) => updateL1(l1.id, { title: e.target.value })}
          placeholder="Achieve 100% compliance with client-specific uptime SLAs…"
        />
      </Field>

      <Field
        label="Short description"
        hint="One or two sentences — more context than the title, less detail than the rubric."
        className="mt-2"
      >
        <Input
          value={l1.description}
          onChange={(e) => updateL1(l1.id, { description: e.target.value })}
          placeholder="Keep client-facing dev environments recoverable within SLA."
        />
      </Field>

      <Field
        label="Achievement rubric"
        hint="Not Achieved / Achieved / Over Achieved / Role Model — one per line."
        className="mt-2"
      >
        <textarea
          rows={4}
          value={l1.rubric}
          onChange={(e) => updateL1(l1.id, { rubric: e.target.value })}
          placeholder="- Achieved: 100% adherence to all client SLAs AND developer environments restored in ≤ 2 hours…"
          className="w-full resize-y rounded-[var(--radius-lg)] bg-card-alt p-3.5 text-[13.5px] text-fg outline-none placeholder:text-dim-fg focus:ring-2 focus:ring-ink"
        />
      </Field>

      <div className="mt-4 rounded-[var(--radius-lg)] bg-card-alt p-4">
        <div className="mb-3 flex items-center justify-between">
          <Label>
            {l1.l2s.length} L2 mapped · Σ {l2Weight}%
          </Label>
          <IconButton label="Add L2" size="sm" onCard onClick={() => addL2(l1.id)}>
            <Plus size={14} />
          </IconButton>
        </div>
        <div className="flex flex-col gap-2">
          {l1.l2s.map((l2, j) => (
            <L2Card key={l2.id} l1Id={l1.id} l2={l2} index={j} />
          ))}
          {l1.l2s.length === 0 ? (
            <div className="py-2 text-[12px] text-dim-fg">
              No L2s yet. Add the specific sub-goals that roll up to this L1.
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

/* ────────────────────────────── L2 ────────────────────────────── */

/**
 * L2 card. Collapsed by default to a compact row (code + title + weight +
 * priority + due date) so long trees stay scannable. Click the chevron to
 * expand into the full form (description, rubric, start/due, category).
 */
function L2Card({ l1Id, l2, index }) {
  // Expanded when the card is empty (freshly added) OR if the user toggles it.
  const isEmpty = !l2.title && !l2.rubric && !l2.description;
  const [expanded, setExpanded] = useState(isEmpty);

  return (
    <Card radius="lg" padding={0}>
      <L2Summary
        l2={l2}
        index={index}
        expanded={expanded}
        onToggle={() => setExpanded((v) => !v)}
        onRemove={() => {
          if (confirm(`Remove L2 "${l2.title || "untitled"}"?`)) {
            removeL2(l1Id, l2.id);
          }
        }}
      />
      {expanded ? <L2Form l1Id={l1Id} l2={l2} /> : null}
    </Card>
  );
}

function L2Summary({ l2, index, expanded, onToggle, onRemove }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-card-alt"
    >
      {expanded ? (
        <ChevronDown size={14} className="shrink-0 text-muted-fg" />
      ) : (
        <ChevronRight size={14} className="shrink-0 text-muted-fg" />
      )}
      <span className="shrink-0 text-[11px] font-semibold text-dim-fg">
        L2/{String(index + 1).padStart(2, "0")}
      </span>
      {l2.code ? (
        <span className="shrink-0 font-mono text-[11px] font-bold text-muted-fg">
          {l2.code}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
        {l2.title || <span className="text-dim-fg">Untitled L2</span>}
      </span>
      <SummaryChips l2={l2} />
      <IconButton
        label="Remove L2"
        size="sm"
        onCard
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      >
        <Trash2 size={13} />
      </IconButton>
    </button>
  );
}

function SummaryChips({ l2 }) {
  const chips = [];
  if (Number(l2.weightage) > 0) {
    chips.push({ key: "w", label: `${l2.weightage}%`, tone: "lav" });
  }
  if (l2.priority) {
    chips.push({
      key: "p",
      label: l2.priority,
      tone:
        l2.priority === "high"
          ? "peach"
          : l2.priority === "medium"
            ? "lemon"
            : "neutral",
    });
  }
  if (l2.dueDate) {
    // F4 — the date finally knows what day it is: overdue reads peach,
    // inside a week reads lemon, far-off stays neutral.
    const due = dueStatus(l2.dueDate);
    chips.push({
      key: "d",
      label:
        due?.state === "overdue"
          ? `Overdue ${fmtDate(l2.dueDate)}`
          : `Due ${fmtDate(l2.dueDate)}`,
      tone:
        due?.state === "overdue"
          ? "peach"
          : due?.state === "due_soon"
            ? "lemon"
            : "neutral",
    });
  }
  if (chips.length === 0) return null;
  return (
    <div className="hidden shrink-0 items-center gap-1.5 md:flex">
      {chips.map((c) => (
        <Badge key={c.key} tone={c.tone}>
          {c.label}
        </Badge>
      ))}
    </div>
  );
}

function L2Form({ l1Id, l2 }) {
  const patch = (p) => updateL2(l1Id, l2.id, p);
  return (
    <div className="border-t border-line p-3">
      <div className="grid grid-cols-[1fr_1fr_120px] gap-3">
        <Field label="Code (optional)">
          <Input
            value={l2.code}
            onChange={(e) => patch({ code: e.target.value })}
            placeholder="R-L0-3-PSCS-L2-06-01"
          />
        </Field>
        <Field label="Category">
          <CategorySelect
            value={l2.category}
            onChange={(v) => patch({ category: v })}
          />
        </Field>
        <Field label="Weightage %">
          <Input
            type="number"
            min={0}
            max={100}
            value={l2.weightage}
            onChange={(e) => patch({ weightage: clampPct(e.target.value) })}
          />
        </Field>
      </div>

      <Field
        label="Title"
        hint="The one-line statement of what you're accountable for."
        className="mt-2"
      >
        <Input
          value={l2.title}
          onChange={(e) => patch({ title: e.target.value })}
          placeholder="Reduce post-delivery defects to ≤10% per quarter"
        />
      </Field>

      <Field
        label="Description"
        hint="Extra context that isn't the rubric — scope, stakeholders, what 'done' looks like in one paragraph."
        className="mt-2"
      >
        <textarea
          rows={2}
          value={l2.description}
          onChange={(e) => patch({ description: e.target.value })}
          placeholder="Defects are tracked on the quality dashboard. Scope is the payments squad only."
          className="w-full resize-y rounded-[var(--radius-lg)] bg-card-alt p-3.5 text-[13.5px] text-fg outline-none placeholder:text-dim-fg focus:ring-2 focus:ring-ink"
        />
      </Field>

      <Field
        label="Rubric"
        hint="Not achieved / Achieved / Over / Role-model — one per line."
        className="mt-2"
      >
        <textarea
          rows={3}
          value={l2.rubric}
          onChange={(e) => patch({ rubric: e.target.value })}
          placeholder={"- Achieved: ≤10% defects per quarter\n- Over achieved: ≤5%\n- Role model: zero defects + documented RCA cadence"}
          className="w-full resize-y rounded-[var(--radius-lg)] bg-card-alt p-3.5 text-[13.5px] text-fg outline-none placeholder:text-dim-fg focus:ring-2 focus:ring-ink"
        />
      </Field>

      <div className="mt-2 grid grid-cols-[140px_160px_160px] gap-3">
        <Field label="Priority">
          <PrioritySelect
            value={l2.priority}
            onChange={(v) => patch({ priority: v })}
          />
        </Field>
        <Field label="Start date">
          <Input
            type="date"
            value={l2.startDate}
            onChange={(e) => patch({ startDate: e.target.value })}
          />
        </Field>
        <Field label="Due date">
          <Input
            type="date"
            value={l2.dueDate}
            onChange={(e) => patch({ dueDate: e.target.value })}
          />
        </Field>
      </div>
    </div>
  );
}

/* ────────────────────────────── shared ────────────────────────────── */

function PrioritySelect({ value, onChange }) {
  return (
    <Select
      tone="default"
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      className="w-full"
    >
      {GOAL_PRIORITIES.map((p) => (
        <option key={p.value} value={p.value}>
          {p.label}
        </option>
      ))}
    </Select>
  );
}

function CategorySelect({ value, onChange }) {
  return (
    <Select
      tone="default"
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      className="w-full"
    >
      {GOAL_CATEGORIES.map((c) => (
        <option key={c.value} value={c.value}>
          {c.label}
        </option>
      ))}
    </Select>
  );
}

function clampPct(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function fmtDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}
