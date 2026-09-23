"use client";

/**
 * Create or edit a shared goal: what it is (title, code, description), the
 * plan (designed with the same composer engineers use for their own
 * trackers, in author mode), how strict the deadlines are (grace hours),
 * and who's on it: assignees fill it, viewers only see the analytics.
 *
 * `initial` present → edit mode (PATCH). A schedule change after anyone
 * has submitted needs an explicit confirmation (the server asks; we
 * re-send with `confirmReschedule`).
 */

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ComposeWidgetModal,
  describeCycle,
  resolvePlanBounds,
} from "@/features/goal-widgets";
import { Badge, Button, Card, Field, Input, Label } from "@/components/ui";
import { createAssignedGoal, updateAssignedGoal, useOrgPeople } from "./api";
import { PeoplePicker } from "./people-picker";

const DRAFT_ID = "asg_draft";
const DEFAULT_TIME_ZONE = "Africa/Cairo";
const TIME_ZONES = [
  "Africa/Cairo",
  "Asia/Riyadh",
  "Asia/Dubai",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "UTC",
];

function planSummary(spec) {
  if (!spec?.composed) return null;
  const composed = spec.composed;
  const bounds = resolvePlanBounds(composed);
  const fieldCount = new Set([
    ...(spec.fields || []).map((f) => f.id),
    ...(composed.periods || []).flatMap((p) => (p.fields || []).map((f) => f.id)),
  ]).size;
  return {
    cycle: bounds ? describeCycle(bounds) : composed.cadence ? composed.cadence : "One-time",
    fieldCount,
    periodCount: composed.periods?.length || bounds?.periodCount || 1,
  };
}

