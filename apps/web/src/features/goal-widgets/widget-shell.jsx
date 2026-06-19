"use client";

/**
 * Shared tile chrome for every goal widget.
 *
 * Two visual variants — picked by prop, not by fork:
 *   - "light"  : white-on-indigo (for the inverse-themed Section 5 and the
 *                analyst page)
 *   - "dark"   : dark-on-white (regular HexaCore look; kept for reuse on the
 *                main dashboard if we ever want to embed widgets there)
 *
 * Provides:
 *   - top label row (mono overline + optional right-side chip)
 *   - title (spec.title, denormalized)
 *   - reasoning disclosure (collapsed by default, toggleable)
 *   - target strip (auto-rendered when spec.source.target or spec.manual.target)
 *   - slot for the widget body
 *
 * Widgets use this purely for layout — all data-specific rendering lives in
 * the widget component itself.
 */

import { useState } from "react";
import { toast } from "sonner";
import { useWidgetControls } from "./widget-controls-context";
import { GoalTierLadder } from "@/features/goal-tiers";
import { SPEC_KIND_META, SPEC_VARIANTS } from "@/features/goal-specs";
import { CadenceStepper } from "./cadence-stepper";

const VARIANT_STYLES = {
  light: {
    bg: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.18)",
    color: "#ffffff",
    mutedColor: "rgba(255,255,255,0.68)",
    dimColor: "rgba(255,255,255,0.48)",
    surface: "rgba(255,255,255,0.10)",
    divider: "rgba(255,255,255,0.15)",
  },
  dark: {
    bg: "var(--card)",
    border: "1px solid var(--border)",
    color: "var(--fg)",
    mutedColor: "var(--muted-fg)",
    dimColor: "var(--dim-fg)",
    surface: "var(--card-alt)",
    divider: "var(--border)",
  },
};

