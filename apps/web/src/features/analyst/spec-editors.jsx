"use client";

/**
 * Shared spec-setup editors.
 *
 * These were born inside the Review pane (where they edit a PENDING,
 * freshly-classified spec before commit). They're extracted here so a
 * SECOND surface — the per-widget "edit setup" modal (goal-widgets) —
 * can reuse the exact same controls to edit a COMMITTED spec in place.
 * One editor, two entry points; no drift.
 *
 * Two layers:
 *   - Low-level pieces (`ScorecardEditor`, `ComponentEditorRow`,
 *     `RepoPicker`, `JobPicker`, `RubricCriteriaEditor`, `patchFilter`,
 *     `defaultSourceFor`, `defaultManualFor`) — take options as props,
 *     no data fetching. The Review pane imports these and feeds its own
 *     repo/job option lists.
 *   - `SpecSetupEditor` — a self-contained wrapper that fetches its own
 *     repo/job options and renders the right editor for a whole spec
 *     (ScorecardEditor for SCORECARD, a target + scope editor for a
 *     single-widget spec). The edit-setup modal uses this.
 */

import { useMemo } from "react";
import { Select, Checkbox } from "@/components/ui";
import { SPEC_KIND_META, SPEC_VARIANTS, ALL_SPEC_KINDS } from "@/features/goal-specs";
import {
  useCombinedMergedSince,
  listReposFromMrs,
  useJenkinsJobs,
} from "@/features/integrations";
import { isoDaysAgo } from "@/lib/date";

/**
 * Apply a `source.filter[key]` change to a spec.source, returning the
 * new source object (or null when filter would become empty). Null /
 * empty value deletes the key; a non-empty value sets it.
 */
export function patchFilter(source, key, value) {
  if (!source) return null;
  if (!value) {
    if (!source.filter) return source;
    const next = { ...source.filter };
    delete next[key];
    return {
      ...source,
      filter: Object.keys(next).length > 0 ? next : null,
    };
  }
  return {
    ...source,
    filter: { ...(source.filter || {}), [key]: value },
  };
}

/**
 * Repo scope chip. Dropdown when we discovered repo names from the
 * user's merged-PR history; free-text input otherwise so the field is
 * never useless. "All repos" is always the first dropdown option and
 * maps to null on the spec (clears the filter).
 */
export function RepoPicker({ value, options, onChange }) {
  const hasOptions = options.length > 0;
  const allOptions = useMemo(() => {
    const out = [...options];
    if (value && !out.includes(value)) out.unshift(value);
    return out;
  }, [options, value]);

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-[var(--radius-sub)] px-2.5 py-1.5"
      style={{
        background: "var(--panel-2)",
        border: "1px solid var(--border)",
      }}
    >
      <span
        className="uppercase tracking-[0.5px]"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9,
          color: "var(--dim-fg)",
        }}
      >
        Repo scope
      </span>
      {hasOptions ? (
        <Select
          tone="default"
          size="sm"
          value={value || ""}
          onChange={(e) => onChange(e.target.value || null)}
        >
          <option value="">All repos</option>
          {allOptions.map((slug) => (
            <option key={slug} value={slug}>
              {slug}
            </option>
          ))}
        </Select>
      ) : (
        <input
          type="text"
          value={value || ""}
          onChange={(e) => onChange(e.target.value.trim() || null)}
          placeholder="owner/name (leave empty for all)"
          className="flex-1 outline-none"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            color: "var(--fg)",
            background: "var(--field)",
            border: "1px solid var(--border-strong)",
            borderRadius: "var(--radius-sub)",
            padding: "2px 6px",
            minWidth: 200,
          }}
        />
      )}
      {value ? (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="uppercase transition-colors hover:opacity-90"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 9,
            letterSpacing: "0.5px",
            color: "var(--dim-fg)",
          }}
          title="Drop the repo filter — count across every connected repo."
        >
          clear
        </button>
      ) : null}
    </div>
  );
}

/**
 * Jenkins job picker — required for the three CI/CD AUTO widgets when
 * `source.provider === "jenkins"`. Same UX skeleton as RepoPicker but
 * labelled "Job scope".
 */
