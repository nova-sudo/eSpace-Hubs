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
        // UNCHECKED NEEDS A VISIBLE EDGE, and a fill alone cannot give it one.
        // `bg-card-alt` against a `bg-card` surface is 1.07:1 — WCAG 1.4.11
        // asks 3:1 for the boundary of a control, so on every white card in
        // the app the empty box was, for practical purposes, not drawn. The
        // `muted-fg` ring measures 4.83:1 in light and 6.98:1 in dark against
        // both `card` and `card-alt`, so the box reads on either surface and
        // in either theme. Checked stays fill + glyph, so the two states are
        // told apart by shape as well as colour.
        //
        // `ring-2`, not an arbitrary `ring-[1.5px]`: Tailwind v4 emits no rule
        // at all for that arbitrary width here, which drew a ring of zero
        // width — the invisible box again, wearing a fix. 2px on an 18px
        // control is the Material convention and holds up on a poor screen.
        checked
          ? "bg-ink text-ink-on"
          : "bg-card-alt text-transparent ring-2 ring-inset ring-muted-fg",
      )}
    >
      <Check size={12} strokeWidth={2.5} />
    </span>
  );
}
