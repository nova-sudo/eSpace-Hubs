"use client";

/**
 * Invite dialog — S5.
 *
 * Takes several addresses in one field as chips, one role set for the
 * whole batch, the hubs they may reach and who they report to, and
 * answers the question the old one-email-at-a-time form left open:
 * what does picking "dev" actually grant? The right-hand panel resolves
 * roles → capabilities → hubs → page slots through the same shared
 * registry the server uses, so the preview is the real answer rather
 * than a hand-written blurb.
 *
 * Wire protocol. `POST /auth/invite` takes one email and no hub or
 * manager fields, and answers `{ ok: true }` with no id — so the batch
 * posts one invite per address, then re-reads the roster and PATCHes
 * the freshly created rows with `allowedHubs` / `primaryHub` /
 * `managerId`. An invite that lands but fails its follow-up patch is
 * reported by name; it is not rolled back, because the person has the
 * mail already.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Sparkles, X } from "lucide-react";
import { apiGet, apiPatch, apiPost } from "@/lib/api-client";
import { Badge, Button, Field as UiField, Label, Select, useFocusTrap } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  HUBS,
  HUB_ORDER,
  resolveHubsForCapabilities,
} from "@espace-devhub/shared/hubs";
import { resolveCapabilities } from "@espace-devhub/shared/capabilities";
import { ALL_ROLES, isEmail, pageLabel, parseEmails } from "./admin-lib";
import { TogglePill } from "./admin-ui";

/** "nour.eldin@espace.com.eg" → "Nour Eldin". Refinable on accept. */
function nameFromEmail(email) {
  const local = String(email).split("@")[0] ?? "";
  const words = local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  return words.join(" ") || local || "New member";
}

/** The hubs a role set actually unlocks, in registry order. */
function hubsForRoles(roles) {
  return resolveHubsForCapabilities(resolveCapabilities(roles)).map((h) => h.id);
}

