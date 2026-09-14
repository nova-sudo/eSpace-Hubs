import { Star } from "lucide-react";

export function StarGlyph({ on }) {
  return (
    <Star
      size={12}
      className={on ? "fill-lemon-ink text-lemon-ink" : "fill-none text-dim-fg"}
      strokeWidth={2}
      aria-hidden="true"
    />
  );
}
