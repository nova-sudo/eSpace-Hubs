"use client";

/**
 * Settings → Notifications (hub-audit §1.6 / §3.4). Per-kind mutes and
 * one email switch, saved per account via
 * GET/PUT /api/v1/notifications/preferences. A muted kind is never
 * written to the inbox at all; "Email me" off stops the weekly digest and
 * admin alert emails (security mail — password resets, invites — isn't a
 * notification and always sends).
 *
 * The "Reviewing others" group only shows to people who review (manager
 * team view, or admin hub access) — a dev has nothing to mute there.
 */

import { Card, Checkbox, Loading, Section } from "@/components/ui";
import { useSession } from "@/features/auth";
import { NOTIFICATION_KIND_GROUPS } from "./notification-kinds";
import { useNotificationPrefs } from "./notification-prefs";

const REVIEWER_CAPS = ["manager.team.view", "hub.admin.access"];

function Row({ label, hint, checked, onToggle, disabled }) {
  return (
    <div className="flex items-start justify-between gap-4 border-t border-line py-3 first:border-t-0">
      <div className="min-w-0">
        <div className="text-[13.5px] font-semibold text-fg">{label}</div>
        {hint ? <div className="mt-0.5 text-[12px] leading-snug text-muted-fg">{hint}</div> : null}
      </div>
      <Checkbox checked={checked} onChange={onToggle} label={label} disabled={disabled} />
    </div>
  );
}

export function NotificationPreferences() {
  const { user } = useSession();
  const prefs = useNotificationPrefs();
  const caps = Array.isArray(user?.capabilities) ? user.capabilities : [];
  const reviews = REVIEWER_CAPS.some((c) => caps.includes(c));
  const groups = NOTIFICATION_KIND_GROUPS.filter(
    (g) => g.title !== "Reviewing others" || reviews,
  );

  if (prefs.loading) return <Loading label="Loading notification preferences" />;
  if (prefs.error) {
    return (
      <Card className="p-6">
        <p className="text-[13px] text-muted-fg">{prefs.error}</p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Section title="Email">
        <Card className="px-6 py-3">
          <Row
            label="Email me"
            hint="The Monday digest and admin alerts. Password resets and invites always send."
            checked={prefs.email}
            disabled={prefs.saving}
            onToggle={() => void prefs.setEmail(!prefs.email)}
          />
        </Card>
      </Section>

      {groups.map((g) => (
        <Section key={g.title} title={g.title}>
          <Card className="px-6 py-3">
            {g.kinds.map((k) => {
              // Kinds the server refuses to mute (you're the one who has
              // to act on them) render ticked and locked.
              const locked = prefs.unmutable.includes(k.kind);
              return (
                <Row
                  key={k.kind}
                  label={k.label}
                  hint={locked ? "Always on — you're the one who acts on these" : undefined}
                  checked={locked || !prefs.muted.includes(k.kind)}
                  disabled={locked || prefs.saving}
                  onToggle={() => void prefs.toggleKind(k.kind)}
                />
              );
            })}
          </Card>
        </Section>
      ))}
      <p className="text-[12px] text-muted-fg">
        Unticked kinds are muted: they don&apos;t reach your inbox or the bell.
      </p>
    </div>
  );
}