export function InviteDialog({ users = [], onClose, onSuccess }) {
  const [draft, setDraft] = useState("");
  const [emails, setEmails] = useState([]);
  const [roles, setRoles] = useState(["dev"]);
  const [hubs, setHubs] = useState(() => hubsForRoles(["dev"]));
  const [hubsTouched, setHubsTouched] = useState(false);
  const [managerId, setManagerId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [failures, setFailures] = useState([]);

  const trapRef = useFocusTrap(true);
  const emailInputRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, submitting]);

  // Until the admin overrides them by hand, the hub selection tracks
  // whatever the chosen roles grant.
  useEffect(() => {
    if (hubsTouched) return;
    setHubs(hubsForRoles(roles));
  }, [roles, hubsTouched]);

  const valid = emails.filter(isEmail);
  const invalid = emails.filter((e) => !isEmail(e));
  const primaryHub = HUB_ORDER.find((id) => hubs.includes(id)) ?? null;

  const managerCandidates = useMemo(
    () => users.filter((u) => u.status !== "disabled"),
    [users],
  );

  function commitDraft(raw) {
    const tokens = parseEmails(raw);
    if (tokens.length === 0) return;
    setEmails((prev) => [...prev, ...tokens.filter((t) => !prev.includes(t))]);
    setDraft("");
  }

  function handleDraftChange(e) {
    const value = e.target.value;
    // A separator means "that address is finished" — tokenise on the fly
    // so chips appear as the admin pastes a comma-separated list.
    if (/[\s,;]/.test(value)) {
      const parts = value.split(/[\s,;]+/);
      const tail = parts.pop() ?? "";
      commitDraft(parts.join(" "));
      setDraft(tail);
      return;
    }
    setDraft(value);
  }

  function handleDraftKeyDown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      commitDraft(draft);
      return;
    }
    if (e.key === "Backspace" && draft === "" && emails.length > 0) {
      setEmails((prev) => prev.slice(0, -1));
    }
  }

  function toggleRole(roleId) {
    setRoles((prev) => {
      if (prev.includes(roleId)) {
        if (prev.length === 1) return prev; // every invitee needs one role
        return prev.filter((r) => r !== roleId);
      }
      return [...prev, roleId];
    });
  }

  function toggleHub(hubId) {
    setHubsTouched(true);
    setHubs((prev) =>
      prev.includes(hubId) ? prev.filter((h) => h !== hubId) : [...prev, hubId],
    );
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setFailures([]);
    const pending = [...emails];
    if (draft.trim()) pending.push(...parseEmails(draft));
    const addresses = [...new Set(pending)];
    const good = addresses.filter(isEmail);
    const bad = addresses.filter((a) => !isEmail(a));

    if (good.length === 0) {
      setError("Add at least one valid email address.");
      return;
    }
    if (bad.length > 0) {
      setError(`Not an email address: ${bad.join(", ")}. Remove it and retry.`);
      return;
    }
    if (roles.length === 0) {
      setError("Pick at least one role for the batch.");
      return;
    }
    if (hubs.length === 0) {
      setError("Pick at least one hub — a member with no hub cannot sign in anywhere.");
      return;
    }

    setSubmitting(true);
    setEmails(good);
    setDraft("");

    const sent = [];
    const failed = [];
    for (const email of good) {
      // Sequential, not Promise.all: /auth/invite is rate-limited and a
      // parallel burst would trip the limiter on the batch's own tail.
      // The schema keeps `role` (= roles[0]) in lockstep with `roles`.
      const r = await apiPost("/auth/invite", {
        email,
        role: roles[0],
        roles,
        displayName: nameFromEmail(email),
      });
      if (r.ok) sent.push(email);
      else failed.push({ email, message: humaniseInviteError(r.error) });
    }

    // Hub access and the reporting line are not part of the invite
    // payload, so apply them to the rows the invites just created.
    const accessFailures = [];
    if (sent.length > 0) {
      const roster = await apiGet("/admin/users");
      if (roster.ok) {
        const byEmail = new Map(
          (roster.data?.users ?? []).map((u) => [String(u.email).toLowerCase(), u]),
        );
        for (const email of sent) {
          const row = byEmail.get(email);
          if (!row) continue;
          const patch = {
            allowedHubs: hubs,
            primaryHub,
            managerId: managerId || null,
          };
          const r = await apiPatch(`/admin/users/${row.id}`, patch);
          if (!r.ok) {
            accessFailures.push({
              email,
              message:
                r.error?.message ||
                "Invite sent, but the hub access and reporting line could not be applied.",
            });
          }
        }
      }
    }

    setSubmitting(false);
    const allFailures = [...failed, ...accessFailures];
    setFailures(allFailures);

    if (sent.length > 0) {
      toast.success(
        sent.length === 1
          ? `Invite sent to ${sent[0]}.`
          : `${sent.length} invites sent.`,
      );
    }
    if (allFailures.length === 0) {
      onSuccess();
      return;
    }
    // Some landed, some didn't. Keep the dialog open with the failures
    // listed, but refresh the roster behind it so the successes show.
    if (sent.length > 0) {
      setEmails(allFailures.map((f) => f.email));
      onSuccess({ keepOpen: true });
    }
  }

  if (typeof document === "undefined") return null;

  // Portaled out of AppShell's transformed wrapper, which would otherwise
  // make `fixed` resolve against the page instead of the viewport.
  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-fg/40 p-4 sm:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <form
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label="Invite teammates"
        onSubmit={handleSubmit}
        className="my-auto w-[860px] max-w-full rounded-[var(--radius-xl)] bg-card p-6"
        style={{ boxShadow: "var(--shadow-float)" }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label>Invite</Label>
            <h2 className="mt-1.5 text-[18px] font-bold tracking-[-0.01em] text-fg">
              Invite teammates.
            </h2>
            <p className="mt-1 text-[12.5px] text-muted-fg">
              Everyone here gets the same roles, hubs and reporting line. They
              each receive a one-time setup link.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            iconOnly
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
          >
            <X size={16} />
          </Button>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-[minmax(0,1fr)_300px]">
          {/* ── the form ───────────────────────────────────────── */}
          <div className="min-w-0">
            <Label className="mb-1.5 block" as="div">
              Email addresses
            </Label>
            <div
              className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-[var(--radius-lg)] bg-card-alt px-3 py-2"
              onClick={() => emailInputRef.current?.focus()}
            >
              {emails.map((email) => (
                <span
                  key={email}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] px-2.5 py-1 text-[12px] font-semibold",
                    isEmail(email) ? "bg-card text-fg" : "bg-peach text-peach-ink",
                  )}
                >
                  {email}
                  <button
                    type="button"
                    aria-label={`Remove ${email}`}
                    disabled={submitting}
                    onClick={() =>
                      setEmails((prev) => prev.filter((e) => e !== email))
                    }
                    className="text-dim-fg transition-colors hover:text-fg"
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
              <input
                ref={emailInputRef}
                type="text"
                value={draft}
                onChange={handleDraftChange}
                onKeyDown={handleDraftKeyDown}
                onBlur={() => commitDraft(draft)}
                disabled={submitting}
                aria-label="Add an email address"
                placeholder={emails.length === 0 ? "name@example.com" : "add another…"}
                className="min-w-[160px] flex-1 bg-transparent text-[14px] text-fg outline-none placeholder:text-dim-fg"
              />
            </div>
            <div className="mt-1 text-[12px] leading-[1.4] text-dim-fg">
              Comma or space separated. Everyone here gets the same role.
            </div>
            {invalid.length > 0 ? (
              <div className="mt-1 text-[12px] text-peach-ink">
                {invalid.length === 1 ? "That address" : "Those addresses"} don&apos;t
                look like email — fix or remove {invalid.length === 1 ? "it" : "them"}.
              </div>
            ) : null}

            <div className="mt-4">
              <Label className="mb-1.5 block" as="div">
                Roles
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {ALL_ROLES.map((r) => {
                  const checked = roles.includes(r);
                  return (
                    <TogglePill
                      key={r}
                      checked={checked}
                      disabled={submitting || (roles.length === 1 && checked)}
                      onClick={() => toggleRole(r)}
                    >
                      {r}
                    </TogglePill>
                  );
                })}
              </div>
              <div className="mt-1 text-[12px] leading-[1.4] text-dim-fg">
                Capabilities are the union across roles.
              </div>
            </div>

            <div className="mt-4">
              <Label className="mb-1.5 block" as="div">
                Hubs they can reach
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {HUB_ORDER.map((id) => (
                  <TogglePill
                    key={id}
                    checked={hubs.includes(id)}
                    disabled={submitting}
                    onClick={() => toggleHub(id)}
                  >
                    {HUBS[id]?.label ?? id}
                  </TogglePill>
                ))}
              </div>
            </div>

            <div className="mt-4">
              <UiField
                label="Reports to"
                hint="This is what puts them on a manager's team board."
              >
                <Select
                  value={managerId}
                  onChange={(e) => setManagerId(e.target.value)}
                  disabled={submitting}
                  className="w-full"
                >
                  <option value="">(no manager)</option>
                  {managerCandidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.displayName}
                      {c.roles?.includes("manager") ? " · manager" : ""}
                    </option>
                  ))}
                </Select>
              </UiField>
            </div>
          </div>

          {/* ── the preview ─────────────────────────────────────── */}
          <AccessPreview roles={roles} hubs={hubs} primaryHub={primaryHub} />
        </div>

        {error ? (
          <div className="mt-4 rounded-[var(--radius-lg)] bg-peach px-3.5 py-2.5 text-[12.5px] text-peach-ink">
            {error}
          </div>
        ) : null}
        {failures.length > 0 ? (
          <div className="mt-4 rounded-[var(--radius-lg)] bg-peach px-3.5 py-2.5 text-[12.5px] text-peach-ink">
            <div className="font-bold">
              {failures.length} of these didn&apos;t go through:
            </div>
            <ul className="mt-1.5 flex flex-col gap-1">
              {failures.map((f) => (
                <li key={f.email}>
                  <span className="font-bold">{f.email}</span> — {f.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="mt-6 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="soft"
            size="sm"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button type="submit" variant="ink" size="sm" disabled={submitting}>
            {submitting
              ? "Sending…"
              : valid.length > 1
                ? `Send ${valid.length} invites`
                : "Send invite"}
          </Button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

/**
 * What the chosen roles actually unlock — resolved through the shared
 * capability registry, then intersected with the hubs the admin ticked.
 * A hub that is ticked but not granted by any role is called out, since
 * /hubs/me will silently drop it.
 */
function AccessPreview({ roles, hubs, primaryHub }) {
  const granted = useMemo(() => new Set(hubsForRoles(roles)), [roles]);
  const shown = HUB_ORDER.filter((id) => hubs.includes(id) && granted.has(id));
  const ungranted = HUB_ORDER.filter((id) => hubs.includes(id) && !granted.has(id));
  const unreachable = HUB_ORDER.filter((id) => !hubs.includes(id));

  return (
    <aside className="rounded-[var(--radius-lg)] bg-card-alt p-4">
      <div className="flex items-center gap-2">
        <Sparkles size={14} className="shrink-0 text-lav-ink" />
        <span className="text-[12.5px] font-bold text-fg">What they will see</span>
      </div>
      <p className="mt-1 text-[12px] leading-[1.45] text-muted-fg">
        Based on the roles above.
      </p>

      {shown.length === 0 ? (
        <p className="mt-3 text-[12.5px] leading-[1.5] text-peach-ink">
          These roles unlock no hub at all. The invitee would sign in with
          nowhere to land.
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          {shown.map((id) => {
            const hub = HUBS[id];
            const slots = Object.keys(hub?.pages ?? {});
            return (
              <div key={id}>
                <div className="flex items-center gap-2.5 rounded-[var(--radius-md)] bg-card px-3 py-2">
                  <span className="text-[12.5px] font-bold text-fg">
                    {hub?.label ?? id}
                  </span>
                  <span className="flex-1" />
                  {id === primaryHub ? <Badge tone="mint">primary</Badge> : null}
                </div>
                <ul className="mt-1.5 flex flex-col gap-0.5 pl-3">
                  {slots.map((slot) => (
                    <li
                      key={slot}
                      className="flex items-center gap-2 text-[12px] text-muted-fg"
                    >
                      <span
                        aria-hidden="true"
                        className="inline-block h-1 w-1 shrink-0 rounded-full bg-dim-fg"
                      />
                      {pageLabel(slot)}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      {ungranted.length > 0 ? (
        <p className="mt-3 border-t border-line pt-3 text-[12px] leading-[1.45] text-muted-fg">
          {ungranted.map((id) => HUBS[id]?.label ?? id).join(" and ")} is ticked but
          no chosen role grants it — it will be hidden until the role is added.
        </p>
      ) : null}
      {unreachable.length > 0 ? (
        <p className="mt-3 border-t border-line pt-3 text-[12px] leading-[1.45] text-muted-fg">
          They will not see{" "}
          {unreachable.map((id) => HUBS[id]?.label ?? id).join(", ")}.
        </p>
      ) : null}
    </aside>
  );
}

/**
 * Server error codes → something an admin can act on. Kept verbatim
 * from the previous dialog: these four codes are the ones /auth/invite
 * actually returns.
 */
export function humaniseInviteError(err) {
  if (!err) return "Something went wrong. Try again.";
  if (err.code === "user_already_active")
    return "An active or disabled user with that email already exists. Edit them from the list instead.";
  if (err.code === "validation_error")
    return err.message || "Check the fields and try again.";
  if (err.code === "rate_limited")
    return "Too many invites from this network. Wait a moment and retry.";
  if (err.code === "network_error")
    return "Couldn't reach the server. Check your connection and try again.";
  return err.message || "Something went wrong. Try again.";
}