export function JobPicker({ value, options, onChange }) {
  const hasOptions = options.length > 0;
  const allOptions = useMemo(() => {
    const out = [...options];
    if (value && !out.includes(value)) out.unshift(value);
    return out;
  }, [options, value]);

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-[var(--radius-sub)] px-2.5 py-1.5"
      style={{
        background: "var(--panel-2)",
        border: "1px solid var(--border)",
      }}
    >
      <span
        className="uppercase tracking-[0.5px]"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9,
          color: "var(--dim-fg)",
        }}
      >
        Job scope
      </span>
      {hasOptions ? (
        <Select
          tone="default"
          size="sm"
          value={value || ""}
          onChange={(e) => onChange(e.target.value || null)}
        >
          <option value="">(pick a job)</option>
          {allOptions.map((slug) => (
            <option key={slug} value={slug}>
              {slug}
            </option>
          ))}
        </Select>
      ) : (
        <input
          type="text"
          value={value || ""}
          onChange={(e) => onChange(e.target.value.trim() || null)}
          placeholder="job-name"
          className="flex-1 outline-none"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            color: "var(--fg)",
            background: "var(--field)",
            border: "1px solid var(--border-strong)",
            borderRadius: "var(--radius-sub)",
            padding: "2px 6px",
            minWidth: 200,
          }}
        />
      )}
      {value ? (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="uppercase transition-colors hover:opacity-90"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 9,
            letterSpacing: "0.5px",
            color: "var(--dim-fg)",
          }}
          title="Drop the job filter — widget will show 'needs scope' until you pick a job."
        >
          clear
        </button>
      ) : null}
    </div>
  );
}

// ─── SCORECARD sub-editor ─────────────────────────────────────────

const SCORECARD_COMPONENT_WIDGETS = ALL_SPEC_KINDS.filter(
  (k) => k !== "SCORECARD",
);

const SCORECARD_MAX_COMPONENTS = 3;
const SCORECARD_MIN_COMPONENTS = 2;

/**
 * Per-component editor for a SCORECARD spec. Stacked rows, one per
 * component, each exposing widget kind, weight, target threshold, and
 * (for code-host components) repo scope. Add/remove respect the 2–3 cap.
 */
export function ScorecardEditor({ scorecard, repoOptions = [], onChange }) {
  const components = scorecard?.components || [];

  function setComponentAt(index, patch) {
    const next = components.map((c, i) =>
      i === index ? { ...c, ...patch } : c,
    );
    onChange({ ...(scorecard || {}), components: next, aggregate: "weighted" });
  }

  function removeAt(index) {
    if (components.length <= SCORECARD_MIN_COMPONENTS) return;
    const next = components.filter((_, i) => i !== index);
    onChange({ ...(scorecard || {}), components: next, aggregate: "weighted" });
  }

  function addComponent() {
    if (components.length >= SCORECARD_MAX_COMPONENTS) return;
    const evenWeight = Math.round(100 / (components.length + 1));
    const fresh = {
      label: "",
      weight: evenWeight,
      widget: "MERGED_COUNT",
      kind: "auto",
      source: {
        provider: "combined",
        metric: "merged_count",
        window: "30d",
        target: null,
      },
      manual: null,
    };
    onChange({
      ...(scorecard || {}),
      components: [...components, fresh],
      aggregate: "weighted",
    });
  }

  return (
    <div
      className="flex flex-col gap-2 rounded-[var(--radius-sub)] px-2.5 py-2"
      style={{
        background: "var(--panel-2)",
        border: "1px solid var(--border)",
      }}
    >
      <div className="flex items-center justify-between">
        <span
          className="uppercase tracking-[0.5px]"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 9,
            color: "var(--dim-fg)",
          }}
        >
          Scorecard components ({components.length}/{SCORECARD_MAX_COMPONENTS})
        </span>
        <button
          type="button"
          onClick={addComponent}
          disabled={components.length >= SCORECARD_MAX_COMPONENTS}
          className="uppercase transition-opacity hover:opacity-90 disabled:opacity-30"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 9.5,
            letterSpacing: "0.5px",
            color: "var(--accent)",
            cursor:
              components.length >= SCORECARD_MAX_COMPONENTS
                ? "not-allowed"
                : "pointer",
          }}
        >
          + Add component
        </button>
      </div>
      {components.map((c, i) => (
        <ComponentEditorRow
          key={i}
          index={i}
          component={c}
          repoOptions={repoOptions}
          onPatch={(patch) => setComponentAt(i, patch)}
          onRemove={() => removeAt(i)}
          canRemove={components.length > SCORECARD_MIN_COMPONENTS}
        />
      ))}
    </div>
  );
}

