"use client";

/**
 * Search-and-pick for the org directory. Selected people sit as removable
 * chips above the search; matches list below it. In `assignee` mode anyone
 * without a Goals page (manager/admin-only accounts) is listed but can't be
 * picked — they can still be added as a viewer.
 */

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { Badge, Input } from "@/components/ui";
import { cn } from "@/lib/cn";

const MAX_MATCHES = 8;

export function PeoplePicker({
  people,
  selectedIds,
  onChange,
  mode = "assignee",
  excludeIds = [],
  placeholder = "Search by name or email",
  label,
}) {
  const [query, setQuery] = useState("");
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const selected = new Set(selectedIds);
  const excluded = new Set(excludeIds);

  const q = query.trim().toLowerCase();
  const matches = q
    ? people
        .filter((p) => !selected.has(p.id) && !excluded.has(p.id))
        .filter(
          (p) =>
            (p.displayName || "").toLowerCase().includes(q) ||
            (p.email || "").toLowerCase().includes(q),
        )
        .slice(0, MAX_MATCHES)
    : [];

  function add(p) {
    if (mode === "assignee" && !p.canFill) return;
    onChange([...selectedIds, p.id]);
    setQuery("");
  }

  function remove(id) {
    onChange(selectedIds.filter((x) => x !== id));
  }

  return (
    <div className="flex flex-col gap-2">
      {selectedIds.length > 0 ? (
        <div className="flex flex-wrap gap-1.5" aria-label={label}>
          {selectedIds.map((id) => {
            const p = byId.get(id);
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1 rounded-[var(--radius-pill)] bg-card-alt py-1 pl-3 pr-1 text-[13px] font-semibold text-fg"
              >
                {p?.displayName || "Former member"}
                <button
                  type="button"
                  onClick={() => remove(id)}
                  aria-label={`Remove ${p?.displayName || "person"}`}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-fg hover:bg-card hover:text-fg"
                >
                  <X size={14} />
                </button>
              </span>
            );
          })}
        </div>
      ) : null}

      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        aria-label={label ? `${label}: search` : "Search people"}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const first = matches.find((p) => mode !== "assignee" || p.canFill);
            if (first) add(first);
          }
        }}
      />

      {matches.length > 0 ? (
        <ul className="flex flex-col overflow-hidden rounded-[var(--radius-lg)] bg-card-alt">
          {matches.map((p) => {
            const blocked = mode === "assignee" && !p.canFill;
            return (
              <li key={p.id} className="border-t border-line first:border-t-0">
                <button
                  type="button"
                  onClick={() => add(p)}
                  disabled={blocked}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left",
                    blocked ? "cursor-not-allowed opacity-60" : "hover:bg-card",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-bold text-fg">
                      {p.displayName}
                    </span>
                    <span className="block truncate text-[12px] text-muted-fg">{p.email}</span>
                  </span>
                  {blocked ? <Badge>No goals page · viewer only</Badge> : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : q ? (
        <div className="px-1 text-[13px] text-muted-fg">No one matches “{query.trim()}”.</div>
      ) : null}
    </div>
  );
}
