"use client";

/**
 * "Trust this browser for 30 days" — shown under an authenticator-code
 * field (never for backup codes). Checked by default; the API sets the
 * `dh_trusted` cookie when it's on and the code is right.
 */

import { Checkbox } from "@/components/ui";

export function TrustBrowserToggle({ checked, onChange, disabled = false }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[13px] text-fg">
      <Checkbox
        checked={checked}
        onChange={() => onChange(!checked)}
        label="Trust this browser for 30 days"
        disabled={disabled}
      />
      <span>Trust this browser for 30 days</span>
    </label>
  );
}
