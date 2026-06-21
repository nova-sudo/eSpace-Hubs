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
import { Button, Field, Input, MonoLabel } from "@/components/ui";
import { cn } from "@/lib/cn";
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

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-start justify-between gap-4">
        <div>
          <MonoLabel>Your goals</MonoLabel>
          <p className="mt-1 max-w-xl text-[13px] leading-[1.5] text-muted-fg">
            Fill in every field the AI will see. Rubric + description are
            the biggest signals for widget choice — the more specific, the
            better the tracking.
          </p>
        </div>
        <div className="shrink-0 text-right">
          <MonoLabel>
            {total.l1s} L1 · {total.l2s} L2
          </MonoLabel>
          <div
            className={cn(
              "mt-1",
              weights.total === 100
                ? "text-good"
                : weights.total > 100
                  ? "text-bad"
                  : "text-muted-fg",
            )}
            style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600 }}
          >
            Σ weightage: {weights.total}%
            {weights.remaining > 0 ? ` (${weights.remaining}% unassigned)` : null}
          </div>
        </div>
      </header>

      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={addL1}>
          <Plus className="h-4 w-4" /> Add L1
        </Button>
        <Button
          variant={importing ? "solid" : "ghost"}
          onClick={() => setImporting((v) => !v)}
        >
          <Download className="h-4 w-4" />
          {importing ? "Hide import" : "Import from Zoho"}
        </Button>
        <div className="ml-auto">
          <Button variant="ghost" onClick={handleLoadTest}>
            <FlaskConical className="h-4 w-4" /> Load test goals
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
    </div>
  );
}

function EmptyHint() {
  return (
    <div className="rounded-[var(--radius-tile)] border border-dashed border-border-strong bg-card-alt px-6 py-8 text-center">
      <div className="text-[13px] text-muted-fg">
        No goals yet. Click <strong>Add L1</strong> to start mapping them.
      </div>
    </div>
  );
}

/* ────────────────────────────── L1 ────────────────────────────── */

function L1Card({ l1, index }) {
  const l2Weight = l1.l2s.reduce((s, l2) => s + (Number(l2.weightage) || 0), 0);
  return (
    <div className="rounded-[var(--radius-tile)] border border-border bg-card p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <GripVertical className="h-4 w-4 text-dim-fg" />
          <span
            className="uppercase text-accent"
            style={{
              fontFamily: "var(--font-dot)",
              fontWeight: 700,
              fontSize: 15,
              letterSpacing: "1px",
            }}
          >
            L1 · {String(index + 1).padStart(2, "0")}
          </span>
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
          <Trash2 className="h-3.5 w-3.5" /> Delete
        </Button>
      </div>

      <div className="grid grid-cols-[1fr_160px_160px] gap-3">
        <Field label="Code (optional)">
          <Input
            value={l1.code}
            onChange={(e) => updateL1(l1.id, { code: e.target.value })}
            placeholder="R-L0-3-PSCS-L1-06"
            mono
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
          className="w-full rounded-[var(--radius-sub)] border border-border bg-card px-3 py-2.5 text-[13px] text-fg outline-none placeholder:text-dim-fg focus:border-accent"
          style={{ fontFamily: "var(--font-sans)", resize: "vertical" }}
        />
      </Field>

      <div className="mt-4 rounded-[var(--radius-sub)] border border-dashed border-border bg-card-alt p-4">
        <div className="mb-3 flex items-center justify-between">
          <MonoLabel>
            {l1.l2s.length} L2 mapped · Σ {l2Weight}%
          </MonoLabel>
          <Button variant="ghost" size="sm" onClick={() => addL2(l1.id)}>
            <Plus className="h-3 w-3" /> Add L2
          </Button>
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
    </div>
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
    <div className="rounded-[var(--radius-sub)] border border-border bg-card">
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
    </div>
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
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-fg" />
      ) : (
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-fg" />
      )}
      <span
        className="shrink-0 text-dim-fg"
        style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700 }}
      >
        L2/{String(index + 1).padStart(2, "0")}
      </span>
      {l2.code ? (
        <span
          className="shrink-0 text-accent"
          style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700 }}
        >
          {l2.code}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
        {l2.title || <span className="text-dim-fg">Untitled L2</span>}
      </span>
      <SummaryChips l2={l2} />
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="shrink-0 rounded-full p-1 text-dim-fg hover:bg-[color-mix(in_srgb,var(--bad)_12%,transparent)] hover:text-bad"
        aria-label="Remove L2"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </button>
  );
}

