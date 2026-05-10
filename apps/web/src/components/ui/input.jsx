import { cn } from "@/lib/cn";

export function Input({ mono = false, className, ...rest }) {
  return (
    <input
      {...rest}
      className={cn(
        "w-full rounded-[var(--radius-tile)] border border-border bg-card px-3 py-2.5 text-[13px] text-fg outline-none placeholder:text-dim-fg focus:border-accent",
        className,
      )}
      style={mono ? { fontFamily: "var(--font-mono)" } : undefined}
    />
  );
}

export function Field({ label, hint, children, className }) {
  return (
    <label className={cn("block", className)}>
      {label ? (
        <div
          className="mb-1.5 uppercase tracking-[0.6px] text-[10.5px] text-muted-fg"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {label}
        </div>
      ) : null}
      {children}
      {hint ? (
        <div className="mt-1 text-[11.5px] leading-[1.4] text-dim-fg">{hint}</div>
      ) : null}
    </label>
  );
}
