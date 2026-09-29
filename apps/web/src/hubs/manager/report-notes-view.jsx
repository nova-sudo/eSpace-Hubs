"use client";

/**
 * Report board "Notes" tab — the manager's running 1:1 / check-in
 * journal for one report, so the evidence trail stays in the product.
 *
 * A composer on top (text + who can read it), then the notes newest
 * first, each editable in place and deletable behind a confirmation.
 * "Only you" notes are private to their author; "Shared" notes are
 * readable by the report too. Data: use-report-notes.js.
 */

import { useState } from "react";
import { Badge, Button, Card, Label, SegmentedControl } from "@/components/ui";
import { ConfirmDialog } from "./confirm-dialog";
import { EmptyCard } from "./manager-ui";
import { onDate } from "./manager-format";
import { useReportNotes } from "./use-report-notes";

const TEXTAREA =
  "w-full resize-y rounded-[var(--radius-lg)] bg-card-alt p-3.5 text-[13px] leading-[1.55] text-fg border border-field-line outline-none focus:ring-2 focus:ring-ink";

function visibilityOptions(firstName) {
  return [
    { value: "private", label: "Only you" },
    { value: "shared-with-report", label: `Shared with ${firstName}` },
  ];
}

export function ReportNotesView({ userId, user }) {
  const firstName = (user?.displayName ?? "them").split(/\s+/)[0];
  const { loading, error, notes, create, update, remove } = useReportNotes(userId);
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState("private");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [deleting, setDeleting] = useState(false);

  async function add(e) {
    e.preventDefault();
    if (!body.trim() || busy) return;
    setBusy(true);
    setFormError(null);
    const r = await create(body.trim(), visibility);
    setBusy(false);
    if (!r.ok) {
      setFormError("Couldn't save that note. Try again in a moment.");
      return;
    }
    setBody("");
  }

  async function confirmDelete() {
    if (!confirmId) return;
    setDeleting(true);
    await remove(confirmId);
    setDeleting(false);
    setConfirmId(null);
  }

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="grid gap-3">
        <Card padding={18}>
          <form onSubmit={add} className="flex flex-col gap-3">
            <Label>New note</Label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={10000}
              rows={4}
              placeholder={`What did you and ${firstName} talk about? Wins, blockers, what you agreed to follow up on.`}
              className={TEXTAREA}
              aria-label="Note"
            />
            <div className="flex flex-wrap items-center gap-2.5">
              <SegmentedControl as="radiogroup" ariaLabel="Visibility"
                options={visibilityOptions(firstName)}
                value={visibility}
                onChange={setVisibility}
                size="sm"
              />
              <span className="flex-1" />
              <Button type="submit" size="sm" disabled={busy || !body.trim()}>
                {busy ? "Saving…" : "Add note"}
              </Button>
            </div>
            {formError ? <div className="text-[12.5px] text-peach-text">{formError}</div> : null}
          </form>
        </Card>

        {error ? (
          <EmptyCard>Couldn&apos;t load your notes right now.</EmptyCard>
        ) : loading && notes.length === 0 ? (
          <EmptyCard>Loading notes…</EmptyCard>
        ) : notes.length === 0 ? (
          <EmptyCard>
            No notes yet. Keep a running log of your 1:1s here — it sits next to
            their goals and grades when review time comes.
          </EmptyCard>
        ) : (
          notes.map((n) => (
            <NoteCard
              key={n.id}
              note={n}
              firstName={firstName}
              onSave={(patch) => update(n.id, patch)}
              onDelete={() => setConfirmId(n.id)}
            />
          ))
        )}
      </div>

      <Card padding={18}>
        <Label>Who sees these</Label>
        <p className="mt-2 text-[12.5px] leading-[1.55] text-muted-fg">
          &ldquo;Only you&rdquo; notes are private to you — not to {firstName}, not
          to a future manager. &ldquo;Shared&rdquo; notes can be read by {firstName}.
          You can change either at any time.
        </p>
      </Card>

      <ConfirmDialog
        open={!!confirmId}
        title="Delete this note?"
        body="It's removed for good — there's no undo."
        confirmLabel="Delete"
        busy={deleting}
        onConfirm={confirmDelete}
        onClose={() => setConfirmId(null)}
      />
    </div>
  );
}

function NoteCard({ note, firstName, onSave, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);
  const [visibility, setVisibility] = useState(note.visibility);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const shared = note.visibility === "shared-with-report";
  const edited = note.updatedAt && note.updatedAt !== note.createdAt;

  async function save() {
    if (!draft.trim() || busy) return;
    setBusy(true);
    setError(null);
    const r = await onSave({ body: draft.trim(), visibility });
    setBusy(false);
    if (!r.ok) {
      setError("Couldn't save your changes.");
      return;
    }
    setEditing(false);
  }

  return (
    <Card padding={18}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12.5px] font-bold text-fg">{onDate(note.createdAt)}</span>
        {edited ? <span className="text-[11.5px] text-muted-fg">· edited</span> : null}
        <Badge tone={shared ? "sky" : "neutral"}>
          {shared ? `Shared with ${firstName}` : "Only you"}
        </Badge>
        <span className="flex-1" />
        {!editing ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setDraft(note.body);
                setVisibility(note.visibility);
                setEditing(true);
              }}
            >
              Edit
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={onDelete}>
              Delete
            </Button>
          </>
        ) : null}
      </div>

      {editing ? (
        <div className="mt-3 flex flex-col gap-2.5">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={10000}
            rows={4}
            className={TEXTAREA}
            aria-label="Edit note"
          />
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl as="radiogroup" ariaLabel="Visibility"
              options={visibilityOptions(firstName)}
              value={visibility}
              onChange={setVisibility}
              size="sm"
            />
            <span className="flex-1" />
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={save} disabled={busy || !draft.trim()}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
          {error ? <div className="text-[12.5px] text-peach-text">{error}</div> : null}
        </div>
      ) : (
        <p className="mt-2.5 whitespace-pre-wrap text-[13px] leading-[1.6] text-fg">{note.body}</p>
      )}
    </Card>
  );
}
