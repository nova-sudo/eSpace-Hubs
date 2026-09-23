"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { Badge, Button, Checkbox } from "@/components/ui";
import { useLabelOptions } from "@/features/integrations";

/**
 * Multi-select PR-label picker for BYO context questions.
 *
 * The option list is the labels actually seen on the user's merged pull
 * requests this year, most frequent first with a count — so "what could I
 * track with a label?" is answered by their own work, not a repo's label
 * catalogue (see `useLabelOptions`). A free-text add path stays for labels
 * the team is about to start using and for unconnected providers.
 *
 * `value` is the context answer (string[] — same storage shape as
 * "list"/"repo_select"; a legacy newline-joined string is accepted and
 * re-emitted as an array). Selection is capped at MAX_LABELS to match the
 * validator's `MAX_SOURCE_LABELS`.
 */
const MAX_LABELS = 10;
const MAX_VISIBLE_OPTIONS = 40;

/** Should this context question render the label picker? */
export function isLabelQuestion(q) {
  return Boolean(q) && q.kind === "label_select";
}

function toSelection(value) {
  if (Array.isArray(value)) {
    return value.map((s) => String(s).trim().toLowerCase()).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return value
      .split(/\r?\n/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  }
  return [];
}

export function LabelMultiPicker({ value, onChange, onBlur }) {
  const { options, isLoading, connected } = useLabelOptions();
  const [query, setQuery] = useState("");

  const selected = useMemo(() => toSelection(value), [value]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const countFor = useMemo(() => new Map(options.map((o) => [o.label, o.count])), [options]);

  // Checkboxes commit immediately when the collector saves on blur — same
  // convention as the `select` kind and the repo picker.
  function emit(next) {
    onChange(next);
    if (onBlur) setTimeout(onBlur, 0);
  }

  function toggle(label) {
    if (selectedSet.has(label)) {
      emit(selected.filter((s) => s !== label));
      return;
    }
    if (selected.length >= MAX_LABELS) return;
    emit([...selected, label]);
  }

  const trimmedQuery = query.trim().toLowerCase();
  const canAddQuery =
    trimmedQuery.length > 0 &&
    trimmedQuery.length <= 100 &&
    !selectedSet.has(trimmedQuery) &&
    selected.length < MAX_LABELS;

  function addFromQuery() {
    if (!canAddQuery) return;
    emit([...selected, trimmedQuery]);
    setQuery("");
  }

  const filtered = useMemo(() => {
    const base = trimmedQuery
      ? options.filter((o) => o.label.includes(trimmedQuery))
      : options;
    return base.slice(0, MAX_VISIBLE_OPTIONS);
  }, [options, trimmedQuery]);

  return (
    <div className="flex flex-col gap-2">
      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((label) => (
            <button key={label} type="button" onClick={() => toggle(label)} title={`Remove ${label}`} className="inline-flex">
              <Badge tone="lav">
                {label}
                {countFor.has(label) ? <span className="opacity-70">· {countFor.get(label)}</span> : null}
                <X size={11} />
              </Badge>
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={query}
          placeholder={options.length > 0 ? "Filter or type a label…" : "label name"}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canAddQuery) {
              e.preventDefault();
              addFromQuery();
            }
          }}
          className="w-full rounded-[var(--radius-lg)] bg-card-alt px-3 py-2 text-[13.5px] text-fg outline-none placeholder:text-dim-fg focus:ring-2 focus:ring-ink"
          aria-label="Filter labels or type a label name to add"
        />
        <Button type="button" variant="soft" size="sm" onClick={addFromQuery} disabled={!canAddQuery}>
          Add
        </Button>
      </div>

      {filtered.length > 0 ? (
        <ul className="flex max-h-36 flex-col gap-1 overflow-y-auto pr-1" aria-label="Labels seen on your merged PRs">
          {filtered.map(({ label, count }) => {
            const checked = selectedSet.has(label);
            const capped = !checked && selected.length >= MAX_LABELS;
            return (
              <li key={label}>
                <label
                  className={`flex cursor-pointer items-center gap-2 rounded-[var(--radius-lg)] bg-card-alt px-2.5 py-1.5 text-[13px] text-fg ${capped ? "opacity-50" : ""}`}
                >
                  <Checkbox checked={checked} onChange={() => (capped ? null : toggle(label))} label={label} />
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                  <Badge title={`${count} merged PR${count === 1 ? "" : "s"} this year`}>{count}</Badge>
                </label>
              </li>
            );
          })}
        </ul>
      ) : null}

      <div className="text-[12px] leading-[1.4] text-muted-fg">
        {isLoading
          ? "Reading the labels on your merged PRs…"
          : !connected && options.length === 0
            ? "No code host connected — type a label and press Add."
            : options.length === 0
              ? "No labels on your merged PRs this year yet — type one and press Add."
              : `${selected.length}/${MAX_LABELS} selected · counts are merged PRs this year${
                  options.length > MAX_VISIBLE_OPTIONS && filtered.length >= MAX_VISIBLE_OPTIONS
                    ? " · type to narrow the list"
                    : ""
                }`}
      </div>
    </div>
  );
}
