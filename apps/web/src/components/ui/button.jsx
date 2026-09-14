import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/cn";

const SIZES = {
  sm: { h: "h-9", text: "text-[13px]", pad: "px-4", circle: 28, arrowPad: "pl-5 pr-1.5" },
  md: { h: "h-10", text: "text-[13.5px]", pad: "px-5", circle: 32, arrowPad: "pl-5 pr-1.5" },
  lg: { h: "h-11", text: "text-[14px]", pad: "px-6", circle: 32, arrowPad: "pl-5 pr-1.5" },
};

const TONE_TINT = {
  mint: "bg-mint text-mint-ink",
  sky: "bg-sky text-sky-ink",
  lav: "bg-lav text-lav-ink",
  peach: "bg-peach text-peach-ink",
  lemon: "bg-lemon text-lemon-ink",
};

const VARIANTS = {
  ink: "bg-ink text-ink-on font-bold hover:opacity-90",
  soft: "bg-card-alt text-fg font-semibold hover:opacity-80",
  ghost: "bg-transparent text-fg font-semibold hover:bg-card-alt",
  danger: "bg-peach text-peach-ink font-semibold hover:opacity-90",
};

/**
 * The single Button primitive. Pill-shaped, sentence case, Manrope.
 * Legacy `variant="primary"` / `"solid"` map to `ink` so old callers
 * keep working.
 */
export function Button({
  children,
  variant = "ink",
  size = "md",
  tone = "mint",
  arrow = false,
  iconOnly = false,
  className,
  disabled,
  ...rest
}) {
  const resolvedVariant =
    variant === "primary" || variant === "solid" ? "ink" : variant;
  const sz = SIZES[size] || SIZES.md;
  const variantClass =
    resolvedVariant === "tint" ? (TONE_TINT[tone] || TONE_TINT.mint) + " font-semibold hover:opacity-90" : VARIANTS[resolvedVariant] || VARIANTS.ink;

  return (
    <button
      {...rest}
      disabled={disabled}
      className={cn(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-pill)] transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        sz.h,
        sz.text,
        iconOnly ? "aspect-square p-0" : arrow ? sz.arrowPad : sz.pad,
        variantClass,
        className,
      )}
    >
      {children}
      {arrow && !iconOnly ? (
        <span
          aria-hidden="true"
          className="inline-flex shrink-0 items-center justify-center rounded-full bg-mint text-mint-ink"
          style={{ width: sz.circle, height: sz.circle }}
        >
          <ArrowRight size={14} />
        </span>
      ) : null}
    </button>
  );
}
