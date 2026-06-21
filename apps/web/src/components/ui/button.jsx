import { cn } from "@/lib/cn";

const SIZES = {
  sm: "px-3 py-1.5 text-[11px]",
  md: "px-4 py-2.5 text-[13px]",
  lg: "px-6 py-3.5 text-[14px]",
};

const VARIANTS = {
  primary: "bg-accent text-accent-on border border-accent hover:opacity-90",
  ghost:
    "bg-transparent text-fg border border-border hover:border-border-strong",
  solid: "bg-fg text-bg border border-fg hover:opacity-90",
  danger:
    "bg-transparent text-bad border border-bad hover:bg-bad hover:text-accent-on",
};

/**
 * The single Button primitive — mono uppercase per Nothing UI.
 * All interactive CTAs in the app use this.
 */
export function Button({
  children,
  variant = "primary",
  size = "md",
  className,
  disabled,
  ...rest
}) {
  return (
    <button
      {...rest}
      disabled={disabled}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--radius-tile)] font-bold uppercase tracking-[0.4px] transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        SIZES[size],
        VARIANTS[variant],
        className,
      )}
      style={{ fontFamily: "var(--font-mono)" }}
    >
      {children}
    </button>
  );
}
