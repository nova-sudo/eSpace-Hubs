import { cn } from "@/lib/cn";

/**
 * The one styled dropdown. A native <select> with its default chrome removed
 * (appearance:none) and the Nothing look reapplied: mono text, a card surface
 * with a strong hairline, a custom chevron, and a token-driven palette so it
 * reads correctly in light + dark. Focus uses the global select:focus-visible
 * accent outline (see globals.css).
 *
 * Tones:
 *   - "default"  card-on-token (regular surfaces, e.g. the Goals page)
 *   - "inverse"  white-on-translucent for the intentionally-dark grounds
 *                (the analyst page / the widget "light" variant). Sets
 *                colorScheme:dark so the native option popup is dark too.
 *   - "bare"     transparent, borderless — for inline chips inside a styled row
 *
 * Pass <option>s as children, exactly like a native select.
 */
const TONES = {
  default: {
    color: "var(--fg)",
    background: "var(--card)",
    border: "1px solid var(--border-strong)",
    colorScheme: undefined,
  },
  inverse: {
    color: "#ffffff",
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.22)",
    colorScheme: "dark",
  },
  bare: {
    color: "var(--fg)",
    background: "transparent",
    border: "1px solid transparent",
    colorScheme: undefined,
  },
};

const SIZES = {
  sm: "py-1 pl-2.5 pr-7 text-[10.5px]",
  md: "py-2 pl-3 pr-8 text-[12px]",
};

export function Select({
  value,
  onChange,
  children,
  className,
  tone = "default",
  size = "md",
  style,
  ...rest
}) {
  const t = TONES[tone] || TONES.default;
  return (
    <div className={cn("relative inline-flex min-w-0", className)}>
      <select
        value={value}
        onChange={onChange}
        {...rest}
        className={cn(
          "w-full cursor-pointer appearance-none rounded-[var(--radius-sub)] leading-tight outline-none transition-colors",
          SIZES[size] || SIZES.md,
        )}
        style={{
          fontFamily: "var(--font-mono)",
          color: t.color,
          background: t.background,
          border: t.border,
          colorScheme: t.colorScheme,
          ...style,
        }}
      >
        {children}
      </select>
      <svg
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2"
        width="10"
        height="10"
        viewBox="0 0 10 10"
        aria-hidden="true"
        style={{ color: t.color, opacity: 0.6 }}
      >
        <path
          d="M2 3.5L5 6.5L8 3.5"
          stroke="currentColor"
          strokeWidth="1.4"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
