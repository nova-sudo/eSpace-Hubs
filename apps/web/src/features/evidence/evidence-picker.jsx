"use client";

import { Button, Card, MonoLabel, StarGlyph } from "@/components/ui";
import { cn } from "@/lib/cn";

export function EvidencePicker({ items, starredIds, onToggle, onAutoPick }) {
  const starredCount = items.filter((i) => starredIds.has(i.id)).length;
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <MonoLabel>Star as evidence · {starredCount} selected</MonoLabel>
          <div className="mt-1 text-[12.5px] text-muted-fg">
            Curate what lands in the export. Only starred items appear in the document
            above.
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onAutoPick}>
          Auto-pick top 10
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {items.length === 0 ? (
          <div className="col-span-2 rounded-[var(--radius-sub)] border border-dashed border-border bg-card-alt px-3 py-6 text-center text-[12.5px] text-muted-fg">
            Once you have merged MRs or closed tickets, they show up here.
          </div>
        ) : (
          items.map((e) => {
            const on = starredIds.has(e.id);
            return (
              <button
                key={e.id}
                onClick={() => onToggle(e)}
                className={cn(
                  "rounded-[var(--radius-sub)] border p-3 text-left transition-colors",
                  on
                    ? "border-accent bg-accent-dim"
                    : "border-border bg-card-alt hover:border-border-strong",
                )}
              >
                <div className="mb-1 flex items-baseline justify-between">
                  <span
                    className="font-bold text-accent"
                    style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
                  >
                    {e.ref}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span
                      className="uppercase tracking-[0.3px] text-muted-fg"
                      style={{ fontFamily: "var(--font-mono)", fontSize: 9.5 }}
                    >
                      {e.kind === "merged-pr"
                        ? "PR"
                        : e.kind === "ticket"
                          ? "Ticket"
                          : "Review"}
                    </span>
                    <StarGlyph on={on} />
                  </div>
                </div>
                <div
                  className="text-[12px] leading-[1.35]"
                  style={{ textWrap: "pretty" }}
                >
                  {e.title}
                </div>
                {e.impact ? (
                  <div className="mt-1 text-[11px] leading-[1.4] text-muted-fg">
                    → {e.impact}
                  </div>
                ) : null}
                <div
                  className="mt-1 text-dim-fg"
                  style={{ fontFamily: "var(--font-mono)", fontSize: 9.5 }}
                >
                  {e.date}
                </div>
              </button>
            );
          })
        )}
      </div>
    </Card>
  );
}
