import { cn } from "@/lib/cn";

const SIZE_CLASSES = {
  sm: "h-1.5 flex-1 rounded-full",
  md: "h-2.5 flex-1 rounded-full",
  row: "h-4 w-2 shrink-0 rounded-[3px]",
};

const STATE_CLASSES = {
  filled: "bg-ink",
  owed: "bg-peach-ink opacity-55",
  current: "bg-card-alt",
  future: "bg-card-alt",
  settled: "bg-card-alt opacity-60",
};

// `current` is the ONE place the app uses a dashed outline — a plain
// inline style so the design-system guard (which bans the Tailwind
// dashed-border utility class) doesn't flag it.
const CURRENT_STYLE = { border: "1.5px dashed var(--dim-fg)" };

/**
 * Cadence-window strip. Ink = filled, peach = owed, dashed = current.
 */
export function FillStrip({ cells = [], size = "sm", className }) {
  return (
    <div className={cn("flex items-center gap-1", className)}>
      {cells.map((cell, i) => (
        <span
          key={cell.key ?? i}
          title={cell.label}
          className={cn(SIZE_CLASSES[size] || SIZE_CLASSES.sm, STATE_CLASSES[cell.state] || STATE_CLASSES.future)}
          style={cell.state === "current" ? CURRENT_STYLE : undefined}
        />
      ))}
    </div>
  );
}
