"use client";

/**
 * Settings → Companion tab. Two stacked surfaces:
 *
 *   01. Setup guide  — explains the Crealogix companion flow,
 *                       shows current routing state inline.
 *   02. Paired devices — lists active devices + revoke action.
 *
 * Hub-gated in settings-page.jsx so espace devs (who never need a
 * companion) don't see the tab in their Settings nav.
 */

import { Section } from "@/components/ui";
import { CompanionSetupGuide, DevicesList } from "@/features/companion";

export function CompanionTab() {
  return (
    <>
      <Section num="01 /" title="Setup">
        <CompanionSetupGuide />
      </Section>
      <Section num="02 /" title="Paired devices">
        <DevicesList />
      </Section>
    </>
  );
}
