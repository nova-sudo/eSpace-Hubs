"use client";

/**
 * Small presentational pieces shared by the four admin pages. They live
 * here rather than in `components/ui` because they are admin-shaped
 * (a status chip that knows the account vocabulary, a confirm dialog
 * worded for destructive org-wide toggles) and nothing outside this hub
 * would import them. Everything is built from design-system tokens.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, MoreHorizontal } from "lucide-react";
import { Badge, Button, Label, useFocusTrap } from "@/components/ui";
import { cn } from "@/lib/cn";
import { statusMeta } from "./admin-lib";

/* ─────────────────────────── status ─────────────────────────── */

/** The account state as a dot badge, in Okta's human phrasing. */
export function StatusBadge({ status, className }) {
  const meta = statusMeta(status);
  return (
    <Badge tone={meta.tone} dot className={className}>
      {meta.label}
    </Badge>
  );
}

/* ──────────────────────────── chips ──────────────────────────── */

/**
 * A filter chip that toggles rather than opens a menu — the barrel's
 * `FilterChip` is a "Label: Value ▾" trigger, which is the wrong
 * affordance for a one-click status filter.
 */
export function FilterPill({ label, count, active, onClick, onCard = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-[var(--radius-pill)] px-3.5 text-[12.5px] transition-colors",
        active
          ? "bg-ink text-ink-on font-bold"
          : cn("text-fg font-semibold", onCard ? "bg-card-alt" : "bg-card"),
      )}
    >
      {label}
      {count != null ? (
        <Badge tone={active ? "ink" : "neutral"}>{count}</Badge>
      ) : null}
    </button>
  );
}

/** An on/off pill for a role, a hub or an integration. */
export function TogglePill({ checked, disabled, onClick, title, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={checked}
      className={cn(
        "rounded-[var(--radius-pill)] px-3 py-1.5 text-[12px] font-semibold transition-colors",
        checked ? "bg-ink text-ink-on" : "bg-card-alt text-muted-fg",
        disabled && "cursor-not-allowed opacity-55",
      )}
    >
      {children}
    </button>
  );
}

/* ─────────────────────────── key/value ─────────────────────────── */

/** One label-and-value line inside a panel, separated by a hairline. */
export function MetaRow({ label, children, first = false }) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 py-2.5",
        first ? null : "border-t border-line",
      )}
    >
      <Label className="w-[104px] shrink-0">{label}</Label>
      <div className="min-w-0 flex-1 text-[12.5px] text-fg">{children}</div>
    </div>
  );
}

/* ─────────────────────────── empty state ─────────────────────────── */

export function EmptyState({ title, body, action }) {
  return (
    <div className="px-2 py-10 text-center">
      <div className="text-[15px] font-bold text-fg">{title}</div>
      {body ? (
        <p className="mx-auto mt-1.5 max-w-[420px] text-[13px] leading-[1.55] text-muted-fg">
          {body}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/* ─────────────────────────── overflow menu ─────────────────────────── */

const MENU_WIDTH = 214;

/**
 * The `⋯` on a table row. Closes on outside click, on Escape, and after
 * any item runs. Items are `{ label, onSelect, danger?, disabled? }`.
 *
 * Rendered into a portal with fixed positioning, because the members
 * table is a horizontal scroller inside a rounded card — an absolutely
 * positioned panel would be clipped by both. The trade-off is that a
 * fixed panel doesn't follow a scroll, so any scroll closes it.
 */
export function OverflowMenu({ items = [], label = "More actions" }) {
  const [anchor, setAnchor] = useState(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const open = anchor !== null;

  useEffect(() => {
    if (!open) return undefined;
    const close = () => setAnchor(null);
    const onDown = (e) => {
      if (menuRef.current?.contains(e.target)) return;
      if (buttonRef.current?.contains(e.target)) return;
      close();
    };
    const onKey = (e) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const usable = items.filter(Boolean);
  if (usable.length === 0) return null;

  function toggle(e) {
    e.stopPropagation();
    if (open) {
      setAnchor(null);
      return;
    }
    const r = buttonRef.current?.getBoundingClientRect();
    if (!r) return;
    setAnchor({
      top: Math.round(r.bottom + 6),
      left: Math.round(Math.max(8, r.right - MENU_WIDTH)),
    });
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
        onClick={toggle}
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-card-alt",
          open ? "bg-card-alt text-fg" : "text-dim-fg",
        )}
      >
        <MoreHorizontal size={16} />
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              aria-label={label}
              className="fixed z-50 overflow-hidden rounded-[var(--radius-lg)] bg-card p-1.5"
              style={{
                top: anchor.top,
                left: anchor.left,
                width: MENU_WIDTH,
                boxShadow: "var(--shadow-float)",
              }}
            >
              {usable.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  onClick={(e) => {
                    e.stopPropagation();
                    setAnchor(null);
                    item.onSelect?.();
                  }}
                  className={cn(
                    "block w-full rounded-[var(--radius-md)] px-3 py-2 text-left text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45",
                    item.danger
                      ? "text-peach-ink hover:bg-peach"
                      : "text-fg hover:bg-card-alt",
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/* ─────────────────────────── confirm ─────────────────────────── */

/**
 * The one confirmation surface for this hub. Every destructive act —
 * hiding a page from the whole org, disabling a hub, clearing someone's
 * authenticator, wiping their dashboard data — routes through it, so
 * none of them is ever one unguarded click.
 *
 *   const confirm = useConfirm();
 *   confirm({ title, body, confirmLabel, onConfirm });
 *   …
 *   {confirm.dialog}
 */
export function useConfirm() {
  const [request, setRequest] = useState(null);

  const ask = (next) => setRequest(next);
  ask.dialog = request ? (
    <ConfirmDialog
      {...request}
      onClose={() => setRequest(null)}
      onConfirm={() => {
        setRequest(null);
        request.onConfirm?.();
      }}
    />
  ) : null;

  return ask;
}

function ConfirmDialog({
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "danger",
  onConfirm,
  onClose,
}) {
  const trapRef = useFocusTrap(true);
  const restoreRef = useRef(null);

  useEffect(() => {
    restoreRef.current =
      typeof document !== "undefined" ? document.activeElement : null;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      restoreRef.current?.focus?.();
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  // Portaled: AppShell wraps the page in a transformed wrapper (the
  // analyst slide), and a transform makes `fixed` resolve against that
  // wrapper rather than the viewport — so an in-place dialog lands at
  // the top of the document instead of the middle of the screen.
  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-fg/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={trapRef}
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="w-[440px] max-w-full rounded-[var(--radius-xl)] bg-card p-6"
        style={{ boxShadow: "var(--shadow-float)" }}
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className={cn(
              "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
              tone === "danger" ? "bg-peach text-peach-ink" : "bg-lemon text-lemon-ink",
            )}
          >
            <AlertTriangle size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[18px] font-bold tracking-[-0.01em] text-fg">
              {title}
            </h2>
            {body ? (
              <p className="mt-2 text-[13px] leading-[1.55] text-muted-fg">{body}</p>
            ) : null}
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="soft" size="sm" onClick={onClose}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={tone === "danger" ? "danger" : "ink"}
            size="sm"
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
