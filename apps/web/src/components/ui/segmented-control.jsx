"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { Badge } from "./badge";

const SIZES = {
  sm: "px-3.5 py-1.5 text-[12.5px] font-semibold",
  md: "px-4 py-2 text-[13px] font-semibold",
};

// Edge fade shown only on the side(s) that have hidden options — the cue that
// the pill track scrolls. A mask (not an overlay) so it works on any surface.
const FADE = 24;
function maskFor(left, right) {
  if (!left && !right) return undefined;
  const l = left ? `transparent 0, black ${FADE}px` : "black 0";
  const r = right ? `black calc(100% - ${FADE}px), transparent 100%` : "black 100%";
  const g = `linear-gradient(to right, ${l}, ${r})`;
  return { maskImage: g, WebkitMaskImage: g };
}

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Pill-track switcher. `options: [{value, label, count?}]`.
 *
 * Two semantics — pick by what the control DOES:
 *   - `as="tablist"` (default) — switches between views of the same content
 *     (Board / Document, Table / Queue). role=tablist + role=tab +
 *     aria-selected, roving tabindex, ←/→/Home/End. Pass `controls` (a panel
 *     id, or `(value) => id`) to wire aria-controls to the role=tabpanel.
 *   - `as="radiogroup"` — picks a filter / setting / one-of-N value (All /
 *     Unread, a date preset, density). role=radiogroup + role=radio +
 *     aria-checked, same keyboard model.
 *
 * Always pass `ariaLabel` (or `aria-label`) — the group needs a name.
 * On a narrow screen the track scrolls; the edges fade where options are
 * hidden and the active option is scrolled into view.
 */
export function SegmentedControl({
  options = [],
  value,
  onChange,
  size = "md",
  onCard = false,
  as = "tablist",
  mode,
  ariaLabel,
  "aria-label": ariaLabelAttr,
  "aria-labelledby": ariaLabelledBy,
  controls,
  idBase,
  className,
}) {
  const kind = (mode || as) === "radiogroup" || (mode || as) === "radio" ? "radiogroup" : "tablist";
  const itemRole = kind === "radiogroup" ? "radio" : "tab";
  const trackRef = useRef(null);
  const itemRefs = useRef([]);
  const [fade, setFade] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setFade((f) => (f.left === left && f.right === right ? f : { left, right }));
  }, []);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return undefined;
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      ro?.disconnect();
    };
  }, [measure, options.length]);

  // Keep the selected option visible inside the track (horizontal only — never
  // scrolls the page).
  const activeIndex = options.findIndex((o) => o.value === value);
  useIsoLayoutEffect(() => {
    const el = trackRef.current;
    const item = itemRefs.current[activeIndex];
    if (!el || !item || el.scrollWidth <= el.clientWidth) return;
    const pad = FADE;
    if (item.offsetLeft - pad < el.scrollLeft) el.scrollLeft = Math.max(0, item.offsetLeft - pad);
    else if (item.offsetLeft + item.offsetWidth + pad > el.scrollLeft + el.clientWidth)
      el.scrollLeft = item.offsetLeft + item.offsetWidth + pad - el.clientWidth;
  }, [activeIndex]);

  const focusable = activeIndex >= 0 ? activeIndex : 0;

  function select(i) {
    const opt = options[i];
    if (!opt) return;
    itemRefs.current[i]?.focus();
    if (opt.value !== value) onChange?.(opt.value);
  }

  function onKeyDown(e) {
    const n = options.length;
    if (!n) return;
    const cur = itemRefs.current.indexOf(document.activeElement);
    const from = cur >= 0 ? cur : focusable;
    let next = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (from + 1) % n;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (from - 1 + n) % n;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    if (next == null) return;
    e.preventDefault();
    select(next);
  }

  const panelFor = (v) => (typeof controls === "function" ? controls(v) : controls);

  return (
    <div
      ref={trackRef}
      role={kind}
      aria-label={ariaLabel || ariaLabelAttr}
      aria-labelledby={ariaLabelledBy}
      onKeyDown={onKeyDown}
      className={cn(
        "inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-[var(--radius-pill)] p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        onCard ? "bg-card-alt" : "bg-card",
        className,
      )}
      style={maskFor(fade.left, fade.right)}
    >
      {options.map((opt, i) => {
        const active = opt.value === value;
        const stateProps =
          kind === "radiogroup"
            ? { "aria-checked": active }
            : {
                "aria-selected": active,
                "aria-controls": active ? panelFor(opt.value) : undefined,
              };
        return (
          <button
            key={opt.value}
            ref={(node) => {
              itemRefs.current[i] = node;
            }}
            id={idBase ? `${idBase}-${opt.value}` : undefined}
            type="button"
            role={itemRole}
            {...stateProps}
            tabIndex={i === focusable ? 0 : -1}
            onClick={() => select(i)}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-pill)] transition-colors",
              SIZES[size] || SIZES.md,
              active ? "bg-ink text-ink-on" : "text-muted-fg hover:text-fg",
            )}
          >
            {opt.label}
            {opt.count != null ? <Badge tone={active ? "ink" : "neutral"}>{opt.count}</Badge> : null}
          </button>
        );
      })}
    </div>
  );
}