/**
 * One editable row inside the ScorecardEditor. Fields: label, widget
 * dropdown, weight number, target op + value, repo scope, and (for
 * CODE_RUBRIC) an inline criteria editor. Picking a different widget
 * reseeds a sensible default source/manual so the spec stays valid.
 */
export function ComponentEditorRow({
  index,
  component,
  repoOptions = [],
  onPatch,
  onRemove,
  canRemove,
}) {
  const target =
    component?.source?.target || component?.manual?.target || null;
  const provider = component?.source?.provider;
  const supportsRepoScope =
    component?.kind === "auto" &&
    (provider === "github" ||
      provider === "gitlab" ||
      provider === "combined" ||
      provider === "github_actions");
  const currentRepo = component?.source?.filter?.repo || null;
  const onChangeRepo = (next) => {
    onPatch({ source: patchFilter(component.source, "repo", next) });
  };

  function setWidget(widget) {
    const meta = SPEC_KIND_META[widget];
    const variant = meta?.variant || SPEC_VARIANTS.AUTO;
    const patch = { widget, kind: variant };
    if (widget === "CODE_RUBRIC") {
      patch.source = null;
      patch.manual = {
        prompt: "Grade against rubric",
        cadence: "continuous",
        items: [],
      };
    } else if (variant === SPEC_VARIANTS.AUTO) {
      patch.source = defaultSourceFor(widget);
      patch.manual = null;
    } else {
      patch.source = null;
      patch.manual = defaultManualFor(widget);
    }
    onPatch(patch);
  }

  function setTarget(op, value) {
    const numeric = Number(value);
    const t = Number.isFinite(numeric) && value !== "" ? { op, value: numeric } : null;
    if (component.kind === SPEC_VARIANTS.AUTO) {
      onPatch({ source: { ...(component.source || {}), target: t } });
    } else {
      onPatch({ manual: { ...(component.manual || {}), target: t } });
    }
  }

  return (
    <div
      className="flex flex-col gap-1.5 rounded-[var(--radius-sub)] px-2 py-1.5"
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="uppercase tracking-[0.5px]"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 9,
            color: "var(--dim-fg)",
          }}
        >
          #{index + 1}
        </span>
        <input
          type="text"
          value={component.label || ""}
          onChange={(e) => onPatch({ label: e.target.value.slice(0, 24) })}
          placeholder="label"
          className="flex-1 bg-transparent outline-none"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--fg)",
            borderBottom: "1px dashed var(--border-strong)",
            paddingBottom: 1,
            minWidth: 120,
          }}
        />
        <button
          type="button"
          onClick={onRemove}
          disabled={!canRemove}
          className="uppercase transition-opacity disabled:opacity-25"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 9,
            letterSpacing: "0.5px",
            color: "var(--muted-fg)",
            cursor: canRemove ? "pointer" : "not-allowed",
          }}
          title={
            canRemove
              ? "Remove this component"
              : `Need at least ${SCORECARD_MIN_COMPONENTS} components`
          }
        >
          ✕ remove
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Select
          tone="default"
          size="sm"
          value={component.widget}
          onChange={(e) => setWidget(e.target.value)}
        >
          {SCORECARD_COMPONENT_WIDGETS.map((k) => (
            <option key={k} value={k}>
              {SPEC_KIND_META[k]?.label || k}
            </option>
          ))}
        </Select>
        <label
          className="flex items-center gap-1"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--muted-fg)",
          }}
        >
          weight
          <input
            type="number"
            min={0}
            max={100}
            value={component.weight ?? 0}
            onChange={(e) => onPatch({ weight: Number(e.target.value) || 0 })}
            className="w-12 text-right outline-none"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              border: "1px solid var(--border-strong)",
              borderRadius: "var(--radius-sub)",
              padding: "2px 4px",
              color: "var(--fg)",
              background: "var(--field)",
            }}
          />
        </label>
        <label
          className="flex items-center gap-1"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--muted-fg)",
          }}
        >
          target
          <Select
            tone="default"
            size="sm"
            value={target?.op || ">="}
            onChange={(e) => setTarget(e.target.value, target?.value ?? "")}
          >
            <option value=">=">≥</option>
            <option value="<=">≤</option>
            <option value="=">=</option>
          </Select>
          <input
            type="number"
            value={target?.value ?? ""}
            onChange={(e) => setTarget(target?.op || ">=", e.target.value)}
            placeholder="value"
            className="w-16 text-right outline-none"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              border: "1px solid var(--border-strong)",
              borderRadius: "var(--radius-sub)",
              padding: "2px 4px",
              color: "var(--fg)",
              background: "var(--field)",
            }}
          />
        </label>
      </div>
      {supportsRepoScope ? (
        <RepoPicker
          value={currentRepo}
          options={repoOptions}
          onChange={onChangeRepo}
        />
      ) : null}
      {component.widget === "CODE_RUBRIC" ? (
        <RubricCriteriaEditor
          criteria={component.manual?.items || []}
          firstReviewOnly={component.firstReviewOnly === true}
          onPatchCriteria={(items) =>
            onPatch({
              manual: {
                ...(component.manual || {
                  prompt: "Grade against rubric",
                  cadence: "continuous",
                }),
                items,
              },
            })
          }
          onToggleFirstReviewOnly={(next) =>
            onPatch({ firstReviewOnly: next })
          }
        />
      ) : null}
    </div>
  );
}

