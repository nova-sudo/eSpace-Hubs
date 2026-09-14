import { cn } from "@/lib/cn";
import { Badge } from "./badge";

const SIZES = {
  sm: "px-3.5 py-1.5 text-[12.5px] font-semibold",
  md: "px-4 py-2 text-[13px] font-semibold",
};

/**
 * Pill-track tab switcher. `options: [{value, label, count?}]`.
 */
export function SegmentedControl({ options = [], value, onChange, size = "md", onCard = false, className }) {
  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex items-center gap-1 rounded-[var(--radius-pill)] p-1",
        onCard ? "bg-card-alt" : "bg-card",
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange?.(opt.value)}
            className={cn(
              "inline-flex items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-pill)] transition-colors",
              SIZES[size] || SIZES.md,
              active ? "bg-ink text-ink-on" : "text-muted-fg hover:text-fg",
            )}
          >
            {opt.label}
            {opt.count != null ? <Badge tone={active ? "ink" : "neutral"}>{opt.count}</Badge> : null}
          </button>
        );
      })}
    </div>
  );
}
