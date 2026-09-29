"use client";

/**
 * The report's side of a manager grade: "Mark as seen" / "I disagree"
 * (with a note), the current acknowledgement ("Seen 21 Sep", "You
 * disagreed: …") with a "Change" to revise it, and a "History" dialog
 * listing every grade on the goal.
 *
 *   POST /goal-verdicts/mine/:goalId/acknowledge   { disagree, note }
 *   GET  /goal-verdicts/mine/:goalId/history
 *
 * Reads the manager-verdict cache directly (it carries `ack` and
 * `periodKey`), and writes the server's fresh copy back into it after an
 * acknowledgement. A new grade from the manager clears the ack
 * server-side, so the buttons come back on their own.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Badge, Button, Label, useFocusTrap } from "@/components/ui";
import { apiGet, apiPost } from "@/lib/api-client";
import {
  applyManagerVerdict,
  getManagerVerdictsServerSnapshot,
  getManagerVerdictsSnapshot,
  readManagerVerdict,
  subscribeManagerVerdicts,
} from "./manager-verdict-store";
import { TIER_LABELS } from "./use-goal-tier";
import { tierTone } from "./tier-colors";

function shortDate(iso) {
  const t = Date.parse(iso ?? "");
  if (Number.isNaN(t)) return null;
  return new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function acknowledgePath(goalId) {
  return `/goal-verdicts/mine/${encodeURIComponent(goalId)}/acknowledge`;
}

export function ManagerGradeAck({ goalId }) {
  useSyncExternalStore(
    subscribeManagerVerdicts,
    getManagerVerdictsSnapshot,
    getManagerVerdictsServerSnapshot,
  );
  const mv = readManagerVerdict(goalId);
  // null → show the current state; "choose" → the two actions; "disagree" → note composer.
  const [mode, setMode] = useState(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  // Set after a disagreement is sent in this session — the confirmation.
  const [sent, setSent] = useState(false);
  // What happened after the report's LAST disagreement, once the manager
  // re-graded (a new grade clears the ack): "Mona regraded to Achieved" /
  // "Mona kept Achieved". Read from the history, only when there's a fresh
  // grade with no ack of its own (the moment it's worth saying).
  const [outcome, setOutcome] = useState(null);
  const eventKey = mv?.eventId ?? mv?.gradedAt ?? null;
  const hasAck = Boolean(mv?.ack);
  useEffect(() => {
    if (!goalId || !eventKey || hasAck) {
      setOutcome(null);
      return undefined;
    }
    let cancelled = false;
    void apiGet(`/goal-verdicts/mine/${encodeURIComponent(goalId)}/history`).then((r) => {
      if (cancelled || !r.ok || !Array.isArray(r.data?.history)) return;
      setOutcome(disputeOutcome(r.data.history));
    });
    return () => {
      cancelled = true;
    };
  }, [goalId, eventKey, hasAck]);

  if (!goalId || !mv) return null;
  const ack = mv.ack ?? null;
  const showActions = mode === "choose" || (!ack && mode === null);
  const managerName = mv.gradedByName || "your manager";
  const noteEmpty = note.trim().length === 0;

  async function send(disagree) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await apiPost(acknowledgePath(goalId), {
      disagree,
      note: disagree ? note.trim() : "",
      ...(mv.eventId ? { eventId: mv.eventId } : {}),
    });
    setBusy(false);
    if (!r.ok) {
      setError(
        r.error?.code === "verdict_changed"
          ? "Your manager just updated this grade. Reload the page to see it."
          : r.status === 429
            ? "Too many updates. Wait a moment and try again."
            : "Couldn't save that. Try again in a moment.",
      );
      return;
    }
    if (r.data?.verdict) applyManagerVerdict(goalId, r.data.verdict);
    setSent(disagree);
    setMode(null);
  }

  const historyLink = (
    <button
      type="button"
      onClick={() => setHistoryOpen(true)}
      className="text-[12px] font-semibold underline-offset-2 hover:underline"
    >
      History
    </button>
  );

  return (
    <div className="mt-2.5 flex flex-col gap-2">
      {mode === "disagree" ? (
        <div className="flex flex-col gap-2">
          <label className="text-[12px] font-semibold" htmlFor={`ack-note-${goalId}`}>
            What doesn&apos;t fit? Your manager sees this with the grade.
          </label>
          <textarea
            id={`ack-note-${goalId}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={2000}
            rows={3}
            placeholder="e.g. The Q3 release landed after the snapshot this grade used."
            className="w-full resize-y rounded-[var(--radius-lg)] bg-card p-3 text-[13px] leading-[1.45] text-fg border border-field-line outline-none focus:ring-2 focus:ring-ink"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={() => send(true)}
              disabled={busy || noteEmpty}
              title={noteEmpty ? "Say what doesn't fit first." : undefined}
            >
              {busy ? "Sending…" : `Send to ${managerName.split(" ")[0]}`}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMode(null)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      ) : showActions ? (
        <div className="flex flex-col gap-2">
        {outcome ? <div className="text-[12.5px] font-bold">{outcome}</div> : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => send(false)} disabled={busy}>
            {busy ? "Saving…" : "Mark as seen"}
          </Button>
          <Button
            size="sm"
            variant="soft"
            onClick={() => {
              setNote(ack?.disagree ? ack.note ?? "" : "");
              setMode("disagree");
            }}
            disabled={busy}
          >
            I disagree
          </Button>
          {ack ? (
            <Button size="sm" variant="ghost" onClick={() => setMode(null)} disabled={busy}>
              Cancel
            </Button>
          ) : null}
          <span className="flex-1" />
          {historyLink}
        </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
          {ack.disagree ? (
            <span className="min-w-0 flex-1">
              <span className="font-bold">You disagreed</span>
              {ack.note ? `: ${ack.note}` : ""}
              {shortDate(ack.at) ? ` · ${shortDate(ack.at)}` : ""}
              <span className="mt-0.5 block" role={sent ? "status" : undefined}>
                {sent ? "Sent to " : "With "}
                <b>{managerName}</b>
                {sent
                  ? " · they'll see it on your board."
                  : " · waiting for them to look again."}
              </span>
            </span>
          ) : (
            <span className="min-w-0 flex-1 font-bold">Seen {shortDate(ack.at) ?? ""}</span>
          )}
          <button
            type="button"
            onClick={() => setMode("choose")}
            className="text-[12px] font-semibold underline-offset-2 hover:underline"
          >
            Change
          </button>
          {historyLink}
        </div>
      )}
      {error ? <div className="text-[12px] text-peach-text">{error}</div> : null}
      <GradeHistoryDialog
        goalId={goalId}
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
      />
    </div>
  );
}

/**
 * What the manager did after the report's last disagreement, from the
 * oldest-first history — or null when the latest grade wasn't a response
 * to one. The CURRENT grade is the last row; the disagreement sits on the
 * row before it.
 */
