import { cn } from "@/lib/cn";

/**
 * Label — 12px/600 muted sentence-case text used for crumbs, field labels,
 * tile labels. `caps` switches to the rare Caption recipe (11px/700/uppercase)
 * for a stat's caption line — the only place uppercase is allowed.
 */
export function Label({ children, caps = false, as: Tag = "span", className, ...rest }) {
  return (
    <Tag
      className={cn(
        caps
          ? "text-[11px] font-bold tracking-[0.06em] uppercase text-muted-fg"
          : "text-[12px] font-semibold text-muted-fg",
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}
