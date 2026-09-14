"use client";

import * as RS from "@radix-ui/react-select";
import { Children, isValidElement } from "react";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * The one styled dropdown — a Radix Select under the hood so the OPEN popup is
 * a fully-themed card instead of the raw, unstylable native option list.
 *
 * Drop-in for a native <select>: pass `value`, `onChange` (called with a
 * synthetic `{ target: { value } }`), and `<option>` children.
 *
 * Tones (closed trigger):
 *   - "default"  filled card-alt trigger (Goals / Settings / Admin)
 *   - "inverse"  solid ink trigger
 *   - "bare"     transparent trigger (sits inside an already-styled pill)
 * The open popup is always the same white card, regardless of tone.
 *
 * Radix forbids empty-string Item values, so "" is mapped to a sentinel.
 */
const EMPTY = "__empty__";
const enc = (v) => (v === "" || v == null ? EMPTY : String(v));
const dec = (v) => (v === EMPTY ? "" : v);

const TRIGGER_TONES = {
  default: "bg-card-alt text-fg",
  inverse: "bg-ink text-ink-on",
  bare: "bg-transparent text-inherit",
};

const SIZES = {
  sm: "h-9 pl-3 pr-2.5 text-[13px]",
  md: "h-11 pl-3.5 pr-3 text-[14px]",
};

/** Flatten <option> children → [{ value, label, disabled }]. */
function readOptions(children) {
  const out = [];
  for (const child of Children.toArray(children)) {
    if (!isValidElement(child) || child.type !== "option") continue;
    out.push({
      value: child.props.value ?? "",
      label: child.props.children,
      disabled: child.props.disabled,
    });
  }
  return out;
}

export function Select({
  value,
  onChange,
  children,
  className,
  tone = "default",
  size = "md",
  style,
  disabled,
  placeholder,
  "aria-label": ariaLabel,
}) {
  const trig = TRIGGER_TONES[tone] || TRIGGER_TONES.default;
  const options = readOptions(children);
  // Resolve the label ourselves — Radix only knows item text once the (lazy)
  // popup has mounted, so a never-opened trigger would otherwise show the
  // placeholder instead of the current selection.
  const selected = options.find((o) => String(o.value ?? "") === String(value ?? ""));

  return (
    <RS.Root
      value={enc(value)}
      onValueChange={(v) => onChange?.({ target: { value: dec(v) } })}
      disabled={disabled}
    >
      <RS.Trigger
        aria-label={ariaLabel}
        className={cn(
          "inline-flex min-w-0 cursor-pointer items-center justify-between gap-2 rounded-[var(--radius-lg)] outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus:ring-2 focus:ring-ink",
          SIZES[size] || SIZES.md,
          trig,
          className,
        )}
        style={style}
      >
        <span className="min-w-0 truncate">
          <RS.Value placeholder={placeholder || "Select…"}>
            {selected ? selected.label : null}
          </RS.Value>
        </span>
        <RS.Icon asChild>
          <ChevronDown size={14} className="shrink-0 opacity-60" />
        </RS.Icon>
      </RS.Trigger>

      <RS.Portal>
        <RS.Content
          position="popper"
          sideOffset={5}
          className="z-[200] overflow-hidden rounded-[var(--radius-lg)] bg-card p-1.5 text-fg"
          style={{
            boxShadow: "var(--shadow-float)",
            minWidth: "var(--radix-select-trigger-width)",
            maxHeight: "var(--radix-select-content-available-height)",
          }}
        >
          <RS.ScrollUpButton className="flex h-5 items-center justify-center opacity-60">
            <ChevronDown size={12} className="rotate-180" />
          </RS.ScrollUpButton>
          <RS.Viewport>
            {options.map((opt) => (
              <SelectItem key={enc(opt.value)} value={enc(opt.value)} disabled={opt.disabled}>
                {opt.label}
              </SelectItem>
            ))}
          </RS.Viewport>
          <RS.ScrollDownButton className="flex h-5 items-center justify-center opacity-60">
            <ChevronDown size={12} />
          </RS.ScrollDownButton>
        </RS.Content>
      </RS.Portal>
    </RS.Root>
  );
}

function SelectItem({ value, children, disabled }) {
  return (
    <RS.Item
      value={value}
      disabled={disabled}
      className="relative flex cursor-pointer select-none items-center rounded-[var(--radius-md)] px-3 py-2 text-[13.5px] leading-tight outline-none transition-colors data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40 data-[highlighted]:bg-card-alt data-[state=checked]:font-bold"
    >
      <RS.ItemText>{children}</RS.ItemText>
      <RS.ItemIndicator className="absolute right-2.5 inline-flex items-center">
        <Check size={13} />
      </RS.ItemIndicator>
    </RS.Item>
  );
}
