"use client";

/**
 * What one person submitted for one period — values by field label, any
 * evidence, and the submission / last-edit times. Read-only.
 */

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { resolvePeriodContent } from "@espace-devhub/shared/goal-specs";
import { Badge, IconButton, Label } from "@/components/ui";
import { useProgressCell } from "./api";
import { STATUS_META, fmtStamp } from "./progress-grid";

function formatValue(v, kind) {
  if (v == null || v === "") return "—";
  if (kind === "checkbox") return v === true ? "Yes" : "No";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function CellDetailDialog({ goal, user, cell, onClose }) {
  const { cell: data, loading, error } = useProgressCell(goal?.id, user?.id, cell?.key ?? null);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (typeof document === "undefined" || !cell) return null;
  const fields = resolvePeriodContent(goal?.spec, cell.index)?.fields ?? [];
  const meta = STATUS_META[cell.status] ?? STATUS_META.upcoming;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${user.displayName} · ${cell.label}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-fg/40 p-5"
    >
      <div
        className="flex max-h-[86vh] w-full max-w-[520px] flex-col overflow-hidden rounded-[var(--radius-xl)] bg-card"
        style={{ boxShadow: "var(--shadow-float)" }}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-6 py-4">
          <div className="min-w-0">
            <Label>{goal?.title}</Label>
            <div className="truncate text-[18px] font-bold tracking-[-0.01em] text-fg">
              {user.displayName} · {cell.label}
            </div>
          </div>
          <IconButton label="Close" onCard onClick={() => onClose?.()}>
            <X size={16} />
          </IconButton>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className={`rounded-[var(--radius-pill)] px-2.5 py-1 text-[11.5px] font-bold ${meta.cls}`}>
              {meta.label}
            </span>
            <Badge>due {fmtStamp(cell.deadline)}</Badge>
          </div>

          {loading ? (
            <div className="text-[13px] text-muted-fg">Loading…</div>
          ) : error ? (
            <div className="text-[13px] text-muted-fg">Couldn&apos;t load this entry: {error.message}</div>
          ) : !data || data.entryCount === 0 ? (
            <div className="text-[13px] text-muted-fg">Nothing submitted for this period yet.</div>
          ) : (
            <div className="flex flex-col gap-4">
              <dl className="grid grid-cols-2 gap-3 text-[13px]">
                <div>
                  <dt className="text-[12px] font-semibold text-muted-fg">Submitted</dt>
                  <dd className="font-bold">
                    {fmtStamp(Date.parse(data.submittedAt))}
                    {data.approx ? " (approx.)" : ""}
                  </dd>
                </div>
                <div>
                  <dt className="text-[12px] font-semibold text-muted-fg">Last edited</dt>
                  <dd className="font-bold">
                    {fmtStamp(Date.parse(data.lastEditedAt))} · {data.entryCount}{" "}
                    {data.entryCount === 1 ? "save" : "saves"}
                  </dd>
                </div>
              </dl>
              <ul className="flex flex-col">
                {fields.map((f) => (
                  <li key={f.id} className="border-t border-line py-2.5">
                    <div className="text-[12px] font-semibold text-muted-fg">{f.label || f.id}</div>
                    <div className="text-[14px] text-fg">{formatValue(data.values?.[f.id], f.kind)}</div>
                    {typeof data.evidence?.[f.id] === "string" && data.evidence[f.id].trim() ? (
                      <div className="mt-0.5 break-words text-[12.5px] text-muted-fg">
                        Evidence: {data.evidence[f.id]}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
              {data.note ? (
                <div className="rounded-[var(--radius-lg)] bg-card-alt p-3.5 text-[13px]">{data.note}</div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
