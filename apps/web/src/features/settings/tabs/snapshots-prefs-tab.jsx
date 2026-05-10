"use client";

import { Card, Field, Input, Section } from "@/components/ui";

const EXPLICIT_NOT = [
  [
    "No leaderboard.",
    "Your metrics are never compared to teammates inside this tool. Personal vs. personal baseline only.",
  ],
  [
    "No manager view.",
    "There is no role-based manager dashboard. If that product ever ships, it will be a separate app with separate consent.",
  ],
  [
    "No telemetry.",
    "We don't track which tiles you look at, which tickets you hover, or when you open the app.",
  ],
  [
    "No third-party cookies.",
    "The only cookies we set are a session cookie for the OAuth handshake with GitHub — cleared on disconnect.",
  ],
];

export function SnapshotsPrefsTab() {
  return (
    <>
      <Section num="01 /" title="Snapshot schedule">
        <Card className="p-6">
          <div className="grid grid-cols-2 gap-5">
            <Field
              label="Frequency"
              hint="Weekly is recommended. Daily creates noise; monthly misses deltas."
            >
              <Input defaultValue="Weekly · Mondays at 09:00 Africa/Cairo" />
            </Field>
            <Field
              label="Retention"
              hint="How many weeks of history to keep in your browser."
            >
              <Input defaultValue="26 weeks (6 months)" />
            </Field>
          </div>
          <div
            className="mt-2.5 rounded-[var(--radius-sub)] bg-accent-dim px-3.5 py-3 text-[12.5px] leading-[1.5]"
          >
            <strong className="text-accent">Heads up:</strong> snapshots live in your
            browser storage. Clearing site data wipes them. Consider exporting to JSON
            before switching machines.
          </div>
        </Card>
      </Section>
      <Section num="02 /" title="What we explicitly do not do">
        <Card className="p-6">
          {EXPLICIT_NOT.map(([title, body]) => (
            <div
              key={title}
              className="border-b border-border border-dashed py-3.5 last:border-b-0"
            >
              <div
                className="mb-1 font-semibold"
                style={{ fontFamily: "var(--font-display)", fontSize: 15 }}
              >
                {title}
              </div>
              <div className="text-[13px] leading-[1.5] text-muted-fg">{body}</div>
            </div>
          ))}
        </Card>
      </Section>
    </>
  );
}
