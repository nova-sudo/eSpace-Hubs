"use client";

import { Card, Checkbox, Field, Input, Label } from "@/components/ui";

const SECTION_TOGGLES = [
  ["narrative", "Summary narrative"],
  ["goals", "Goal readings"],
];

export function ConfigPanel({ level, setLevel, include, setInclude, rangeLabel }) {
  return (
    <div className="sticky top-20 flex flex-col gap-4">
      <Card className="flex flex-col gap-4">
        <div className="text-[15px] font-bold text-fg">Configure bundle</div>

        <Field label="Window">
          <div className="flex h-11 items-center rounded-[var(--radius-lg)] bg-card-alt px-3.5 text-[13.5px] text-muted-fg">
            {rangeLabel}
          </div>
        </Field>

        <Field
          label="Your career level"
          hint="Printed in the document title. Leave blank to omit it."
        >
          <Input
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            placeholder="e.g. Senior engineer"
          />
        </Field>

        <div>
          <Label className="mb-2 block">Include sections</Label>
          <div className="flex flex-col gap-2.5">
            {SECTION_TOGGLES.map(([id, label]) => (
              <div key={id} className="flex items-center gap-2.5">
                <Checkbox
                  checked={include[id]}
                  onChange={() => setInclude({ ...include, [id]: !include[id] })}
                  label={label}
                />
                <span className="text-[13.5px] text-fg">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <div className="px-1 text-[12px] leading-[1.6] text-muted-fg">
        <div className="mb-1 text-[12px] font-bold text-fg">Where this goes</div>
        Download .md / Export PDF build the file in your browser — nothing is sent
        anywhere. Submit packet uploads a frozen copy to eSpace Hubs for your manager.
        Starred proof and goal readings are already stored in your account.
      </div>
    </div>
  );
}
