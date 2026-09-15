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
 * Reads/writes the goal-inputs store directly. Layout is claim-and-proof (see
 * field-block.jsx): each field is one object holding what you're claiming and
 * what backs it, side by side. This file owns the DATA — the store read/write,
 * the auto-field fetch and the control switch; the block owns how it looks.
 *
 * Why the two halves: evidence used to be a grey line under every field,
 * indistinguishable whether it held a link to a report or nothing at all, so
 * it went unfilled — and the tier grader folds `evidence` into the data it
 * judges. A period could read "5/5 captured" while giving the grader bare
 * booleans to rule on. Proof now has a state (field-status.js) and the header
 * counts answers and proof separately.
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
import { Badge, Button, Input, Select, Checkbox, Label } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  FIELD_KIND_HINT,
  TARGET_OP_LABEL,
  hasValue,
  isAutoField,
  meetsTarget,
  proofState,
  summarizeFields,
} from "../field-status";
import { AnswerRow, FieldBlock, ProofCell } from "./field-block.jsx";
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

export function ComposedFields({ goalId, fields, periodKey = null, writeTs = null, variant: _variant = "light", showHeadline = true }) {
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

  // Answered vs backed-by-proof, counted separately — the whole point of the
  // claim-and-proof layout is that those are two different questions, and the
  // old single "5/5 captured" line could read complete on a period carrying no
  // justification for anything. An auto field is answered when the repo
  // replied, not when someone typed.
  const summary = useMemo(
    () => summarizeFields({ fields: list, values, evidence, auto }),
    [list, values, evidence, auto],
  );

  /**
   * The target a spec set for a measurement, shown beside it. Display-only —
   * the grader has its own numeric path — but it answers "what counts as
   * good", which today's form never says out loud. Mint only once it's met;
   * neutral otherwise, so a half-typed "2" on the way to "20" never flashes
   * a failure at someone mid-entry.
   */
  function targetBadge(f, v) {
    if (!f.target || typeof f.target !== "object") return null;
    const op = TARGET_OP_LABEL[f.target.op] || f.target.op;
    return (
      <Badge tone={meetsTarget(f.target, v) ? "mint" : "neutral"} className="shrink-0">
        {op} {f.target.value}
        {f.unit ? ` ${f.unit}` : ""}
      </Badge>
    );
  }

  /**
   * The claim half of a field.
   *
   * Every branch returns a 44px row on `bg-card`, which is what gives the
   * column a single left edge and one height — the old switch returned a
   * 110px input here, a small pill there and a bare checkbox somewhere else.
   * Controls built from chips (checkbox / counter / scale) get an explicit
   * <AnswerRow> because they have no fill of their own; the primitives carry
   * `bg-card` directly, overriding their resting `bg-card-alt`, which on this
   * block's own `bg-card-alt` would be invisible.
   */
  function control(f) {
    const v = values[f.id];
    switch (f.kind) {
      case "checkbox":
        return (
          <AnswerRow>
            <Checkbox
              checked={v === true}
              onChange={() => setValue(f.id, v !== true)}
              label={f.label || f.id}
            />
            {/* The word is the checkbox's answer in plain language. The old
                layout put the box at the far right of the row, a full label
                away from the question it answered. */}
            <span className={cn("text-[13px]", v === true ? "text-fg" : "text-dim-fg")}>
              {v === true ? "Yes" : "Not yet"}
            </span>
          </AnswerRow>
        );
      case "counter": {
        const n = Number.isFinite(Number(v)) ? Number(v) : 0;
        return (
          <AnswerRow>
            <button
              type="button"
              onClick={() => setValue(f.id, Math.max(0, n - 1))}
              className="h-7 w-7 shrink-0 rounded-[var(--radius-md)] bg-card-alt text-[13px] font-bold text-fg"
              aria-label={`decrease ${f.label}`}
            >
              −
            </button>
            <span className="min-w-[28px] text-center text-[14px] text-fg">
              {n}
              {f.unit ? <span className="text-[11.5px] text-muted-fg"> {f.unit}</span> : null}
            </span>
            <button
              type="button"
              onClick={() => setValue(f.id, n + 1)}
              className="h-7 w-7 shrink-0 rounded-[var(--radius-md)] bg-card-alt text-[13px] font-bold text-fg"
              aria-label={`increase ${f.label}`}
            >
              +
            </button>
            {targetBadge(f, n)}
          </AnswerRow>
        );
      }
      case "scale":
        return (
          <AnswerRow className="gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setValue(f.id, n)}
                aria-pressed={Number(v) === n}
                className={cn(
                  "h-7 w-7 rounded-[var(--radius-md)] text-[13px] font-bold transition-colors",
                  Number(v) === n ? "bg-ink text-ink-on" : "bg-card-alt text-fg",
                )}
              >
                {n}
              </button>
            ))}
          </AnswerRow>
        );
      case "number":
        return (
          <div className="flex min-h-[44px] min-w-0 items-center gap-2">
            <Input
              type="number"
              value={v ?? ""}
              onChange={(e) => setValue(f.id, e.target.value === "" ? "" : Number(e.target.value))}
              placeholder="0"
              aria-label={f.label}
              className="w-[92px] shrink-0 bg-card"
            />
            {f.unit ? <span className="shrink-0 text-[12.5px] text-muted-fg">{f.unit}</span> : null}
            {targetBadge(f, v)}
          </div>
        );
      case "date":
        return (
          <Input
            type="date"
            value={typeof v === "string" ? v : ""}
            onChange={(e) => setValue(f.id, e.target.value)}
            aria-label={f.label}
            className="bg-card"
          />
        );
      case "select":
        return (
          <Select
            value={typeof v === "string" ? v : ""}
            onChange={(e) => setValue(f.id, e.target.value)}
            aria-label={f.label}
            className="w-full bg-card"
          >
            <option value="">—</option>
            {(f.options || []).map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </Select>
        );
      case "link":
        return (
          <Input
            type="url"
            value={typeof v === "string" ? v : ""}
            onChange={(e) => setValue(f.id, e.target.value)}
            placeholder="https://…"
            aria-label={f.label}
            className="bg-card"
          />
        );
      case "text":
      default:
        return (
          <Input
            type="text"
            value={typeof v === "string" ? v : ""}
            onChange={(e) => setValue(f.id, e.target.value)}
            placeholder={f.help || "…"}
            aria-label={f.label}
            className="bg-card"
          />
        );
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {showHeadline ? (
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <Label>
            <span className="font-bold text-fg">{summary.answered}</span> of {summary.total} answered
          </Label>
          {/* Proof gets its own count, and its own nudge when something is
              owed. One combined "captured" number let a period read finished
              while carrying no justification for any of it — which is the
              number the tier grader then had to judge. */}
          {summary.owed > 0 ? (
            <Badge tone="lemon">
              {summary.owed} need{summary.owed === 1 ? "s" : ""} proof
            </Badge>
          ) : summary.proofable > 0 ? (
            <Label>
              {summary.withProof} of {summary.proofable} with proof
            </Label>
          ) : null}
        </div>
      ) : null}
      {list.length === 0 ? <div className="text-[13px] text-muted-fg">No fields defined for this widget yet.</div> : null}
      {list.map((f) =>
        isAutoField(f) ? (
          <AutoField key={f.id} goalId={goalId} field={f} periodKey={periodKey} stored={auto[f.id]} onResolved={recordAuto} />
        ) : (
          <FieldBlock
            key={f.id}
            label={f.label}
            optional={f.optional}
            kind={FIELD_KIND_HINT[f.kind] || null}
            captured={hasValue(values[f.id], f.kind)}
            answer={control(f)}
            /* A link field has no second half: the URL the user pasted IS the
               evidence, so asking for proof of it would be asking twice. The
               caption carries that instead of a redundant empty column. */
            answerCaption={f.kind === "link" ? "Evidence link" : "Answer"}
            proof={
              f.kind === "link" ? null : (
                <ProofCell
                  state={proofState({ field: f, value: values[f.id], evidence: evidence[f.id] })}
                  value={evidence[f.id]}
                  onSave={(t) => setEvidence(f.id, t)}
                />
              )
            }
          />
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
 * No user-supplied proof here on purpose: evidence exists so a person can
 * justify what they entered, and nothing on this field was entered. The repo
 * is the evidence, so the proof half names the query instead.
 */
function AutoField({ goalId, field, periodKey, stored, onResolved }) {
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
  const resolved = state.status === "resolved";

  /**
   * An auto field is the layout's best case rather than its exception: the
   * repo reading IS a claim, and the query behind it IS the proof. So it uses
   * the same two halves as a typed field, with "Source" naming the second one
   * — the user supplies no evidence here, and asking them to would invite a
   * sentence about a measurement they didn't take.
   */
  return (
    <FieldBlock
      label={field.label}
      captured={resolved && reading?.value != null}
      kind={
        <Badge tone="lav" title="Read automatically — nothing to fill in">
          Auto{providerLabel ? ` · ${providerLabel}` : ""}
        </Badge>
      }
      proofCaption="Source"
      answer={
        state.status === "loading" ? (
          <AnswerRow>
            <span className="text-[13px] text-muted-fg">Reading…</span>
          </AnswerRow>
        ) : resolved ? (
          <AnswerRow>
            <span className="min-w-0 truncate text-[13px] font-semibold text-fg">
              {formatAuto(reading?.value, reading?.extract)}
            </span>
            {state.busy ? <span className="shrink-0 text-[11.5px] text-muted-fg">refreshing</span> : null}
          </AnswerRow>
        ) : (
          <AnswerRow className="justify-between pr-1.5">
            <span className="min-w-0 flex-1 truncate text-[13px] text-muted-fg">
              {state.reason === "disconnected"
                ? "Not connected — link the provider in Settings"
                : "Couldn't read this yet"}
            </span>
            <Button size="sm" variant="soft" className="shrink-0" onClick={() => setNonce((n) => n + 1)}>
              Retry
            </Button>
          </AnswerRow>
        )
      }
      proof={
        <div className="flex min-h-[44px] min-w-0 flex-col justify-center gap-0.5">
          {sentence ? (
            <span className="text-[12px] leading-[1.4] text-muted-fg">{sentence}</span>
          ) : null}
          {resolved && reading?.fetchedAt ? (
            <span className="text-[11.5px] text-dim-fg">{fetchedLabel(reading.fetchedAt)}</span>
          ) : state.status === "unavailable" && state.message ? (
            <span className="text-[11.5px] leading-[1.4] text-dim-fg">{state.message}</span>
          ) : null}
        </div>
      }
    />
  );
}
