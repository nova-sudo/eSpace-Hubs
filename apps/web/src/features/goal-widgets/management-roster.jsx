"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "@/lib/api-client";

/**
 * The roster half of a management plan: who reports to this person, and what
 * they've actually been filling in.
 *
 * TWO STATES, and which one you get is not up to the user:
 *
 *   1. NOT LINKED YET — a tiny onboarding asking for the email addresses of
 *      the people they manage. Typing an address does NOT grant anything; it
 *      is checked against the reporting links an admin already made, and an
 *      unmatched address comes back as "not linked" with no hint about
 *      whether that person even exists. The read is authorised by the link,
 *      never by the claim.
 *   2. LINKED — a deliberately small board: one row per report, how many
 *      cadence windows they've filled, and when they last logged anything.
 *      Enough to know who's drifting, not a second manager hub.
 *
 * Owed-ness is not shown here. Deriving it needs the client-side window engine
 * per report per goal, and a wrong "3 overdue" next to someone's name is worse
 * than an honest "12 windows filled · last week".
 */

const MONO = { fontFamily: "var(--font-mono)", fontSize: 10 };

function relativeDay(ts) {
  if (!ts) return "never";
  const days = Math.floor((Date.now() - ts) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/** Parses whatever the user pasted — commas, semicolons, newlines, spaces. */
function parseEmails(raw) {
  return [
    ...new Set(
      String(raw || "")
        .split(/[\s,;]+/)
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.includes("@")),
    ),
  ].slice(0, 25);
}

export function ManagementRoster({ variant = "dark", className = "" }) {
  const isLight = variant === "light";
  const tone = useMemo(
    () => ({
      fg: isLight ? "#ffffff" : "var(--fg)",
      muted: isLight ? "rgba(255,255,255,0.68)" : "var(--muted-fg)",
      faint: isLight ? "rgba(255,255,255,0.45)" : "var(--border-strong)",
      rule: isLight ? "rgba(255,255,255,0.22)" : "var(--border)",
      surface: isLight ? "rgba(255,255,255,0.10)" : "var(--card-alt)",
    }),
    [isLight],
  );

  const [state, setState] = useState({ status: "loading", reports: [] });
  const [draft, setDraft] = useState("");
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState(null);

  const load = useCallback(async () => {
    const res = await apiGet("/my-reports/fills");
    if (!res.ok) {
      setState({ status: "error", reports: [], message: res.error?.message || "" });
      return;
    }
    setState({ status: "ready", reports: res.data?.reports ?? [] });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const check = useCallback(async () => {
    const emails = parseEmails(draft);
    if (emails.length === 0) {
      setCheckResult({ linked: [], unlinked: [], empty: true });
      return;
    }
    setChecking(true);
    try {
      const res = await apiPost("/my-reports/resolve", { emails });
      if (!res.ok) {
        setCheckResult({ linked: [], unlinked: [], error: res.error?.message || "" });
        return;
      }
      setCheckResult(res.data);
      // A match means the link already existed — pull the board in.
      if ((res.data?.linked || []).length > 0) await load();
    } finally {
      setChecking(false);
    }
  }, [draft, load]);

  if (state.status === "loading") {
    return (
      <span style={{ ...MONO, fontSize: 9.5, color: tone.faint }} className={className}>
        loading your team&hellip;
      </span>
    );
  }

  const reports = state.reports || [];

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {reports.length === 0 ? (
        <div className="flex flex-col gap-1.5">
          <span style={{ ...MONO, fontSize: 9.5, color: tone.muted, lineHeight: 1.5 }}>
            Who do you manage? Add their work emails — you&apos;ll see what they&apos;ve
            been logging, once an admin has assigned them to you.
          </span>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            placeholder="someone@espace.com.eg, another@espace.com.eg"
            className="w-full rounded-[var(--radius-sub)] px-2 py-1.5"
            style={{
              ...MONO,
              fontSize: 10,
              color: tone.fg,
              background: "transparent",
              border: `1px solid ${tone.rule}`,
              resize: "vertical",
            }}
          />
          <button
            type="button"
            onClick={() => void check()}
            disabled={checking}
            className="w-fit rounded-[var(--radius-sub)] px-2 py-1 uppercase"
            style={{
              ...MONO,
              fontSize: 9,
              letterSpacing: "0.5px",
              color: tone.fg,
              background: "transparent",
              border: `1px solid ${tone.rule}`,
              cursor: checking ? "default" : "pointer",
            }}
          >
            {checking ? "checking…" : "check"}
          </button>

          {checkResult?.unlinked?.length > 0 ? (
            <span style={{ ...MONO, fontSize: 9.5, color: tone.muted, lineHeight: 1.5 }}>
              Not linked to you yet: {checkResult.unlinked.join(", ")}. An admin sets
              who reports to whom — ask them to assign these people to you, then
              check again.
            </span>
          ) : null}
          {checkResult?.empty ? (
            <span style={{ ...MONO, fontSize: 9.5, color: tone.faint }}>
              Add at least one email address.
            </span>
          ) : null}
        </div>
      ) : (
        <ul className="flex list-none flex-col gap-1 p-0">
          {reports.map((r) => {
            const windows = (r.goals || []).reduce(
              (n, g) => n + (g.filled?.length || 0),
              0,
            );
            const tracked = (r.goals || []).length;
            return (
              <li
                key={r.id}
                className="flex items-center justify-between gap-2 rounded-[var(--radius-sub)] px-2 py-1.5"
                style={{ background: tone.surface }}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate" style={{ ...MONO, fontSize: 10.5, color: tone.fg }}>
                    {r.name}
                  </span>
                  <span style={{ ...MONO, fontSize: 9, color: tone.faint }}>
                    {tracked} {tracked === 1 ? "goal" : "goals"} logged
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end">
                  <span style={{ ...MONO, fontSize: 10, color: tone.fg }}>
                    {windows} {windows === 1 ? "window" : "windows"}
                  </span>
                  <span style={{ ...MONO, fontSize: 9, color: tone.muted }}>
                    {relativeDay(r.lastAt)}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
