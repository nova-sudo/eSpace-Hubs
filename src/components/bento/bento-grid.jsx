"use client";

import { cn } from "@/lib/utils";

export function BentoGrid({ className, children }) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-4 md:grid-cols-4 lg:grid-cols-6 auto-rows-[10rem]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function BentoTile({
  className,
  title,
  subtitle,
  icon: Icon,
  action,
  children,
  colSpan = "md:col-span-2",
  rowSpan = "row-span-2",
  tone,
}) {
  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-border bg-card/60 p-5 shadow-sm backdrop-blur-sm transition-all",
        "hover:border-primary/40 hover:shadow-md",
        tone === "primary" && "bg-gradient-to-br from-primary/10 via-card to-card",
        tone === "success" && "bg-gradient-to-br from-success/10 via-card to-card",
        tone === "warning" && "bg-gradient-to-br from-warning/10 via-card to-card",
        tone === "danger" && "bg-gradient-to-br from-danger/10 via-card to-card",
        colSpan,
        rowSpan,
        className,
      )}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
            <span>{title}</span>
          </div>
          {subtitle ? (
            <div className="mt-0.5 truncate text-xs text-muted-foreground/70">{subtitle}</div>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="h-[calc(100%-2.5rem)]">{children}</div>
    </div>
  );
}

export function TileEmpty({ message = "Connect an integration to see this tile.", cta }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
      <div className="text-sm text-muted-foreground">{message}</div>
      {cta ? <div>{cta}</div> : null}
    </div>
  );
}

export function TileMetric({ value, hint, trend }) {
  return (
    <div className="flex h-full flex-col justify-end">
      <div className="flex items-baseline gap-2">
        <div className="text-4xl font-semibold tabular-nums tracking-tight">{value}</div>
        {trend ? (
          <div
            className={cn(
              "text-xs font-medium",
              trend.startsWith("+") && "text-success",
              trend.startsWith("-") && "text-danger",
            )}
          >
            {trend}
          </div>
        ) : null}
      </div>
      {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}
