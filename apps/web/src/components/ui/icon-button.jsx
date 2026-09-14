import { cn } from "@/lib/cn";

const SIZES = { sm: "h-8 w-8", md: "h-[38px] w-[38px]" };

/**
 * Circular icon button. `bg-card` on the canvas, `bg-card-alt` on a card
 * (`onCard`). `label` is required — it becomes the aria-label and title.
 */
export function IconButton({ label, children, size = "md", onCard = false, active = false, className, ...rest }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full text-fg transition-colors hover:bg-card-alt",
        SIZES[size] || SIZES.md,
        active ? "bg-ink text-ink-on hover:opacity-90" : onCard ? "bg-card-alt" : "bg-card",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