export function AssignedGoalEditor({ initial = null, tierCodes = [], onDone, onCancel }) {
  const editing = Boolean(initial);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [code, setCode] = useState(initial?.code ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [graceHours, setGraceHours] = useState(String(initial?.graceHours ?? 0));
  const [timeZone, setTimeZone] = useState(initial?.timeZone ?? DEFAULT_TIME_ZONE);
  // Set when the server asks to confirm a schedule change after submissions.
  const [rescheduleWarning, setRescheduleWarning] = useState(null);
  const [spec, setSpec] = useState(initial?.spec ?? null);
  const [specChanged, setSpecChanged] = useState(false);
  const [assigneeIds, setAssigneeIds] = useState(
    initial?.assignees?.map((p) => p.id) ?? [],
  );
  const [viewerIds, setViewerIds] = useState(initial?.viewers?.map((p) => p.id) ?? []);
  const [composeOpen, setComposeOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const { people, loading: peopleLoading, error: peopleError } = useOrgPeople();

  // Former members still on an existing goal aren't in the active directory —
  // keep their chips labelled.
  const directory = useMemo(() => {
    const seen = new Set(people.map((p) => p.id));
    const extra = [...(initial?.assignees ?? []), ...(initial?.viewers ?? [])]
      .filter((p) => !seen.has(p.id))
      .map((p) => ({ ...p, canFill: true }));
    return [...people, ...extra];
  }, [people, initial]);

  const summary = planSummary(spec);
  const governed = code.trim() && tierCodes.includes(code.trim());
  const grace = Number(graceHours);
  const graceValid = Number.isFinite(grace) && grace >= 0 && grace <= 720;
  const canSave =
    title.trim().length > 0 && spec && assigneeIds.length > 0 && graceValid && !saving;

  async function handleSave({ confirmReschedule = false } = {}) {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const body = {
        title: title.trim(),
        code: code.trim(),
        description,
        graceHours: grace,
        timeZone,
        assigneeIds,
        viewerIds,
      };
      if (editing) {
        const patch = {
          ...body,
          ...(specChanged ? { spec } : {}),
          ...(confirmReschedule ? { confirmReschedule: true } : {}),
        };
        const goal = await updateAssignedGoal(initial.id, patch);
        toast.success("Shared goal updated.");
        onDone?.(goal);
      } else {
        const goal = await createAssignedGoal({ ...body, spec });
        toast.success(`Shared with ${assigneeIds.length} ${assigneeIds.length === 1 ? "person" : "people"}.`);
        onDone?.(goal);
      }
    } catch (err) {
      if (err?.code === "assigned_goal_reschedule_confirm") {
        setRescheduleWarning(err.message);
      } else {
        setError(err?.message || String(err));
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card padding={24} className="flex flex-col gap-6">
      <div>
        <div className="text-[18px] font-bold tracking-[-0.01em]">
          {editing ? "Edit shared goal" : "New shared goal"}
        </div>
        <div className="mt-1 max-w-[560px] text-[13px] text-muted-fg">
          Assignees see it in their own goals under “Shared goals” and fill it
          each period. You and your viewers see who filled what, and when.
        </div>
      </div>

      {/* 1 — what it is */}
      <section className="grid gap-3.5 sm:grid-cols-[2fr_1fr]">
        <Field label="Title">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Weekly delivery update"
            maxLength={300}
          />
        </Field>
        <Field
          label="Goal code (optional)"
          hint={governed ? "A tier policy already governs this code — it will grade this goal." : null}
        >
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. R-L0-3-PSCS"
            maxLength={200}
            className="font-mono"
          />
        </Field>
        <Field label="Description (optional)" className="sm:col-span-2">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            maxLength={4000}
            placeholder="Why this matters and what a good entry looks like."
            className="w-full rounded-[var(--radius-lg)] bg-card-alt px-3.5 py-3 text-[14px] text-fg outline-none placeholder:text-dim-fg focus:ring-2 focus:ring-ink"
          />
        </Field>
      </section>

      {/* 2 — the plan */}
      <section className="flex flex-col gap-2 border-t border-line pt-5">
        <Label>What people fill in</Label>
        {summary ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-lg)] bg-card-alt p-3.5">
            <div className="min-w-0">
              <div className="text-[14.5px] font-bold">{summary.cycle}</div>
              <div className="text-[13px] text-muted-fg">
                {summary.fieldCount} {summary.fieldCount === 1 ? "field" : "fields"} ·{" "}
                {summary.periodCount} {summary.periodCount === 1 ? "period" : "periods"}
              </div>
            </div>
            <Button type="button" variant="soft" size="sm" onClick={() => setComposeOpen(true)}>
              Redesign the plan
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-lg)] bg-lemon p-3.5 text-lemon-ink">
            <div className="text-[13px]">
              Describe what to track and how often (or attach a document). The AI
              drafts the form and schedule; you review it before sharing.
            </div>
            <Button
              type="button"
              variant="ink"
              size="sm"
              onClick={() => setComposeOpen(true)}
              disabled={!title.trim()}
            >
              Design the plan
            </Button>
          </div>
        )}
        {editing && specChanged ? (
          <div className="text-[12px] text-muted-fg">
            Plan changes apply to everyone. If people have already submitted and the schedule changes, you&apos;ll be asked to confirm.
          </div>
        ) : null}
      </section>

      {/* 3 — deadlines */}
      <section className="grid gap-3.5 border-t border-line pt-5 sm:grid-cols-[1fr_2fr]">
        <Field
          label="Grace period (hours)"
          hint="A submission counts as late after the period's due date plus this."
        >
          <Input
            type="number"
            min={0}
            max={720}
            step={1}
            value={graceHours}
            onChange={(e) => setGraceHours(e.target.value)}
          />
        </Field>
        <Field
          label="Deadline time zone"
          hint="“Due on the 25th” means end of the 25th here."
        >
          <select
            value={timeZone}
            onChange={(e) => setTimeZone(e.target.value)}
            className="h-11 w-full rounded-[var(--radius-lg)] bg-card-alt px-3.5 text-[14px] text-fg outline-none focus:ring-2 focus:ring-ink"
          >
            {[...new Set([timeZone, ...TIME_ZONES])].map((tz) => (
              <option key={tz} value={tz}>
                {tz.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </Field>
      </section>

      {/* 4 — people */}
      <section className="grid gap-5 border-t border-line pt-5 lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Label>Assignees · fill it in</Label>
            <Badge>{assigneeIds.length}</Badge>
          </div>
          {peopleError ? (
            <div className="text-[13px] text-muted-fg">Couldn&apos;t load people: {peopleError.message}</div>
          ) : (
            <PeoplePicker
              label="Assignees"
              people={directory}
              selectedIds={assigneeIds}
              onChange={(ids) => {
                setAssigneeIds(ids);
                setViewerIds((v) => v.filter((x) => !ids.includes(x)));
              }}
              mode="assignee"
              placeholder={peopleLoading ? "Loading people…" : "Search by name or email"}
            />
          )}
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Label>Viewers · see progress only</Label>
            <Badge>{viewerIds.length}</Badge>
          </div>
          <PeoplePicker
            label="Viewers"
            people={directory}
            selectedIds={viewerIds}
            onChange={setViewerIds}
            mode="viewer"
            excludeIds={assigneeIds}
            placeholder={peopleLoading ? "Loading people…" : "Search by name or email"}
          />
        </div>
      </section>

      {rescheduleWarning ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-lg)] bg-lemon p-3.5 text-[13px] text-lemon-ink">
          <span className="min-w-0 flex-1">{rescheduleWarning}</span>
          <span className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setRescheduleWarning(null)}>
              Keep schedule
            </Button>
            <Button
              type="button"
              variant="ink"
              size="sm"
              onClick={() => {
                setRescheduleWarning(null);
                void handleSave({ confirmReschedule: true });
              }}
            >
              Change schedule
            </Button>
          </span>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-[var(--radius-lg)] bg-peach p-3.5 text-[13px] text-peach-ink">{error}</div>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-5">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="button" variant="ink" onClick={() => void handleSave()} disabled={!canSave}>
          {saving ? "Saving…" : editing ? "Save changes" : "Share goal"}
        </Button>
      </div>

      <ComposeWidgetModal
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        spec={{ ...(spec || {}), goalId: DRAFT_ID, title: title.trim() || "Shared goal" }}
        goal={{ id: DRAFT_ID, title: title.trim() || "Shared goal", description }}
        submitLabel="Use this plan"
        onSubmitSpec={async (next) => {
          const { goalId: _g, approval: _a, ...rest } = next;
          setSpec(rest);
          setSpecChanged(true);
        }}
      />
    </Card>
  );
}
