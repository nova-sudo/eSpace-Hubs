import { cn } from "@/lib/cn";

const TONE_CLASSES = {
  mint: "bg-mint text-mint-ink",
  sky: "bg-sky text-sky-ink",
  lav: "bg-lav text-lav-ink",
  peach: "bg-peach text-peach-ink",
  lemon: "bg-lemon text-lemon-ink",
  ink: "bg-ink text-ink-on",
};

const RADIUS = {
  xl: "rounded-[var(--radius-xl)]",
  lg: "rounded-[var(--radius-lg)]",
};

/**
 * The one card surface. Borderless, tinted or white, `--shadow-card` on the
 * white card only (light mode). `variant="accent"` is the legacy alias for
 * `tone="ink"`.
 */
export function Card({
  children,
  tone,
  variant,
  padding = 20,
  radius = "xl",
  className,
  style,
  ...rest
}) {
  const resolvedTone = tone || (variant === "accent" ? "ink" : undefined);
  const tinted = resolvedTone && TONE_CLASSES[resolvedTone];
  return (
    <div
      className={cn(
        "relative overflow-hidden",
        RADIUS[radius] || RADIUS.xl,
        tinted || "bg-card text-fg",
        className,
      )}
      style={{
        padding,
        boxShadow: tinted ? undefined : "var(--shadow-card)",
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}
