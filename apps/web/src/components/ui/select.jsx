"use client";

import * as RS from "@radix-ui/react-select";
import { Children, isValidElement } from "react";
import { cn } from "@/lib/cn";

/**
 * The one styled dropdown — a Radix Select under the hood so the OPEN popup is
 * a fully-themed card (rounded, hairline, mono items, accent highlight) instead
 * of the raw, unstylable native option list (which renders as a white box on
 * the dark analyst ground).
 *
 * Drop-in for a native <select>: pass `value`, `onChange` (called with a
 * synthetic `{ target: { value } }`), and `<option>` children. The wrapper
 * reads the options off the children so existing call sites need no changes.
 *
 * Tones (closed trigger + open popup):
 *   - "default"  card-on-token surfaces (Goals / Settings / Admin) — follows theme
 *   - "inverse"  white-on-dark for the intentionally-dark grounds (analyst)
 *   - "bare"     transparent trigger (sits inside an already-styled pill) +
 *                the same dark popup as inverse
 *
 * Radix forbids empty-string Item values, so "" is mapped to a sentinel.
 */
const EMPTY = "__empty__";
const enc = (v) => (v === "" || v == null ? EMPTY : String(v));
const dec = (v) => (v === EMPTY ? "" : v);

const TRIGGER_TONES = {
  default: {
    color: "var(--fg)",
    background: "var(--card)",
    border: "1px solid var(--border-strong)",
  },
  inverse: {
    color: "#ffffff",
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.22)",
  },
  bare: {
    color: "inherit",
    background: "transparent",
    border: "1px solid transparent",
  },
};

// The popup. inverse/bare grounds are dark regardless of app theme, so they
// use explicit dark values (not theme tokens, which would flip to light).
const CONTENT_TONES = {
  default: {
    background: "var(--card)",
    color: "var(--fg)",
    border: "1px solid var(--border-strong)",
    itemHover: "var(--accent-dim)",
    itemHoverFg: "var(--accent)",
  },
  inverse: {
    background: "#16161c",
    color: "rgba(255,255,255,0.92)",
    border: "1px solid rgba(255,255,255,0.16)",
    itemHover: "rgba(255,255,255,0.12)",
    itemHoverFg: "#ffffff",
  },
};

const SIZES = {
  sm: "py-1 pl-2.5 pr-7 text-[10.5px]",
  md: "py-2 pl-3 pr-8 text-[12px]",
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
  const content = CONTENT_TONES[tone === "default" ? "default" : "inverse"];
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
          "inline-flex min-w-0 cursor-pointer items-center justify-between gap-2 rounded-[var(--radius-sub)] leading-tight outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-50 data-[state=open]:border-accent",
          SIZES[size] || SIZES.md,
          className,
        )}
        style={{
          fontFamily: "var(--font-mono)",
          color: trig.color,
          background: trig.background,
          border: trig.border,
          ...style,
        }}
      >
        <span className="min-w-0 truncate">
          <RS.Value placeholder={placeholder || "—"}>
            {selected ? selected.label : null}
          </RS.Value>
        </span>
        <RS.Icon asChild>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" style={{ opacity: 0.6, flexShrink: 0 }}>
            <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </RS.Icon>
      </RS.Trigger>

      <RS.Portal>
        <RS.Content
          position="popper"
          sideOffset={5}
          className="z-[70] overflow-hidden rounded-[var(--radius-sub)] shadow-lg"
          style={{
            background: content.background,
            color: content.color,
            border: content.border,
            minWidth: "var(--radix-select-trigger-width)",
            maxHeight: "var(--radix-select-content-available-height)",
            fontFamily: "var(--font-mono)",
            fontSize: 11.5,
          }}
        >
          <RS.ScrollUpButton className="flex h-5 items-center justify-center" style={{ opacity: 0.6 }}>↑</RS.ScrollUpButton>
          <RS.Viewport className="p-1">
            {options.map((opt) => (
              <SelectItem key={enc(opt.value)} value={enc(opt.value)} disabled={opt.disabled} hover={content.itemHover} hoverFg={content.itemHoverFg}>
                {opt.label}
              </SelectItem>
            ))}
          </RS.Viewport>
          <RS.ScrollDownButton className="flex h-5 items-center justify-center" style={{ opacity: 0.6 }}>↓</RS.ScrollDownButton>
        </RS.Content>
      </RS.Portal>
    </RS.Root>
  );
}

function SelectItem({ value, children, disabled, hover, hoverFg }) {
  return (
    <RS.Item
      value={value}
      disabled={disabled}
      className="relative flex cursor-pointer select-none items-center rounded-[4px] py-1.5 pl-2.5 pr-7 leading-tight outline-none transition-colors data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40 data-[highlighted]:[background:var(--_hover)] data-[highlighted]:[color:var(--_hoverfg)]"
      style={{ "--_hover": hover, "--_hoverfg": hoverFg }}
    >
      <RS.ItemText>{children}</RS.ItemText>
      <RS.ItemIndicator className="absolute right-2 inline-flex items-center">
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M2.5 6.5l2.5 2.5 4.5-5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </RS.ItemIndicator>
    </RS.Item>
  );
}