/**
 * Inline criteria editor used by CODE_RUBRIC scorecard components.
 * One criterion per line; a "first-review only" toggle flips the
 * component's `firstReviewOnly` boolean.
 */
export function RubricCriteriaEditor({
  criteria,
  firstReviewOnly,
  onPatchCriteria,
  onToggleFirstReviewOnly,
}) {
  const text = (criteria || []).join("\n");
  return (
    <div
      className="flex flex-col gap-1.5 pt-1.5"
      style={{ borderTop: "1px solid var(--border)" }}
    >
      <span
        className="uppercase tracking-[0.5px]"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9,
          color: "var(--dim-fg)",
        }}
      >
        Rubric criteria — one per line
      </span>
      <textarea
        rows={3}
        value={text}
        onChange={(e) => {
          const items = e.target.value
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean);
          onPatchCriteria(items);
        }}
        placeholder="meaningful tests&#10;no any types&#10;all branches handled"
        className="w-full outline-none"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10.5,
          color: "var(--fg)",
          background: "var(--field)",
          border: "1px solid var(--border-strong)",
          borderRadius: "var(--radius-sub)",
          padding: "4px 6px",
          resize: "vertical",
        }}
      />
      <label
        className="flex items-center gap-1.5"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: "var(--muted-fg)",
        }}
        title="Grade each PR against its FIRST review-round comments only."
      >
        <Checkbox
          checked={firstReviewOnly}
          onChange={() => onToggleFirstReviewOnly(!firstReviewOnly)}
        />
        <span>Grade first-review state only</span>
      </label>
    </div>
  );
}

/**
 * Pick a sensible default `source` for a freshly-set AUTO widget.
 * The validator runs the full source check on save; this just gives
 * a starting shape so the spec is valid the moment the widget changes.
 */
