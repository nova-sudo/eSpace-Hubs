"use client";

/**
 * "Notes from your manager" — the one-to-one notes a manager chose to share
 * with this report (GET /my-manager-notes). Private notes never reach this
 * endpoint. Renders nothing until there is at least one shared note, so a
 * report without a manager (or without shared notes) sees no empty card.
 */

import { useState } from "react";
import useSWR from "swr";
import { Card, Label } from "@/components/ui";
import { useSession } from "@/features/auth";
import { apiGet } from "@/lib/api-client";

const COLLAPSED = 3;

async function fetchNotes() {
  const r = await apiGet("/my-manager-notes");
  if (!r.ok) throw new Error(r.error?.message || "Couldn't load notes");
  return Array.isArray(r.data?.notes) ? r.data.notes : [];
}

function fmtDate(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function ManagerNotesCard({ className }) {
  // Keyed by the signed-in user: another account signing in on this tab
  // (no reload) must never be shown the previous user's shared notes from
  // the SWR cache. No user → no fetch.
  const { user } = useSession();
  const { data: notes } = useSWR(
    user?.id ? ["my-manager-notes", user.id] : null,
    fetchNotes,
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
  const [expanded, setExpanded] = useState(false);
  if (!Array.isArray(notes) || notes.length === 0) return null;

  const shown = expanded ? notes : notes.slice(0, COLLAPSED);
  return (
    <Card className={className}>
      <div className="flex items-baseline justify-between gap-3">
        <Label>Notes from your manager</Label>
        <span className="text-[12px] text-muted-fg">
          {notes.length} shared with you
        </span>
      </div>
      <ul className="mt-3 flex flex-col gap-3">
        {shown.map((n) => (
          <li key={n.id} className="flex flex-col gap-1">
            <p className="whitespace-pre-wrap text-[13.5px] leading-[1.55] text-fg">{n.body}</p>
            <span className="text-[12px] text-muted-fg">
              {n.managerName ? `${n.managerName} · ` : ""}
              {fmtDate(n.updatedAt || n.createdAt)}
              {n.updatedAt && n.createdAt && n.updatedAt !== n.createdAt ? " · edited" : ""}
            </span>
          </li>
        ))}
      </ul>
      {notes.length > COLLAPSED ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 text-[13px] font-semibold text-fg hover:underline"
        >
          {expanded ? "Show fewer" : `Show all ${notes.length}`}
        </button>
      ) : null}
    </Card>
  );
}
