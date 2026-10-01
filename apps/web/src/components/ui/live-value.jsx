"use client";

/**
 * <LiveValue> — the one way a provider-backed number is shown.
 *
 * The rule: never make the user wait on GitHub to see a number they already
 * saw. The last-known value stays on screen while a refresh runs, a failure
 * keeps it with an "as of" and the reason, and only a genuinely first load
 * shows a skeleton the size of the number (never "—", never 0 — a zero is a
 * claim). Loading, refreshing, rate-limited, failed and empty each look
 * different. The mapping lives in `live-value-state.js` (pure, tested).
 *
 *   <LiveValue status={{ hasValue, pending, refreshing, error, rateLimitedUntil,
 *                        fetchedAt, provider: "GitHub" }}
 *              skeleton="w-[3ch]" onRetry={retry}>
 *     {count}
 *   </LiveValue>
 *
 * The value inherits the parent's type size, so the skeleton (1em tall)
 * matches the number it stands in for. Layouts:
 *   stack   (default) value, the note on its own line under it
 *   inline  value and note on one wrapping row
 *   compact value only; the note becomes a small status dot + tooltip
 *           (dense rows). Freshness for a quiet, up-to-date value is omitted.
 *
 * `<FreshnessNote>` is the note alone, for tiles that render their own value
 * block; `<ValueSkeleton>` is the placeholder alone.
 */

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/cn";
import { resolveLiveState } from "./live-value-state";

const NOTE_TONE = {
  quiet: "text-muted-fg",
  updating: "text-muted-fg",
  warn: "text-lemon-text",
  error: "text-peach-text",
};

const DOT_TONE = {
  updating: "bg-muted-fg motion-safe:animate-pulse",
  warn: "bg-lemon-text",
  error: "bg-peach-text",
};

/**
 * Resolve the state, re-rendering once a minute while a time-based note
 * ("updated 5 min ago", "refreshing at 11:05") is on screen so it never
 * freezes. Any status change re-renders through the caller anyway.
 */
function useLiveState(status) {
  const ticking = Boolean(status?.fetchedAt || status?.rateLimitedUntil);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!ticking) return undefined;
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, [ticking]);
  return resolveLiveState(status || {}, Date.now());
}

/** The number-sized placeholder for a first load. */
export function ValueSkeleton({ className, label = "Loading" }) {
  return (
    <span
      role="status"
      aria-label={label}
      className={cn(
        "inline-block h-[0.8em] w-[2.5ch] rounded-[6px] bg-track align-[-0.05em] motion-safe:animate-pulse",
        className,
      )}
    />
  );
}

function RetryButton({ onRetry, provider }) {
  if (!onRetry) return null;
  return (
    <button
      type="button"
      onClick={onRetry}
      className="inline-flex items-center gap-1 rounded-full font-semibold text-fg underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      aria-label={provider ? `Retry ${provider}` : "Retry"}
    >
      <RefreshCw size={11} aria-hidden="true" />
      Retry
    </button>
  );
}

function NoteLine({ state, onRetry, provider, className, prefix }) {
  if (!state.note) return null;
  return (
    <span
      className={cn(
        "inline-flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11.5px] font-medium leading-[1.4]",
        NOTE_TONE[state.tone] || "text-muted-fg",
        className,
      )}
      title={state.title || undefined}
      aria-live={state.tone === "quiet" ? undefined : "polite"}
    >
      {state.tone === "updating" ? (
        <span aria-hidden="true" className={cn("inline-block h-1.5 w-1.5 rounded-full", DOT_TONE.updating)} />
      ) : null}
      <span className="min-w-0">
        {prefix ? `${prefix} · ` : ""}
        {state.note}
      </span>
      {state.canRetry ? <RetryButton onRetry={onRetry} provider={provider} /> : null}
    </span>
  );
}

/**
 * The freshness / reason line on its own, for a tile that renders the value
 * itself (or with `<LiveValue hideNote>`). Renders nothing for a skeleton or
 * an empty state (the value slot says those); limited / error-with-no-value
 * reasons only with `showReasons` (the value slot usually says them too). `showQuiet=false` hides the
 * plain "updated 5 min ago" line when another element already says it.
 */
