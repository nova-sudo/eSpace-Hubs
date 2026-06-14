"use client";

import Link from "next/link";
import { cn } from "@/lib/cn";
import { providerListLabel } from "./provider-dependencies";

const COPY = {
  disconnected: {
    title: "Source disconnected",
    action: "Connect",
  },
  loading: {
    title: "Checking source",
    action: null,
  },
  error: {
    title: "Source unavailable",
    action: "Review setup",
  },
  degraded: {
    title: "Partial source",
    action: "Review setup",
  },
  empty: {
    title: "No data yet",
    action: null,
  },
};

const DOT = {
  disconnected: "var(--accent)",
  loading: "var(--muted-fg)",
  error: "var(--bad)",
  degraded: "#b45309",
  empty: "var(--muted-fg)",
};

export function ProviderStateCallout({
  kind = "empty",
  providers = [],
  title,
  message,
  actionHref,
  actionLabel,
  variant = "default",
  className,
}) {
  const copy = COPY[kind] ?? COPY.empty;
  const sourceLabel = providerListLabel(providers);
  const resolvedTitle = title || copy.title;
  const resolvedMessage =
    message ||
    (sourceLabel
      ? `${sourceLabel} is needed for this metric.`
      : "This metric has no source data yet.");
  const resolvedAction = actionLabel || copy.action;
  const accent = variant === "accent";

  return (
    <div
      className={cn(
        "flex h-full min-h-0 w-full flex-col justify-center rounded-[var(--radius-tile)] border px-3 py-3",
        accent
          ? "border-[rgba(255,255,255,0.28)] bg-[rgba(255,255,255,0.10)] text-white"
          : "border-border bg-card-alt text-fg",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="inline-block h-2 w-2 shrink-0 rounded-full"
          style={{ background: DOT[kind] ?? DOT.empty }}
        />
        <span
          className={cn(
            "text-[10.5px] font-semibold uppercase tracking-[0.35px]",
            accent ? "text-[rgba(255,255,255,0.86)]" : "text-muted-fg",
          )}
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {resolvedTitle}
        </span>
      </div>
      <p
        className={cn(
          "mt-2 max-w-[34ch] text-[12px] leading-[1.45]",
          accent ? "text-[rgba(255,255,255,0.78)]" : "text-muted-fg",
        )}
      >
        {resolvedMessage}
      </p>
      {actionHref && resolvedAction ? (
        <Link
          href={actionHref}
          className={cn(
            "mt-3 inline-flex w-fit items-center rounded-[var(--radius-sub)] border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.35px] transition-colors",
            accent
              ? "border-[rgba(255,255,255,0.34)] text-white hover:bg-[rgba(255,255,255,0.12)]"
              : "border-border text-fg hover:border-border-strong",
          )}
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {resolvedAction}
        </Link>
      ) : null}
    </div>
  );
}
