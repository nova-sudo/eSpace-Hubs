import Link from "next/link";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * AI insight row — sparkle + one sentence + one link. Sits at the bottom
 * of a card. AI text is always marked with the sparkle.
 */
export function InsightRow({ children, action, tone = "neutral", className }) {
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-[var(--radius-lg)] px-3.5 py-3 text-[13px]",
        tone === "lav" ? "bg-lav text-lav-ink" : "bg-card-alt text-fg",
        className,
      )}
    >
      <Sparkles size={16} className="shrink-0 text-lav-ink" />
      <span className="min-w-0 flex-1">{children}</span>
      {action ? (
        action.href ? (
          <Link href={action.href} className="whitespace-nowrap text-[12.5px] font-bold text-fg">
            {action.label}
          </Link>
        ) : (
          <button
            type="button"
            onClick={action.onClick}
            className="whitespace-nowrap text-[12.5px] font-bold text-fg"
          >
            {action.label}
          </button>
        )
      ) : null}
    </div>
  );
}