function SummaryChips({ l2 }) {
  const chips = [];
  if (Number(l2.weightage) > 0) {
    chips.push({ key: "w", label: `${l2.weightage}%`, tone: "muted" });
  }
  if (l2.priority) {
    chips.push({
      key: "p",
      label: l2.priority,
      tone:
        l2.priority === "high"
          ? "bad"
          : l2.priority === "medium"
            ? "accent"
            : "muted",
    });
  }
  if (l2.dueDate) {
    chips.push({ key: "d", label: `due ${fmtDate(l2.dueDate)}`, tone: "muted" });
  }
  if (chips.length === 0) return null;
  return (
    <div className="hidden shrink-0 items-center gap-1.5 md:flex">
      {chips.map((c) => (
        <ChipInline key={c.key} tone={c.tone}>
          {c.label}
        </ChipInline>
      ))}
    </div>
  );
}

function ChipInline({ children, tone }) {
  const toneStyles = {
    muted: { bg: "var(--panel-2)", color: "var(--muted-fg)" },
    accent: { bg: "var(--accent-dim)", color: "var(--accent)" },
    bad: {
      bg: "color-mix(in srgb, var(--bad) 13%, transparent)",
      color: "var(--bad)",
    },
  };
  const style = toneStyles[tone] || toneStyles.muted;
  return (
    <span
      className="rounded-full px-2 py-[1px] uppercase"
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 9.5,
        letterSpacing: "0.4px",
        fontWeight: 700,
        background: style.bg,
        color: style.color,
      }}
    >
      {children}
    </span>
  );
}

function L2Form({ l1Id, l2 }) {
  const patch = (p) => updateL2(l1Id, l2.id, p);
  return (
    <div className="border-t border-border p-3">
      <div className="grid grid-cols-[1fr_1fr_120px] gap-3">
        <Field label="Code (optional)">
          <Input
            value={l2.code}
            onChange={(e) => patch({ code: e.target.value })}
            placeholder="R-L0-3-PSCS-L2-06-01"
            mono
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
          className="w-full rounded-[var(--radius-sub)] border border-border bg-card px-3 py-2.5 text-[13px] text-fg outline-none placeholder:text-dim-fg focus:border-accent"
          style={{ fontFamily: "var(--font-sans)", resize: "vertical" }}
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
          className="w-full rounded-[var(--radius-sub)] border border-border bg-card px-3 py-2.5 text-[13px] text-fg outline-none placeholder:text-dim-fg focus:border-accent"
          style={{ fontFamily: "var(--font-sans)", resize: "vertical" }}
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
    <select
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-[var(--radius-sub)] border border-border bg-card px-3 py-2.5 text-[13px] text-fg outline-none focus:border-accent"
    >
      {GOAL_PRIORITIES.map((p) => (
        <option key={p.value} value={p.value}>
          {p.label}
        </option>
      ))}
    </select>
  );
}

function CategorySelect({ value, onChange }) {
  return (
    <select
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-[var(--radius-sub)] border border-border bg-card px-3 py-2.5 text-[13px] text-fg outline-none focus:border-accent"
    >
      {GOAL_CATEGORIES.map((c) => (
        <option key={c.value} value={c.value}>
          {c.label}
        </option>
      ))}
    </select>
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
