"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { Badge, Button, Checkbox } from "@/components/ui";
import { useRepoOptions } from "@/features/integrations";

/**
 * Multi-select repository picker for BYO context questions.
 *
 * Replaces the free-text "owner/name" textarea: the option list comes
 * from the connected providers (full repo list, recently-merged-into
 * repos pinned first — see `useRepoOptions`), rendered as accessible
 * `Checkbox` rows with a filter box. A free-text add path stays for
 * unconnected providers and repos outside the listed page.
 *
 * `value` is the context answer (string[] — same storage shape as
 * "list"/"resource_link"; a legacy newline-joined string is accepted and
 * re-emitted as an array). Selection is capped at MAX_REPOS to match
 * the server's fan-out budget (`MAX_ANSWER_VALUES` in query-runner.ts).
 */
const MAX_REPOS = 10;
const MAX_VISIBLE_OPTIONS = 40;
// Client-side mirror of the registry's validateRepoSlug: 2-3 non-empty
// segments, no spaces, ≤120 chars. The server re-validates regardless.
const REPO_SLUG_RE = /^[^\s/]+\/[^\s/]+(?:\/[^\s/]+)?$/;

/**
 * Should this context question render the repo picker? True for the
 * explicit `repo_select` kind, plus a heuristic fallback so specs
 * composed before the kind existed (resource_link with the classic
 * "owner/name" placeholder or a `repo` id) get the picker too.
 */
export function isRepoQuestion(q) {
  if (!q) return false;
  if (q.kind === "repo_select") return true;
  return (
    q.kind === "resource_link" &&
    (q.id === "repo" || /owner\s*\/\s*(name|repo)/i.test(q.placeholder || ""))
  );
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

export function RepoMultiPicker({ value, onChange, onBlur }) {
  const { options, recentSet, isLoading, connected } = useRepoOptions();
  const [query, setQuery] = useState("");

  const selected = useMemo(() => toSelection(value), [value]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  // Selects/checkboxes commit immediately when the collector saves on
  // blur — same convention as the `select` kind in QuestionField.
  function emit(next) {
    onChange(next);
    if (onBlur) setTimeout(onBlur, 0);
  }

  function toggle(slug) {
    if (selectedSet.has(slug)) {
      emit(selected.filter((s) => s !== slug));
      return;
    }
    if (selected.length >= MAX_REPOS) return;
    emit([...selected, slug]);
  }

  const trimmedQuery = query.trim().toLowerCase();
  const canAddQuery =
    trimmedQuery.length > 0 &&
    trimmedQuery.length <= 120 &&
    REPO_SLUG_RE.test(trimmedQuery) &&
    !selectedSet.has(trimmedQuery) &&
    selected.length < MAX_REPOS;

  function addFromQuery() {
    if (!canAddQuery) return;
    emit([...selected, trimmedQuery]);
    setQuery("");
  }

  const filtered = useMemo(() => {
    const base = trimmedQuery
      ? options.filter((o) => o.includes(trimmedQuery))
      : options;
    return base.slice(0, MAX_VISIBLE_OPTIONS);
  }, [options, trimmedQuery]);

  return (
    <div className="flex flex-col gap-2">
      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((slug) => (
            <button key={slug} type="button" onClick={() => toggle(slug)} title={`Remove ${slug}`} className="inline-flex">
              <Badge tone="lav">
                {slug}
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
          placeholder={options.length > 0 ? "Filter or type owner/name…" : "owner/name"}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canAddQuery) {
              e.preventDefault();
              addFromQuery();
            }
          }}
          className="w-full rounded-[var(--radius-lg)] bg-card-alt px-3 py-2 text-[13.5px] text-fg outline-none placeholder:text-dim-fg focus:ring-2 focus:ring-ink"
          aria-label="Filter repositories or type owner/name to add"
        />
        <Button type="button" variant="soft" size="sm" onClick={addFromQuery} disabled={!canAddQuery}>
          Add
        </Button>
      </div>

      {filtered.length > 0 ? (
        <ul className="flex max-h-36 flex-col gap-1 overflow-y-auto pr-1" aria-label="Repositories">
          {filtered.map((slug) => {
            const checked = selectedSet.has(slug);
            const capped = !checked && selected.length >= MAX_REPOS;
            return (
              <li key={slug}>
                <label
                  className={`flex cursor-pointer items-center gap-2 rounded-[var(--radius-lg)] bg-card-alt px-2.5 py-1.5 text-[13px] text-fg ${capped ? "opacity-50" : ""}`}
                >
                  <Checkbox checked={checked} onChange={() => (capped ? null : toggle(slug))} label={slug} />
                  <span className="min-w-0 flex-1 truncate">{slug}</span>
                  {recentSet.has(slug) ? <Badge>Recent</Badge> : null}
                </label>
              </li>
            );
          })}
        </ul>
      ) : null}

      <div className="text-[12px] leading-[1.4] text-muted-fg">
        {isLoading
          ? "Loading your repositories…"
          : !connected && options.length === 0
            ? "No code host connected — type owner/name and press Add."
            : `${selected.length}/${MAX_REPOS} selected${
                options.length > MAX_VISIBLE_OPTIONS && filtered.length >= MAX_VISIBLE_OPTIONS
                  ? " · type to narrow the list"
                  : ""
              }`}
      </div>
    </div>
  );
}
