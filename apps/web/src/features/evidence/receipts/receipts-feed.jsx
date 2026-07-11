"use client";

/**
 * Receipts feed — the chronological timeline (EvidC). Day-group headers over a
 * hairline rail; each receipt is a card with a colored type tag (PR / TICKET /
 * REVIEW), title, meta, an optional "→ <jira key>" linkage chip, and a
 * timestamp. Presentation only — the normalized groups come from
 * useReceiptsFeed().
 */

const KIND_STYLE = {
  PR: { color: "var(--accent)", dot: "var(--accent)" },
  TICKET: { color: "var(--good)", dot: "var(--good)" },
  REVIEW: { color: "var(--warn)", dot: "var(--warn)" },
};

function tagBg(color) {
  return `color-mix(in srgb, ${color} 16%, transparent)`;
}

export function ReceiptsFeed({ groups, loading }) {
  if (loading && (!groups || groups.length === 0)) {
    return (
      <div
        className="rounded-[10px] border border-border bg-card px-4 py-10 text-center text-[13px] text-muted-fg"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        Reading your receipts…
      </div>
    );
  }
  if (!groups || groups.length === 0) {
    return (
      <div
        className="rounded-[10px] border border-dashed border-border-strong bg-card px-4 py-10 text-center text-[13px] text-muted-fg"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        Nothing shipped in this window yet. Merged MRs, closed tickets, and
        reviews you give will show up here.
      </div>
    );
  }

  return (
    <div className="relative pl-[26px]">
      {/* rail */}
      <div
        aria-hidden="true"
        className="absolute bottom-1.5 left-[5px] top-1.5 w-px"
        style={{ background: "var(--border)" }}
      />
      {groups.map((group) => (
        <div key={group.label}>
          <div
            className="relative py-1 uppercase tracking-[1.5px] text-dim-fg"
            style={{ fontFamily: "var(--font-mono)", fontSize: 9 }}
          >
            <span
              aria-hidden="true"
              className="absolute left-[-26px] top-1/2 h-[7px] w-[7px] -translate-y-1/2 rounded-full"
              style={{ background: "var(--bg)", border: "1px solid var(--border-strong)" }}
            />
            {group.label}
          </div>
          {group.items.map((r) => (
            <ReceiptRow key={r.id} r={r} />
          ))}
        </div>
      ))}
    </div>
  );
}

function ReceiptRow({ r }) {
  const kind = KIND_STYLE[r.kind] || KIND_STYLE.PR;
  const inner = (
    <div className="rounded-[10px] border border-border bg-card px-[15px] py-[13px] transition-colors hover:border-border-strong">
      <div className="flex items-center gap-2.5">
        <span
          className="shrink-0 rounded-[4px] px-[7px] py-[3px] uppercase tracking-[0.5px]"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 8.5,
            fontWeight: 700,
            color: kind.color,
            background: tagBg(kind.color),
          }}
        >
          {r.kind}
        </span>
        <span
          className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-fg"
          title={r.title}
        >
          {r.title}
        </span>
        <span
          className="shrink-0 text-dim-fg"
          style={{ fontFamily: "var(--font-mono)", fontSize: 9 }}
        >
          {r.time}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span
          className="uppercase tracking-[0.5px] text-muted-fg"
          style={{ fontFamily: "var(--font-mono)", fontSize: 9 }}
        >
          {r.meta}
        </span>
        {r.goalTag ? (
          <span
            className="ml-auto rounded-full border border-border px-2 py-[3px] uppercase tracking-[0.5px] text-accent"
            style={{ fontFamily: "var(--font-mono)", fontSize: 8.5 }}
          >
            → {r.goalTag}
          </span>
        ) : null}
      </div>
    </div>
  );

  return (
    <div className="relative mb-3.5">
      <span
        aria-hidden="true"
        className="absolute left-[-26px] top-[15px] h-[11px] w-[11px] rounded-full"
        style={{ background: "var(--bg)", border: `2px solid ${kind.dot}` }}
      />
      {r.href ? (
        <a href={r.href} target="_blank" rel="noreferrer" className="block">
          {inner}
        </a>
      ) : (
        inner
      )}
    </div>
  );
}