export function defaultSourceFor(widget) {
  const window = "30d";
  switch (widget) {
    case "MERGED_COUNT":
      return { provider: "combined", metric: "merged_count", window, target: null };
    case "REVIEW_ROUNDS":
      return { provider: "combined", metric: "avg_rounds", window, target: null };
    case "TURNAROUND":
      return { provider: "combined", metric: "median_turnaround", window, target: null };
    case "LINKAGE":
      return { provider: "combined", metric: "linkage_pct", window, target: null };
    case "TICKET_CYCLE":
      return { provider: "jira", metric: "ticket_cycle_time", window, target: null };
    case "FIRST_PASS_RATE":
      return { provider: "combined", metric: "first_pass_rate", window, target: null };
    case "DEPLOY_FREQUENCY":
      return { provider: "github_actions", metric: "deploy_frequency", window, target: null };
    case "LEAD_TIME":
      return { provider: "github_actions", metric: "lead_time", window, target: null };
    case "BUILD_PASS_RATE":
      return { provider: "github_actions", metric: "build_pass_rate", window, target: null };
    default:
      return { provider: "combined", metric: "merged_count", window, target: null };
  }
}

/**
 * Pick a sensible default `manual` for a freshly-set MANUAL widget.
 */
export function defaultManualFor(widget) {
  switch (widget) {
    case "COUNTER":
      return { prompt: "Log a count", cadence: "weekly", target: null };
    case "SCALE":
      return { prompt: "Rate 1–5", cadence: "weekly", target: null };
    case "MILESTONE":
      return { prompt: "Check off milestones", cadence: "milestone", target: null };
    case "DATE_LOG":
      return { prompt: "Log dated events", cadence: "per-incident", target: null };
    case "FREE_TEXT":
      return { prompt: "Reflect", cadence: "weekly", target: null };
    case "BEFORE_AFTER":
      return { prompt: "Baseline vs current", cadence: "quarterly", target: null };
    case "INCIDENT_LOG":
      return { prompt: "Log this incident.", cadence: "per-incident", target: null };
    case "RECURRING_MILESTONE":
      return { prompt: "Tick items this period.", cadence: "quarterly", target: null };
    default:
      return { prompt: "Log a value", cadence: "weekly", target: null };
  }
}

// ─── Single-widget target + scope editor ──────────────────────────

const PERCENT_WIDGETS = new Set([
  "FIRST_PASS_RATE",
  "LINKAGE",
  "BUILD_PASS_RATE",
  "MILESTONE",
  "RECURRING_MILESTONE",
  "CODE_RUBRIC",
]);
const DAY_WIDGETS = new Set(["TURNAROUND", "TICKET_CYCLE"]);

/** Human unit suffix for a widget's target value. */
function unitForWidget(widget) {
  if (PERCENT_WIDGETS.has(widget)) return "%";
  if (DAY_WIDGETS.has(widget)) return "d";
  if (widget === "LEAD_TIME") return "m";
  return "";
}

/** The active target block on a single-widget spec (source or manual). */
function currentTarget(spec) {
  return spec?.source?.target || spec?.manual?.target || null;
}

/** Return a NEW spec with the target set on whichever block it owns. */
function withTarget(spec, t) {
  if (spec?.source) return { ...spec, source: { ...spec.source, target: t } };
  if (spec?.manual) return { ...spec, manual: { ...spec.manual, target: t } };
  return spec;
}

/**
 * Target op + value editor for a single-widget spec. Clearing the value
 * sets the target to null (no rule — the widget just tracks the number).
 */
