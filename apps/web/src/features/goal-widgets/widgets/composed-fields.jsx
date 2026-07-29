"use client";

/**
 * ComposedFields — the field body of a COMPOSED widget, scoped to ONE period.
 *
 * Shared by the COMPOSED widget (renders the CURRENT period) and the cadence
 * stepper (renders a SELECTED past/current period for backfill). Period-aware:
 * each entry is `{ periodKey, values, evidence }`, so a quarterly COMPOSED goal
 * resets every quarter and you can fill any quarter independently. `periodKey`
 * is null for non-bucketing / cadence-less goals (one running record).
 *
 * Reads/writes the goal-inputs store directly; renders one control per field
 * kind plus optional per-field evidence.
 *
 * AUTO FIELDS. A field may carry `source` — an allowlisted query the server
 * resolves against GitHub/GitLab on the user's behalf. Such a field is never a
 * writable control. The failure we are designing against is a field that is
 * supposed to measure itself rendering as an empty text box: the user types
 * "yes, the file is there", and the goal now records a claim where it promised
 * a measurement. So an auto field renders read-only in exactly three honest
 * states — loading, resolved, unavailable — and "unavailable" always names
 * WHICH kind, because "we couldn't find it" and "you haven't connected GitHub"
 * ask the user for completely different things.
 *
 * WHERE THE RESOLVED VALUE GOES. Into `values`, alongside what the user typed,
 * WITH its provenance recorded beside it:
 *
 *   { periodKey, values, evidence, auto: { [fieldId]: {
 *       value, extract, provider, query, describe, fetchedAt } } }
 *
 * Both halves matter. The grader, Evidence and the manager projection read
 * `values` and only `values`, so a reading parked anywhere else is invisible to
 * every one of them — the widget would show "3/3 captured" while the grader was
 * told the period was empty, and a tracker with one required auto field could
 * never complete. `auto` then keeps "the repo says" distinguishable from "the
 * user claims", which is a separate question from whether the value counts.
 *
 * WHEN IT IS WRITTEN. Only when the user saves the period — never on fetch.
 * That distinction is load-bearing rather than tidiness: any entry inside a
 * window marks that window filled (entryFilled, goal-inputs/cadence-windows.js),
 * so writing on fetch meant merely OPENING a tracker completed the period and
 * fed it to the compliance ratio a manager reads. Via the stepper it was worse —
 * a past window is stamped with THAT window's timestamp, so clicking into a
 * missed Q1 wrote today's repo state onto Q1 and marked it satisfied. A reading
 * is a fact about now; it only becomes a claim about a period when someone
 * deliberately saves that period.
 *
 * An unavailable result never overwrites a good saved reading — a GitHub blip
 * should not erase evidence the repo already gave us.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGoalInputs } from "@/features/goal-inputs";
import { Select, Checkbox, ItemEvidence } from "@/components/ui";
import { apiPost } from "@/lib/api-client";
// Namespace import, deliberately: the plain-English description is authored by
// the shared query-template registry, but the server sends its own copy along
// with the reading (it knows the RESOLVED provider, we only know the spec). We
// prefer the server's and fall back to the registry, so neither side is a hard
// dependency of the other.
import * as sharedGoalSpecs from "@espace-devhub/shared/goal-specs";

/** Re-read a stored reading after this long even if nothing changed. */
const AUTO_REFRESH_MS = 6 * 60 * 60 * 1000;

/**
 * Error codes that mean "the integration isn't there", as opposed to "the query
 * ran and found nothing". Matched loosely because the executor owns the exact
 * vocabulary; anything unrecognised degrades to the vaguer-but-still-honest
 * "couldn't resolve" rather than telling the user to reconnect a provider that
 * is in fact connected.
 */
function unavailableReason(error) {
  const code = String(error?.code || "");
  if (/not_connected|disconnected|no_integration|missing_token|unauthor/i.test(code)) {
    return "disconnected";
  }
  return "unresolved";
}

function isAutoField(f) {
  return !!(f && f.source && typeof f.source === "object" && f.source.query);
}

function hasValue(v, kind) {
  if (kind === "checkbox") return v === true;
  return v != null && v !== "";
}