export function disputeOutcome(history) {
  const rows = Array.isArray(history) ? history : [];
  if (rows.length < 2) return null;
  const latest = rows[rows.length - 1];
  const prev = rows[rows.length - 2];
  if (!prev?.ack?.disagree || latest?.ack) return null;
  const who = latest.gradedByName || "Your manager";
  const label = TIER_LABELS[latest.tier] ?? latest.tier;
  return latest.tier === prev.tier
    ? `${who} looked again after your disagreement and kept ${label}.`
    : `${who} regraded after your disagreement, from ${TIER_LABELS[prev.tier] ?? prev.tier} to ${label}.`;
}

function GradeHistoryDialog({ goalId, open, onClose }) {
  const trapRef = useFocusTrap(open);
  const [state, setState] = useState({ loading: false, history: [], error: null });

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setState({ loading: true, history: [], error: null });
    void apiGet(`/goal-verdicts/mine/${encodeURIComponent(goalId)}/history`).then((r) => {
      if (cancelled) return;
      setState({
        loading: false,
        history: r.ok && Array.isArray(r.data?.history) ? r.data.history : [],
        error: r.ok ? null : "error",
      });
    });
    return () => {
      cancelled = true;
    };
  }, [open, goalId]);

  // Escape closes. The handler reads the latest onClose through a ref so
  // a parent re-render (the verdict cache ticking) never refetches.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") closeRef.current?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open || typeof document === "undefined") return null;
  // Newest first reads best in a dialog; the API sends oldest first.
  const rows = [...state.history].reverse();

  return createPortal(
    <>
      <div className="fixed inset-0 z-[70] bg-scrim" onClick={onClose} aria-hidden="true" />
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label="Grade history"
        className="fixed left-1/2 top-1/2 z-[71] flex max-h-[min(560px,calc(100vh-48px))] w-[min(480px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-[var(--radius-xl)] bg-card p-6 text-fg"
        style={{ boxShadow: "var(--shadow-float)" }}
      >
        <h2 className="text-[18px] font-bold tracking-[-0.01em]">Grade history</h2>
        <p className="mt-1 text-[12.5px] text-muted-fg">
          Every grade your manager has given this goal, newest first.
        </p>
        <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
          {state.loading ? (
            <p className="text-[13px] text-muted-fg">Loading…</p>
          ) : state.error ? (
            <p className="text-[13px] text-muted-fg">Couldn&apos;t load the history right now.</p>
          ) : rows.length === 0 ? (
            <p className="text-[13px] text-muted-fg">No grades yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {rows.map((h, i) => (
                <li
                  key={h.id ?? `${h.gradedAt}-${i}`}
                  className="rounded-[var(--radius-lg)] bg-card-alt p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={tierTone(h.tier)}>{TIER_LABELS[h.tier] ?? h.tier}</Badge>
                    <Label>{h.periodKey}</Label>
                    {h.supersededAt ? <Badge>Replaced</Badge> : null}
                    <span className="flex-1" />
                    <span className="text-[11.5px] text-muted-fg">
                      {h.gradedByName || "Your manager"} · {shortDate(h.gradedAt)}
                    </span>
                  </div>
                  {h.previousTier && h.previousTier !== h.tier ? (
                    <div className="mt-1.5 text-[12px] text-muted-fg">
                      Changed from {TIER_LABELS[h.previousTier] ?? h.previousTier}
                    </div>
                  ) : null}
                  {h.note ? (
                    <p className="mt-1.5 text-[12.5px] leading-[1.5]">{h.note}</p>
                  ) : null}
                  {h.ack ? (
                    <div className="mt-1.5 text-[12px] text-muted-fg">
                      {h.ack.disagree
                        ? `You disagreed${h.ack.note ? `: ${h.ack.note}` : ""}`
                        : "You marked this as seen"}
                      {shortDate(h.ack.at) ? ` · ${shortDate(h.ack.at)}` : ""}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="mt-5 flex justify-end">
          <Button type="button" variant="soft" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </>,
    document.body,
  );
}
