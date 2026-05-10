import { cn } from "@/lib/cn";

const TONES = {
  default: "bg-[rgba(0,0,0,0.06)] text-fg",
  accent: "bg-accent-dim text-accent",
  solid: "bg-accent text-accent-on",
  warn: "bg-[rgba(234,88,12,0.12)] text-[#b45309]",
  ok: "bg-[rgba(4,120,87,0.12)] text-good",
  muted: "bg-[rgba(0,0,0,0.04)] text-muted-fg",
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