export function TargetEditor({ spec, onChange }) {
  const target = currentTarget(spec);
  const unit = unitForWidget(spec?.widget);

  function setTarget(op, value) {
    const numeric = Number(value);
    const t =
      Number.isFinite(numeric) && value !== "" ? { op, value: numeric } : null;
    onChange(withTarget(spec, t));
  }

  return (
    <div
      className="flex flex-col gap-1.5 rounded-[var(--radius-sub)] px-2.5 py-2"
      style={{ background: "var(--panel-2)", border: "1px solid var(--border)" }}
    >
      <span
        className="uppercase tracking-[0.5px]"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9,
          color: "var(--dim-fg)",
        }}
      >
        Target {unit ? `(${unit})` : ""}
      </span>
      <div className="flex items-center gap-1.5">
        <Select
          tone="default"
          size="sm"
          value={target?.op || ">="}
          onChange={(e) => setTarget(e.target.value, target?.value ?? "")}
        >
          <option value=">=">≥ at least</option>
          <option value="<=">≤ at most</option>
          <option value="=">= exactly</option>
        </Select>
        <input
          type="number"
          value={target?.value ?? ""}
          onChange={(e) => setTarget(target?.op || ">=", e.target.value)}
          placeholder="value"
          className="w-24 text-right outline-none"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            border: "1px solid var(--border-strong)",
            borderRadius: "var(--radius-sub)",
            padding: "3px 6px",
            color: "var(--fg)",
            background: "var(--field)",
          }}
        />
        {target ? (
          <button
            type="button"
            onClick={() => onChange(withTarget(spec, null))}
            className="uppercase transition-colors hover:opacity-90"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9,
              letterSpacing: "0.5px",
              color: "var(--dim-fg)",
            }}
            title="Drop the target — just track the number, no rule."
          >
            clear
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Self-contained "edit this spec's setup" editor. Fetches its own repo /
 * job option lists and renders the right sub-editor for the whole spec:
 *   - SCORECARD           → per-component weights / targets / scope
 *   - AUTO code/CI widget → target + repo/job scope
 *   - AUTO/MANUAL w/ target→ target
 *   - anything else       → a note pointing at re-analyze / build-your-own
 *
 * `onChange(nextSpec)` receives a full, updated spec on every edit; the
 * caller decides when to persist (Save) and how (saveSpec, replace, …).
 */
export function SpecSetupEditor({ spec, onChange }) {
  const merged90 = useCombinedMergedSince(isoDaysAgo(90));
  const repoOptions = useMemo(
    () => listReposFromMrs(merged90.data || []),
    [merged90.data],
  );
  const { jobs } = useJenkinsJobs();
  const jobOptions = useMemo(
    () =>
      (jobs || [])
        .map((j) => (j && typeof j.name === "string" ? j.name : null))
        .filter(Boolean)
        .sort(),
    [jobs],
  );

  if (!spec) return null;

  // SCORECARD — the full per-component editor (weights + targets + scope).
  if (spec.widget === "SCORECARD") {
    return (
      <ScorecardEditor
        scorecard={spec.scorecard}
        repoOptions={repoOptions}
        onChange={(nextScorecard) => {
          // Keep the outer kind in sync with the components (validator
          // cross-check): hybrid if any MANUAL component, else auto.
          const anyManual = (nextScorecard?.components || []).some(
            (c) => c.kind === "manual",
          );
          onChange({
            ...spec,
            scorecard: nextScorecard,
            kind: anyManual ? "hybrid" : "auto",
          });
        }}
      />
    );
  }

  const provider = spec.source?.provider;
  const showRepo =
    spec.kind !== "manual" &&
    (provider === "github" ||
      provider === "gitlab" ||
      provider === "combined" ||
      provider === "github_actions");
  const showJob = spec.kind !== "manual" && provider === "jenkins";
  const hasTargetSlot = Boolean(spec.source || spec.manual);

  if (!hasTargetSlot) {
    return (
      <div
        className="rounded-[var(--radius-sub)] px-2.5 py-2"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10.5,
          lineHeight: 1.5,
          color: "var(--muted-fg)",
          background: "var(--panel-2)",
          border: "1px solid var(--border)",
        }}
      >
        This widget has no numeric target or weights to edit. Use{" "}
        <strong>re-analyze</strong> to change how it's tracked, or{" "}
        <strong>edit truths</strong> for rubric criteria.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <TargetEditor spec={spec} onChange={onChange} />
      {showRepo ? (
        <RepoPicker
          value={spec.source?.filter?.repo || null}
          options={repoOptions}
          onChange={(repo) =>
            onChange({ ...spec, source: patchFilter(spec.source, "repo", repo) })
          }
        />
      ) : null}
      {showJob ? (
        <JobPicker
          value={spec.source?.filter?.job || null}
          options={jobOptions}
          onChange={(job) =>
            onChange({ ...spec, source: patchFilter(spec.source, "job", job) })
          }
        />
      ) : null}
    </div>
  );
}
