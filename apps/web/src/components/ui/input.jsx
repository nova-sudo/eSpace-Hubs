import { cn } from "@/lib/cn";
import { Label } from "./label";

export function Input({ className, ...rest }) {
  // `mono` is accepted for back-compat and is now a no-op — inputs are sans
  // and filled. Inputs are the one exception to "borderless": a 1px
  // --field-line boundary (≥ 3:1, WCAG 1.4.11) so the field is findable.
  const { mono: _mono, ...inputProps } = rest;
  return (
    <input
      {...inputProps}
      className={cn(
        "h-11 w-full rounded-[var(--radius-lg)] border border-field-line bg-card-alt px-3.5 text-[14px] text-fg outline-none placeholder:text-dim-fg focus:ring-2 focus:ring-ink",
        className,
      )}
    />
  );
}

export function Field({ label, hint, children, className }) {
  return (
    <label className={cn("block", className)}>
      {label ? <Label className="mb-1.5 block">{label}</Label> : null}
      {children}
      {hint ? <div className="mt-1 text-[12px] leading-[1.4] text-muted-fg">{hint}</div> : null}
    </label>
  );
}
