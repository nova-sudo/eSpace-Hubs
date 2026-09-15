import { cn } from "@/lib/cn";

const TONE = {
  lav: "bg-lav text-lav-ink",
  mint: "bg-mint text-mint-ink",
  sky: "bg-sky text-sky-ink",
  peach: "bg-peach text-peach-ink",
  lemon: "bg-lemon text-lemon-ink",
  neutral: "bg-card-alt text-muted-fg",
};

/** First letters of the first and last word — "Mahmoud Essam" → "ME". */
export function initialsOf(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Initials in a tinted circle. The app has no uploaded photos, so this is the
 * only person-marker there is — used on team boards, queues and user rows.
 */
export function Avatar({ name, initials, size = 32, tone = "lav", className, title }) {
  const text = initials || initialsOf(name);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-extrabold",
        TONE[tone] || TONE.lav,
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.34) }}
      title={title ?? name ?? undefined}
      aria-hidden={title || name ? undefined : "true"}
    >
      {text}
    </span>
  );
}