/** Format a resolved primitive for display, per the extractor that produced it. */
function formatAuto(value, extract) {
  if (value == null) return "—";
  switch (extract) {
    case "exists":
      return value ? "Present" : "Missing";
    case "ratio": {
      const n = Number(value);
      return Number.isFinite(n) ? `${Math.round(n * 100)}%` : String(value);
    }
    case "latest_date": {
      const d = new Date(String(value));
      return Number.isNaN(d.getTime()) ? String(value) : d.toISOString().slice(0, 10);
    }
    case "count":
    default:
      return typeof value === "boolean" ? (value ? "Yes" : "No") : String(value);
  }
}

function fetchedLabel(ts) {
  if (!ts) return null;
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return "checked just now";
  if (mins < 60) return `checked ${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `checked ${hrs}h ago`;
  return `checked ${Math.round(hrs / 24)}d ago`;
}

/** Best available one-sentence description of what this field queries. */
function sourceSentence(field, resolved) {
  if (resolved?.describe) return resolved.describe;
  try {
    return sharedGoalSpecs.describeQuerySource?.(field.source) || null;
  } catch {
    return null;
  }
}

export function ComposedFields({ goalId, fields, periodKey = null, writeTs = null, variant = "light", showHeadline = true }) {
  const { entries, append } = useGoalInputs(goalId);
  const list = Array.isArray(fields) ? fields : [];

  const record = useMemo(() => {
    const all = entries || [];
    const matching = all.filter((e) =>
      periodKey == null
        ? e?.value && e.value.periodKey == null
        : e?.value?.periodKey === periodKey,
    );
    const latest = matching[matching.length - 1];
    return latest?.value && typeof latest.value === "object" ? latest.value : {};
  }, [entries, periodKey]);

  const values = record.values && typeof record.values === "object" ? record.values : {};
  const evidence = record.evidence && typeof record.evidence === "object" ? record.evidence : {};
  const savedAuto = record.auto && typeof record.auto === "object" ? record.auto : {};

  /**
   * Readings fetched this session, not yet committed to a period. Kept apart
   * from `savedAuto` — what was captured when the period was saved — because
   * the two answer different questions: "what does the repo say right now" and
   * "what did we record for that period". Display prefers the live one; the
   * saved one is what the grader and Evidence already agreed on.
   */
  const [liveAuto, setLiveAuto] = useState({});
  const auto = useMemo(() => ({ ...savedAuto, ...liveAuto }), [savedAuto, liveAuto]);

  // Two auto fields resolving in the same tick would each merge off the same
  // stale render and the second append would drop the first. The ref carries
  // what we just wrote forward until the store round-trips.
  const recordRef = useRef(record);
  recordRef.current = record;
  // `write` is invoked from event handlers that close over an older render, so
  // it reads live readings through a ref rather than the state value directly —
  // otherwise a user editing a manual field would commit the period WITHOUT the
  // readings fetched moments earlier.
  const liveAutoRef = useRef(liveAuto);
  liveAutoRef.current = liveAuto;

  const isLight = variant === "light";
  const tone = isLight ? "inverse" : "default";
  const muted = isLight ? "rgba(255,255,255,0.68)" : "var(--muted-fg)";
  const fg = isLight ? "#ffffff" : "var(--fg)";
  const fieldBg = isLight ? "rgba(255,255,255,0.10)" : "var(--bg)";
  const fieldBorder = isLight ? "1px solid rgba(255,255,255,0.22)" : "1px solid var(--border-strong)";

  function write(nextValues, nextEvidence, nextAuto) {
    const carried =
      nextAuto ?? {
        ...(recordRef.current?.auto || {}),
        ...(liveAutoRef.current || {}),
      };
    // Machine readings go into `values` alongside everything the user typed,
    // NOT into a private bucket. The grader, Evidence and the manager
    // projection all read `values` and only `values` — a reading parked
    // anywhere else is invisible to every one of them, so the tracker would
    // show "3/3 captured" while the grader was told the period was empty.
    // Provenance is kept beside it in `auto` so "the repo says" stays
    // distinguishable from "the user claims"; that's a separate question from
    // whether the value counts.
    const merged = { ...nextValues };
    if (carried) {
      for (const [id, reading] of Object.entries(carried)) {
        if (reading && reading.value != null) merged[id] = reading.value;
      }
    }
    const payload = { values: merged, evidence: nextEvidence };
    // Only ever present when the tracker actually has auto fields — a spec with
    // no source keeps writing byte-identical entries to the ones already in
    // Mongo, which is what backward compatibility means here.
    if (carried && Object.keys(carried).length > 0) payload.auto = carried;
    if (periodKey != null) payload.periodKey = periodKey;
    recordRef.current = payload;
    // Stamp the entry inside the period being filled (writeTs = period midpoint
    // when backfilling a past window from the stepper). Without this, append
    // defaults to Date.now() and a backfilled quarter lands in the CURRENT
    // window — so the stepper never marks that past period filled.
    append(payload, undefined, writeTs ?? undefined);
  }
  function setValue(id, v) {
    write({ ...values, [id]: v }, evidence);
  }
  function setEvidence(id, text) {
    const ne = { ...evidence };
    if (text) ne[id] = text;
    else delete ne[id];
    write(values, ne);
  }

  /**
   * Hold a freshly-fetched reading in component state. Deliberately does NOT
   * persist.
   *
   * Writing on fetch was a data-integrity bug, not just noise. Any entry inside
   * a window makes that window "filled" (see entryFilled in
   * goal-inputs/cadence-windows.js), so merely OPENING a tracker marked the
   * period complete and fed it to the compliance ratio the manager reads.
   * Through the stepper it was worse: a past window is written with that
   * window's timestamp, so clicking into a missed Q1 stamped TODAY's repo state
   * onto Q1 and flipped it to satisfied. The tracker was manufacturing evidence
   * that the goal had been met.
   *
   * A reading is a fact about now. It becomes a claim about a PERIOD only when
   * the user saves that period — an act they take deliberately — at which point
   * `write` folds it into `values` with its provenance.
   */
  const recordAuto = useCallback((fieldId, reading) => {
    setLiveAuto((prev) => {
      const prevReading = prev[fieldId];
      if (
        prevReading &&
        JSON.stringify(prevReading.value ?? null) === JSON.stringify(reading.value ?? null) &&
        prevReading.provider === reading.provider
      ) {
        return prev;
      }
      return { ...prev, [fieldId]: reading };
    });
  }, []);

  // An auto field is "captured" when the repo answered, not when someone typed.
  const filled = list.filter((f) =>
    isAutoField(f) ? auto[f.id]?.value != null : hasValue(values[f.id], f.kind),
  ).length;
  const total = list.length;

  const inputStyle = {
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    color: fg,
    background: fieldBg,
    border: fieldBorder,
    borderRadius: "var(--radius-sub)",
    padding: "4px 7px",
    outline: "none",
    width: "100%",
    minWidth: 0,
  };

  function control(f) {
    const v = values[f.id];
    switch (f.kind) {
      case "checkbox":
        return (
          <Checkbox
            checked={v === true}
            onChange={() => setValue(f.id, v !== true)}
          />
        );
      case "counter": {
        const n = Number.isFinite(Number(v)) ? Number(v) : 0;
        return (
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => setValue(f.id, Math.max(0, n - 1))} style={{ ...inputStyle, width: 26, textAlign: "center", cursor: "pointer" }} aria-label={`decrease ${f.label}`}>−</button>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: fg, minWidth: 28, textAlign: "center" }}>
              {n}
              {f.unit ? <span style={{ fontSize: 9.5, color: muted }}> {f.unit}</span> : null}
            </span>
            <button type="button" onClick={() => setValue(f.id, n + 1)} style={{ ...inputStyle, width: 26, textAlign: "center", cursor: "pointer" }} aria-label={`increase ${f.label}`}>+</button>
          </div>
        );
      }
      case "scale":
        return (
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setValue(f.id, n)}
                style={{
                  ...inputStyle,
                  width: 26,
                  textAlign: "center",
                  cursor: "pointer",
                  background: Number(v) === n ? (isLight ? "#ffffff" : "var(--accent)") : fieldBg,
                  color: Number(v) === n ? (isLight ? "var(--accent)" : "var(--accent-on)") : fg,
                }}
              >
                {n}
              </button>
            ))}
          </div>
        );
      case "number":
        return (
          <input type="number" value={v ?? ""} onChange={(e) => setValue(f.id, e.target.value === "" ? "" : Number(e.target.value))} placeholder={f.unit ? f.unit : "value"} style={{ ...inputStyle, width: 110 }} />
        );
      case "date":
        return (
          <input type="date" value={typeof v === "string" ? v : ""} onChange={(e) => setValue(f.id, e.target.value)} style={{ ...inputStyle, width: 150, colorScheme: isLight ? "dark" : "light" }} />
        );
      case "select":
        return (
          <Select
            tone={tone}
            size="sm"
            value={typeof v === "string" ? v : ""}
            onChange={(e) => setValue(f.id, e.target.value)}
            style={{ minWidth: 120 }}
          >
            <option value="">—</option>
            {(f.options || []).map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </Select>
        );
      case "link":
        return (
          <input type="url" value={typeof v === "string" ? v : ""} onChange={(e) => setValue(f.id, e.target.value)} placeholder="https://…" style={inputStyle} />
        );
      case "text":
      default:
        return (
          <input type="text" value={typeof v === "string" ? v : ""} onChange={(e) => setValue(f.id, e.target.value)} placeholder={f.help || "…"} style={inputStyle} />
        );
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {showHeadline ? (
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: muted }}>
          {filled}/{total} captured
        </div>
      ) : null}
      {list.length === 0 ? (
        <div style={{ fontSize: 11, color: muted }}>No fields defined for this widget yet.</div>
      ) : null}
      {list.map((f) =>
        isAutoField(f) ? (
          <AutoField
            key={f.id}
            goalId={goalId}
            field={f}
            periodKey={periodKey}
            stored={auto[f.id]}
            muted={muted}
            fg={fg}
            fieldBg={fieldBg}
            fieldBorder={fieldBorder}
            onResolved={recordAuto}
          />
        ) : (
          <div key={f.id} className="flex min-w-0 flex-col gap-1">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <span className="min-w-0 flex-1 truncate" style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: muted }} title={f.label}>
                {f.label}
                {f.optional ? <span style={{ opacity: 0.6 }}> (optional)</span> : null}
              </span>
              {f.kind === "checkbox" ? control(f) : null}
            </div>
            {f.kind === "checkbox" ? null : <div className="min-w-0">{control(f)}</div>}
            {f.kind === "link" ? null : (
              <div className="min-w-0">
                <ItemEvidence value={evidence[f.id]} variant={variant} onSave={(t) => setEvidence(f.id, t)} />
              </div>
            )}
          </div>
        ),
      )}
    </div>
  );
}

/**
 * One read-only field backed by an allowlisted provider query.
 *
 * Owns its own fetch so a slow or broken repo lookup can't hold up the fields
 * beside it — each auto field succeeds or fails on its own terms, and the user
 * can see which one is the problem.
 *
 * No <ItemEvidence> here on purpose: evidence exists so a person can justify
 * what they entered, and nothing on this field was entered. The repo is the
 * evidence, and the description below the value says which repo.
 */
function AutoField({ goalId, field, periodKey, stored, muted, fg, fieldBg, fieldBorder, onResolved }) {
  const [state, setState] = useState(() =>
    stored ? { status: "resolved", reading: stored } : { status: "loading" },
  );
  const [nonce, setNonce] = useState(0);

  // Held in a ref so re-creating the callback upstream can't re-trigger a fetch.
  const onResolvedRef = useRef(onResolved);
  onResolvedRef.current = onResolved;

  const storedAt = stored?.fetchedAt || 0;
  const fresh = storedAt > 0 && Date.now() - storedAt < AUTO_REFRESH_MS;

  useEffect(() => {
    if (!goalId || !field?.id) {
      setState({ status: "unavailable", reason: "unresolved" });
      return undefined;
    }
    // A reading taken hours ago is still the answer; don't re-hit the provider
    // (and don't flash a spinner) just because the widget re-mounted.
    if (fresh && nonce === 0) return undefined;

    let cancelled = false;
    setState((prev) =>
      prev.status === "resolved" ? { ...prev, busy: true } : { status: "loading" },
    );
    // The server holds the source: we name the goal and the field, it looks up
    // the spec, picks the template, and builds the URL. Sending the source from
    // here would hand the browser a say in which URL gets called with the
    // user's token, which is the whole thing this design refuses to do.
    // periodKey matters: per-period content can REDEFINE fields, so the same
    // field id may carry a different source in week 9 than in week 1. Without
    // it the server matches the first definition it finds and silently runs the
    // wrong period's query.
    apiPost("/integrations/query-field", {
      goalId,
      fieldId: field.id,
      ...(periodKey != null ? { periodKey } : {}),
    }).then((r) => {
      if (cancelled) return;
      if (!r.ok) {
        setState({
          status: "unavailable",
          reason: unavailableReason(r.error),
          message: r.error?.message || null,
        });
        return;
      }
      const body = r.data && typeof r.data === "object" ? r.data : {};
      const d = body.field && typeof body.field === "object" ? body.field : body;
      if (d.ok === false || d.status === "unavailable" || d.value === undefined) {
        setState({
          status: "unavailable",
          reason: unavailableReason({ code: d.reason || d.code }),
          message: typeof d.message === "string" ? d.message : null,
        });
        return;
      }
      const reading = {
        value: d.value ?? null,
        extract: typeof d.extract === "string" ? d.extract : field.source?.extract || null,
        provider: typeof d.provider === "string" ? d.provider : null,
        query: typeof d.query === "string" ? d.query : field.source?.query || null,
        describe: typeof d.describe === "string" ? d.describe : null,
        fetchedAt: typeof d.fetchedAt === "number" ? d.fetchedAt : Date.now(),
      };
      setState({ status: "resolved", reading });
      onResolvedRef.current?.(field.id, reading);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goalId, field?.id, nonce]);

  const reading = state.reading || null;
  const sentence = sourceSentence(field, reading);
  const providerLabel = reading?.provider || (field.source?.provider !== "ask" ? field.source?.provider : null);

  const boxStyle = {
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    color: fg,
    background: fieldBg,
    border: fieldBorder,
    borderRadius: "var(--radius-sub)",
    padding: "5px 8px",
    minWidth: 0,
  };

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span
          className="min-w-0 flex-1 truncate"
          style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: muted }}
          title={field.label}
        >
          {field.label}
        </span>
        <span
          className="flex-none uppercase"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 8.5,
            letterSpacing: "0.08em",
            fontWeight: 700,
            color: muted,
            border: fieldBorder,
            borderRadius: "var(--radius-sub)",
            padding: "1px 4px",
          }}
          title="Read automatically — nothing to fill in"
        >
          auto{providerLabel ? ` · ${providerLabel}` : ""}
        </span>
      </div>

      {state.status === "loading" ? (
        <div style={{ ...boxStyle, color: muted }}>Reading…</div>
      ) : state.status === "resolved" ? (
        <div style={boxStyle}>
          {formatAuto(reading?.value, reading?.extract)}
          {state.busy ? <span style={{ fontSize: 9.5, color: muted }}> · refreshing</span> : null}
        </div>
      ) : (
        <div className="flex min-w-0 items-center gap-2">
          <div style={{ ...boxStyle, color: muted, flex: 1 }}>
            {state.reason === "disconnected"
              ? "Not connected — link the provider in Settings"
              : "Couldn't read this yet"}
          </div>
          <button
            type="button"
            onClick={() => setNonce((n) => n + 1)}
            style={{ ...boxStyle, fontSize: 10, cursor: "pointer", color: muted }}
          >
            Retry
          </button>
        </div>
      )}

      {sentence ? (
        <div style={{ fontSize: 10, lineHeight: 1.4, color: muted }}>{sentence}</div>
      ) : null}
      {state.status === "resolved" && reading?.fetchedAt ? (
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, color: muted, opacity: 0.85 }}>
          {fetchedLabel(reading.fetchedAt)}
        </div>
      ) : state.status === "unavailable" && state.message ? (
        <div style={{ fontSize: 9.5, lineHeight: 1.4, color: muted, opacity: 0.85 }}>
          {state.message}
        </div>
      ) : null}
    </div>
  );
}
