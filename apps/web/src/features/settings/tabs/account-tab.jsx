"use client";

import { useSyncExternalStore } from "react";
import { Card, Field, Input, Section } from "@/components/ui";
import { useIntegrations } from "@/features/integrations";
import {
  readLastReviewDate,
  writeLastReviewDate,
  LAST_REVIEW_CHANGE_EVENT,
} from "@/features/dashboard/date-range";

function subscribeReviewDate(cb) {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb();
  window.addEventListener(LAST_REVIEW_CHANGE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(LAST_REVIEW_CHANGE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

export function AccountTab() {
  const { me } = useIntegrations();
  const lastReview = useSyncExternalStore(
    subscribeReviewDate,
    () => readLastReviewDate(),
    () => "",
  );
  return (
    <Section num="01 /" title="Profile">
      <Card className="p-6">
        <div className="grid grid-cols-2 gap-5">
          <Field label="Display name">
            <Input defaultValue={me?.name ?? ""} placeholder="Your name" />
          </Field>
          <Field
            label="Handle"
            hint="Used to identify your MRs and reviews in GitLab/GitHub."
          >
            <Input defaultValue={me?.handle ?? ""} placeholder="m.hany" mono />
          </Field>
          <Field label="Team">
            <Input defaultValue={me?.team ?? ""} placeholder="Payments Platform" />
          </Field>
          <Field
            label="Current level"
            hint="Appears only on exports. We don't read this from anywhere."
          >
            <Input defaultValue="L1 → L2 track" mono />
          </Field>
          <Field
            label="Last review date"
            hint="Powers the “Since review” date-range chip on the dashboard. Stored locally — never sent anywhere."
          >
            <Input
              type="date"
              value={lastReview}
              onChange={(e) => writeLastReviewDate(e.target.value)}
              mono
            />
          </Field>
        </div>
      </Card>
    </Section>
  );
}