export function FreshnessNote({
  status,
  onRetry: onRetryProp,
  className,
  showQuiet = true,
  showReasons = false,
  prefix,
}) {
  const state = useLiveState(status);
  const onRetry = onRetryProp || status?.retry;
  if (showReasons && (state.kind === "limited" || state.kind === "error")) {
    return (
      <span
        className={cn(
          "inline-flex flex-wrap items-center gap-x-1.5 text-[11.5px] font-medium leading-[1.4]",
          NOTE_TONE[state.tone],
          className,
        )}
        title={state.title || undefined}
        aria-live="polite"
      >
        {state.message}
        {state.canRetry ? <RetryButton onRetry={onRetry} provider={status?.provider} /> : null}
      </span>
    );
  }
  if (state.kind !== "value") return null;
  if (!showQuiet && state.tone === "quiet") return null;
  return (
    <NoteLine state={state} onRetry={onRetry} provider={status?.provider} className={className} prefix={prefix} />
  );
}

/**
 * @param {object} props
 * @param {import("./live-value-state").LiveInput} props.status
 * @param {React.ReactNode} props.children   the rendered value (only used when there is one)
 * @param {string} [props.skeleton]          width class for the skeleton (e.g. "w-[3ch]")
 * @param {"stack"|"inline"|"compact"} [props.layout]
 * @param {() => void} [props.onRetry]
 * @param {boolean} [props.showQuiet]        show "updated N min ago" for an up-to-date value
 * @param {boolean} [props.hideNote]         value only — a <FreshnessNote> elsewhere says it
 * @param {string} [props.className]
 * @param {string} [props.messageClassName]  type for the text that replaces the value
 */
export function LiveValue({
  status,
  children,
  skeleton,
  layout = "stack",
  onRetry: onRetryProp,
  showQuiet = true,
  hideNote = false,
  className,
  messageClassName,
}) {
  const state = useLiveState(status);
  // A status from useLiveStatus carries its own retry.
  const onRetry = onRetryProp || status?.retry;
  const provider = status?.provider;

  if (state.kind === "skeleton") {
    return (
      <span className={cn("inline-flex", className)}>
        <ValueSkeleton className={skeleton} label={provider ? `Loading from ${provider}` : "Loading"} />
      </span>
    );
  }

  if (state.kind !== "value") {
    // limited / error / empty: the reason stands where the number would.
    const tone =
      state.kind === "limited" ? "text-lemon-text" : state.kind === "error" ? "text-peach-text" : "text-muted-fg";
    return (
      <span
        className={cn(
          // className first: the reason text keeps the slot's layout but
          // not its display-numeral type.
          className,
          "inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px] font-semibold leading-[1.35] tracking-normal",
          tone,
          messageClassName,
        )}
        title={state.title || undefined}
        role={state.kind === "empty" ? undefined : "status"}
      >
        {layout === "compact" && state.kind !== "empty" ? (
          <span className="sr-only">{state.message}</span>
        ) : null}
        <span aria-hidden={layout === "compact" && state.kind !== "empty" ? "true" : undefined}>
          {layout === "compact" && state.kind === "limited"
            ? "Paused"
            : layout === "compact" && state.kind === "error"
              ? "Unavailable"
              : state.message}
        </span>
        {state.canRetry && layout !== "compact" ? <RetryButton onRetry={onRetry} provider={provider} /> : null}
      </span>
    );
  }

  if (layout === "compact") {
    const dot = DOT_TONE[state.tone];
    return (
      <span
        className={cn("inline-flex items-center gap-1.5", className)}
        title={[state.note, state.title].filter(Boolean).join(" — ") || undefined}
        aria-busy={state.tone === "updating" ? "true" : undefined}
      >
        {children}
        {dot ? (
          <>
            <span aria-hidden="true" className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full", dot)} />
            <span className="sr-only">{state.note}</span>
          </>
        ) : null}
      </span>
    );
  }

  const showNote = !hideNote && state.note && (showQuiet || state.tone !== "quiet");
  return (
    <span
      className={cn(
        layout === "inline"
          ? "inline-flex flex-wrap items-baseline gap-x-2 gap-y-0.5"
          : "inline-flex flex-col items-start gap-1",
        className,
      )}
      aria-busy={state.tone === "updating" ? "true" : undefined}
    >
      <span className="inline-flex items-baseline">{children}</span>
      {showNote ? <NoteLine state={state} onRetry={onRetry} provider={provider} /> : null}
    </span>
  );
}
