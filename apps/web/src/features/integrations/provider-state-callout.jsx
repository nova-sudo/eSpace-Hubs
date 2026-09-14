"use client";

import Link from "next/link";
import { Card, Button } from "@/components/ui";
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

// Card tone per state: lemon = needs setup / stale, peach = error, sky = info.
const TONE = {
  disconnected: "lemon",
  loading: "sky",
  error: "peach",
  degraded: "lemon",
  empty: "sky",
};

export function ProviderStateCallout({
  kind = "empty",
  providers = [],
  title,
  message,
  actionHref,
  actionLabel,
  // `variant` is accepted for back-compat and no longer changes the look —
  // the tint tone now carries the state.
  variant: _variant,
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

  return (
    <Card
      tone={TONE[kind] ?? TONE.empty}
      radius="lg"
      className={cn("flex h-full min-h-0 w-full flex-col justify-center", className)}
      role="status"
      aria-live="polite"
    >
      <div className="text-[13px] font-bold">{resolvedTitle}</div>
      <p className="mt-1.5 max-w-[34ch] text-[13px] leading-[1.45] opacity-85">{resolvedMessage}</p>
      {actionHref && resolvedAction ? (
        <Link href={actionHref} className="mt-3 inline-flex w-fit">
          <Button variant="soft" size="sm">
            {resolvedAction}
          </Button>
        </Link>
      ) : null}
    </Card>
  );
}
