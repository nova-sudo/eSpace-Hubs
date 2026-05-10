import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind class strings with clsx semantics.
 * Pass-through for conditionals, arrays, objects — same API as shadcn/ui.
 */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
