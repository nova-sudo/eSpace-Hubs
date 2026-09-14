import { cn } from "@/lib/cn";

const TONES = {
  neutral: "bg-card-alt text-muted-fg",
  mint: "bg-mint text-mint-ink",
  sky: "bg-sky text-sky-ink",
  lav: "bg-lav text-lav-ink",
  peach: "bg-peach text-peach-ink",
  lemon: "bg-lemon text-lemon-ink",
  ink: "bg-ink text-ink-on",
};

// Legacy tone names keep resolving so untouched call sites render sanely.
const LEGACY_TONES = {
  ok: "mint",
  good: "mint",
  warn: "lemon",
  bad: "peach",
  accent: "lav",
  solid: "ink",
  default: "neutral",
  muted: "neutral",
};

/**
 * Compact status pill. One per row, sentence case, 11.5px/700.
 * `mono` is accepted for back-compat and ignored.
 */
export function Badge({ children, tone = "neutral", dot = false, className, mono: _mono, ...rest }) {
  const resolved = TONES[tone] ? tone : LEGACY_TONES[tone] || "neutral";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-pill)] px-2.5 py-1 text-[11.5px] font-bold",
        TONES[resolved],
        className,
      )}
      {...rest}
    >
      {dot ? (
        <span aria-hidden="true" className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
      ) : null}
      {children}
    </span>
  );
}
