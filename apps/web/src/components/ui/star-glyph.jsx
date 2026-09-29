import { Star } from "lucide-react";

export function StarGlyph({ on }) {
  return (
    <Star
      size={12}
      className={on ? "fill-lemon-text text-lemon-text" : "fill-none text-muted-fg"}
      strokeWidth={2}
      aria-hidden="true"
    />
  );
}
