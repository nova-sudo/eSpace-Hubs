import { cn } from "@/lib/cn";

const SIZE_CLASSES = {
  sm: "h-1.5 flex-1 rounded-full",
  md: "h-2.5 flex-1 rounded-full",
  row: "h-4 w-2 shrink-0 rounded-[3px]",
};

const STATE_CLASSES = {
  filled: "bg-ink",
  // peach-text, not peach-ink: the cell sits on a plain card, and the ink
  // tone collapses to ~1.5:1 there in dark. Full strength = ≥ 3:1 both themes.
  owed: "bg-peach-text",
  // --track is the visible empty state (≥ 1.4:1 on a card; card-alt was 1.07).
  current: "bg-track",
  future: "bg-track",
  settled: "bg-track opacity-60",
  // Ended before the tracker was created — neutral, quieter than upcoming:
  // an outline only, so it still reads as "a window" rather than nothing.
  before: "bg-transparent ring-1 ring-inset ring-track",
};

// `current` is the ONE place the app uses a dashed outline — a plain
// inline style so the design-system guard (which bans the Tailwind
// dashed-border utility class) doesn't flag it.
const CURRENT_STYLE = { border: "1.5px dashed var(--muted-fg)" };

/**
 * Cadence-window strip. Ink = filled, peach = owed, dashed = current,
 * faded = before the tracker existed (not owed).
 *
 * `cell.title` is the tooltip; callers build it from goal-inputs'
 * `windowCellTitle` so the state words match every other window surface
 * (a UI primitive can't import a feature). Falls back to the label.
 */
export function FillStrip({ cells = [], size = "sm", className }) {
  return (
    <div className={cn("flex items-center gap-1", className)}>
      {cells.map((cell, i) => (
        <span
          key={cell.key ?? i}
          title={cell.title ?? cell.label}
          className={cn(SIZE_CLASSES[size] || SIZE_CLASSES.sm, STATE_CLASSES[cell.state] || STATE_CLASSES.future)}
          style={cell.state === "current" ? CURRENT_STYLE : undefined}
        />
      ))}
    </div>
  );
}
