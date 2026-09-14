import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge } from "./badge";

/**
 * Filter trigger chip — "Label: Value ▾". Opens a menu/popover from the
 * caller; this component is purely the trigger's appearance.
 */
export function FilterChip({ label, value, icon: Icon, onClick, active = false, count, onCard = false, className }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-[var(--radius-pill)] px-3.5 text-[13px] font-semibold transition-colors",
        active ? "bg-ink text-ink-on" : onCard ? "bg-card-alt text-fg" : "bg-card text-fg",
        className,
      )}
    >
      {Icon ? <Icon size={14} className={active ? "text-ink-on" : "text-muted-fg"} /> : null}
      {label ? <span className={active ? "text-ink-on/70" : "text-muted-fg"}>{label}:</span> : null}
      <span>{value}</span>
      {count != null ? <Badge tone={active ? "ink" : "neutral"}>{count}</Badge> : null}
      <ChevronDown size={13} className={active ? "text-ink-on" : "text-muted-fg"} />
    </button>
  );
}
