"use client";

import { useMemo } from "react";
import { Badge } from "@/components/ui";
import { WidgetShell, TargetChip } from "../widget-shell";
import { useDataSource } from "../data-sources/use-data-source";
import { evalTarget } from "./merged-count-widget";
import { ComplianceLine } from "../compliance-line";
import { usePublishGoalReading } from "../use-publish-reading";
import { useGoalContext } from "@/features/goal-context";

/**
 * Labelled pull requests — merged PRs carrying one of the watched labels.
 *
 * Headline: share (%) or count of merged PRs in the window that matched
 * Sub:      the split, plus which labels were actually seen
 *
 * One widget, two presets. ASSISTED_SHARE watches the assistant labels by
 * default; LABEL_SHARE watches whatever the spec names or the user picked
 * (a `label_select` context answer). Everything else — the window, the
 * repo scope, the floor caveat — is identical, so it is one component.
 *
 * The honest framing matters more than usual here, because the number is
 * easy to over-read. A label says someone CLAIMED something about a pull
 * request — an assistant that it helped, a bot that the PR fixes a bug —
 * and a qualifying merge that was never labelled is invisible. So the
 * figure is a floor rather than a measurement, and the widget, the
 * reading and the grader all say so.
 */
export function LabelShareWidget({
  spec,
  goal,
  variant = "light",
  className,
  onRetry,
  assisted = false,
}) {
  const { answers } = useGoalContext(goal?.id);

  // A spec that asked the user which labels to watch stores the answer as
  // context, not on the source. Fold it in here so `useDataSource` sees one
  // shape — the same resolution order the snapshot capture applies.
  const source = useMemo(() => {
    const base = spec.source || null;
    if (!base || (Array.isArray(base.labels) && base.labels.length > 0)) return base;
    const picked = labelAnswers(spec, answers);
    return picked.length > 0 ? { ...base, labels: picked } : base;
  }, [spec, answers]);

  const { data, isLoading, error, windowLabel, provenance } = useDataSource(source);
  const mode = data?.mode === "count" ? "count" : "share";
  const pct = data?.pct ?? null;
  const hits = data?.assisted ?? 0;
  const total = data?.total ?? 0;
  const matched = Array.isArray(data?.matched) ? data.matched : [];
  const watched = Array.isArray(data?.watchedLabels) ? data.watchedLabels : [];
  const needsLabels = Boolean(data?.needsLabels);
  const target = spec.source?.target;
  const headline = mode === "count" ? (total > 0 ? hits : null) : pct;
  const unit = mode === "count" ? "PRs" : "%";
  const meets = target && headline != null ? evalTarget(headline, target) : null;

  // Nothing matched across a non-empty window is ambiguous: either nothing
  // qualified, or the team labels it something this goal is not watching.
  // Saying "0" alone would pick the first reading silently.
  const noneMatched = headline === 0 && total > 0;
  const noun = assisted ? "assisted" : "labelled";

  usePublishGoalReading(
    goal?.id,
    spec.widget,
    !isLoading && !error && headline != null
      ? {
          value:
            (mode === "count"
              ? `${hits} of ${total} merged PRs ${noun}`
              : `${pct}% of merged PRs ${noun} · ${hits} of ${total}`) +
            (matched.length ? ` · labels seen: ${matched.join(", ")}` : "") +
            (noneMatched ? ` · no PR carried ${watched.join(" or ")}` : ""),
          score: headline,
          unit,
          statusTone: meets === true ? "ok" : meets === false ? "warn" : "accent",
          statusLabel: meets === true ? "on target" : meets === false ? "below target" : "tracked",
          provenance,
        }
      : null,
  );

  return (
    <WidgetShell
      spec={spec}
      provenance={provenance}
      variant={variant}
      label={`${assisted ? "Assisted merges" : "Labelled merges"} · ${windowLabel}`}
      title={goal?.title || spec.title}
      rightChip={<TargetChip target={target} unit={unit} variant={variant} />}
      onRetry={onRetry}
      className={className}
    >
      <div className="flex h-full flex-col justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <div className="text-[30px] font-extrabold leading-none tracking-[-0.04em] tabular-nums text-fg sm:text-[36px]">
            {isLoading
              ? "…"
              : headline == null
                ? "—"
                : mode === "count"
                  ? headline
                  : `${headline}%`}
          </div>
          {error ? (
            <Badge tone="neutral" className="ml-auto" title={error?.message || String(error)}>
              Source unavailable
            </Badge>
          ) : needsLabels ? (
            <Badge tone="lemon" className="ml-auto">
              Pick labels
            </Badge>
          ) : meets != null ? (
            <Badge tone={meets ? "mint" : "peach"} className="ml-auto">
              {meets ? "On target" : "Below target"}
            </Badge>
          ) : null}
        </div>

        <div className="flex items-center gap-3 text-[12.5px] text-muted-fg">
          <span>
            {noun}: <strong className="text-fg">{hits}</strong>
          </span>
          <span className="text-dim-fg">·</span>
          <span>
            of <strong className="text-fg">{total}</strong> merged
          </span>
        </div>

        <div className="flex h-2 w-full overflow-hidden rounded-full bg-card-alt">
          <div className="bg-ink" style={{ width: `${pct ?? 0}%` }} />
        </div>

        <p className="text-[11.5px] leading-snug text-dim-fg">
          {needsLabels
            ? "No labels chosen yet. Pick which PR labels this goal should count — edit setup, or answer the label question."
            : noneMatched
              ? `No merged PR carried ${watched.join(" or ")}. That may mean nothing qualified, or a label this goal isn't watching.`
              : matched.length
                ? `Counting ${matched.join(", ")}. Unlabelled ${noun} merges can't be seen, so this is a lower bound.`
                : `Counts merged PRs labelled ${watched.join(" or ")}.`}
        </p>

        <ComplianceLine goalId={goal?.id} variant={variant} />
      </div>
    </WidgetShell>
  );
}

/**
 * The labels a spec's `label_select` question(s) were answered with, in
 * question order. Empty when the spec asked nothing or nothing was answered.
 */
export function labelAnswers(spec, answers) {
  const questions = Array.isArray(spec?.context?.questions) ? spec.context.questions : [];
  const out = [];
  for (const q of questions) {
    if (q?.kind !== "label_select") continue;
    const value = answers?.[q.id];
    const list = Array.isArray(value)
      ? value
      : typeof value === "string"
        ? value.split(/\r?\n/)
        : [];
    for (const item of list) {
      const name = typeof item === "string" ? item.trim().toLowerCase() : "";
      if (name && !out.includes(name)) out.push(name);
    }
  }
  return out;
}
