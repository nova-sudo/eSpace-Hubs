import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Accessible checkbox span. `label` is REQUIRED in spirit: a bare
 * role="checkbox" announces as "checkbox, not checked" N times in a
 * list with no way to tell which item is which — and because this is a
 * span (not an <input>), a wrapping <label> does NOT name it. Every
 * call site passes the row's own text.
 */
export function Checkbox({ checked, onChange, id, label }) {
  return (
    <span
      id={id}
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      tabIndex={0}
      onClick={onChange}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          onChange?.();
        }
      }}
      className={cn(
        "inline-grid h-[18px] w-[18px] cursor-pointer place-items-center rounded-[6px]",
        checked ? "bg-ink text-ink-on" : "bg-card-alt text-transparent",
      )}
    >
      <Check size={12} strokeWidth={2.5} />
    </span>
  );
}
