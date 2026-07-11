import { cn } from "@/lib/cn";

const TONES = {
  default: "bg-[color-mix(in_srgb,var(--fg)_7%,transparent)] text-fg",
  accent: "bg-accent-dim text-accent",
  solid: "bg-accent text-accent-on",
  warn: "bg-[color-mix(in_srgb,var(--warn)_14%,transparent)] text-warn",
  bad: "bg-[color-mix(in_srgb,var(--bad)_14%,transparent)] text-bad",
  ok: "bg-[color-mix(in_srgb,var(--good)_14%,transparent)] text-good",
  muted: "bg-[color-mix(in_srgb,var(--fg)_5%,transparent)] text-muted-fg",
};

/**
 * Compact status pill. Use `mono` for ref-style pills.
 */
export function Pill({ children, tone = "default", mono = false, className }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-[2px] text-[10.5px] font-semibold",
        mono ? "normal-case tracking-normal" : "uppercase tracking-[0.2px]",
        TONES[tone] ?? TONES.default,
        className,
      )}
      style={mono ? { fontFamily: "var(--font-mono)" } : undefined}
    >
      {children}
    </span>
  );
}