export function WidgetShell({
  spec,
  variant = "light",
  label,
  rightChip,
  title,
  footer,
  onRetry,
  className = "",
  style,
  children,
}) {
  const theme = VARIANT_STYLES[variant] || VARIANT_STYLES.light;
  const [showReason, setShowReason] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);
  // Optional user-controls injected by <GoalWidget>. Null handlers skip
  // rendering — widgets rendered outside the resolver (e.g. tests) still
  // work unchanged.
  const { onMarkDelegated, onEditContext, onReanalyze } = useWidgetControls();

  // The footer "re-analyze" chip. Prefer the direct reclassify+save path
  // (onReanalyze, injected by GoalWidget) so a single click re-runs the
  // classifier and applies the new spec immediately — with a busy state
  // and a success/failure toast. Falls back to onRetry (e.g. the analyst
  // overlay) when no direct handler is wired.
  async function handleReanalyze() {
    if (reanalyzing) return;
    if (!onReanalyze) {
      onRetry?.();
      return;
    }
    setReanalyzing(true);
    try {
      await onReanalyze();
      toast.success("Re-analyzed — spec & tiers updated.");
    } catch (err) {
      toast.error(`Re-analyze failed: ${err?.message || err}`);
    } finally {
      setReanalyzing(false);
    }
  }
  const canReanalyze = !!(onReanalyze || onRetry);

  return (
    <div
      className={`relative flex min-h-[180px] min-w-0 flex-col overflow-hidden rounded-[var(--radius-tile)] p-4 ${className}`}
      style={{
        background: theme.bg,
        border: theme.border,
        color: theme.color,
        ...style,
      }}
    >
      {(label || rightChip) ? (
        <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
          <span
            className="min-w-0 truncate font-mono uppercase tracking-[0.6px] text-[10.5px]"
            style={{
              fontFamily: "var(--font-mono)",
              color: theme.mutedColor,
            }}
            title={typeof label === "string" ? label : undefined}
          >
            {label}
          </span>
          {rightChip ? <span className="shrink-0">{rightChip}</span> : null}
        </div>
      ) : null}

      {title ? (
        <div
          className="mb-1.5 font-semibold leading-tight"
          style={{
            fontSize: 14,
            letterSpacing: "-0.1px",
            // Long L2 titles (e.g. "Lead a weekly engineering knowledge-
            // share session") should wrap, not push the card wider.
            // `text-wrap: pretty` plus `overflow-wrap: break-word` keeps
            // even hyphenated words tidy on narrow tiles.
            overflowWrap: "break-word",
            wordBreak: "normal",
            textWrap: "pretty",
          }}
          title={title}
        >
          {title}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col">{children}</div>

      {/* Cadence stepper — per-window fill/status gauge for MANUAL widgets.
          Read-only (Phase 1). Gated on the manual variant so AUTO tiles don't
          mount the goal-inputs subscription. */}
      {spec && SPEC_KIND_META[spec.widget]?.variant === SPEC_VARIANTS.MANUAL ? (
        <CadenceStepper spec={spec} variant={variant} />
      ) : null}

      {/* Achievement-tier ladder (AI-graded). Renders only once the goal
          has been re-analyzed with the four `tiers` — shows the dev where
          they stand against not-achieved / achieved / over / role-model. */}
      {spec?.tiers ? <GoalTierLadder spec={spec} variant={variant} /> : null}

      {(spec?.reasoning || onRetry || onReanalyze || footer || onMarkDelegated || onEditContext) ? (
        <div
          className="mt-3 flex items-center justify-between gap-2 border-t pt-2"
          style={{ borderColor: theme.divider }}
        >
          <div className="flex min-w-0 items-center gap-2 flex-wrap">
            {spec?.reasoning ? (
              <FooterChip theme={theme} onClick={() => setShowReason((s) => !s)}>
                {showReason ? "hide why" : "why?"}
              </FooterChip>
            ) : null}
            {onEditContext ? (
              <FooterChip theme={theme} onClick={onEditContext}>
                edit truths
              </FooterChip>
            ) : null}
            {onMarkDelegated ? (
              <FooterChip theme={theme} onClick={onMarkDelegated}>
                delegate
              </FooterChip>
            ) : null}
            {footer}
          </div>
          {canReanalyze ? (
            <FooterChip theme={theme} onClick={handleReanalyze}>
              {reanalyzing ? "re-analyzing…" : "re-analyze"}
            </FooterChip>
          ) : null}
        </div>
      ) : null}

      {showReason && spec?.reasoning ? (
        <div
          className="mt-2 rounded-[var(--radius-sub)] p-2"
          style={{
            background: theme.surface,
            color: theme.mutedColor,
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            lineHeight: 1.45,
          }}
        >
          {spec.reasoning}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Footer chip — small uppercase mono link-style button used for the
 * "why?", "re-analyze", "delegate", "edit truths" footer row. Internal
 * helper, not exported: widgets express footer intent through the
 * WidgetControls context, not by rendering chips directly.
 */
function FooterChip({ theme, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="uppercase transition-colors hover:opacity-90"
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 9.5,
        letterSpacing: "0.5px",
        color: theme.mutedColor,
        background: "transparent",
      }}
    >
      {children}
    </button>
  );
}

/**
 * Tiny helper component: the "target X" chip that auto widgets show when
 * a source has a target. Exported so widgets can opt-in inline.
 */
export function TargetChip({ target, unit, variant = "light" }) {
  if (!target) return null;
  const isLight = variant === "light";
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-[2px] font-semibold uppercase"
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 9.5,
        letterSpacing: "0.4px",
        background: isLight ? "rgba(255,255,255,0.18)" : "var(--accent-dim)",
        color: isLight ? "#ffffff" : "var(--accent)",
      }}
    >
      target {target.op} {target.value}
      {unit ? ` ${unit}` : ""}
    </span>
  );
}

export const WIDGET_VARIANT_STYLES = VARIANT_STYLES;
