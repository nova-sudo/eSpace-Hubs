import { cn } from "@/lib/cn";

export function Input({ className, ...rest }) {
  // Nothing UI inputs are mono on a card surface with a strong hairline
  // (see .n-input in the migration kit). `mono` is accepted for back-compat
  // but is now the default, so the prop is a no-op.
  const { mono: _mono, ...inputProps } = rest;
  return (
    <input
      {...inputProps}
      className={cn(
        "w-full rounded-[var(--radius-sub)] border border-border-strong bg-card px-3.5 py-2.5 text-[13px] text-fg outline-none placeholder:text-dim-fg focus:border-accent",
        className,
      )}
      style={{ fontFamily: "var(--font-mono)" }}
    />
  );
}

export function Field({ label, hint, children, className }) {
  return (
    <label className={cn("block", className)}>
      {label ? (
        <div
          className="mb-1.5 uppercase tracking-[1.5px] text-[10px] text-muted-fg"
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
