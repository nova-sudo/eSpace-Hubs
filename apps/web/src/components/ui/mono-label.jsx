import { cn } from "@/lib/cn";

/**
 * 10.5px mono uppercase label — used as section overlines and tile labels.
 */
export function MonoLabel({ children, className, as: Tag = "span", ...rest }) {
  return (
    <Tag
      className={cn(
        "font-mono uppercase tracking-[0.6px] text-[10.5px] text-muted-fg",
        className,
      )}
      style={{ fontFamily: "var(--font-mono)" }}
      {...rest}
    >
      {children}
    </Tag>
  );
}
