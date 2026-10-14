"use client";

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui";
import { cn } from "@/lib/cn";
import { PACKET_TEMPLATES, TEMPLATE_IDS } from "./packet-model";
import { PacketView } from "./packet-view";

const STORAGE_KEY = "espace-devhub:packet-template";
const DEFAULT_TEMPLATE = "scorecard";

/** Per-device template choice. Starts at the default (SSR-safe) and loads the saved id after mount. */
export function usePacketTemplate() {
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved && TEMPLATE_IDS.includes(saved)) setTemplate(saved);
    } catch {
      /* storage unavailable — keep the default */
    }
  }, []);
  const choose = (id) => {
    setTemplate(id);
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* choice just isn't remembered */
    }
  };
  return [template, choose];
}

/** Four selectable template tiles with a live preview of the packet beneath. */
export function TemplatePicker({ value, onChange, payload }) {
  const packet = useMemo(() => ({ version: 2, template: value, payload }), [value, payload]);
  function onKeyDown(e, index) {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = PACKET_TEMPLATES[(index + step + PACKET_TEMPLATES.length) % PACKET_TEMPLATES.length];
    onChange(next.id);
    e.currentTarget.parentElement?.querySelector(`[data-template="${next.id}"]`)?.focus();
  }
  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label="Packet template" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {PACKET_TEMPLATES.map((t, i) => {
          const selected = t.id === value;
          return (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={selected}
              data-template={t.id}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(t.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={cn(
                "flex flex-col gap-1 rounded-[var(--radius-lg)] bg-card-alt p-3 text-left outline-2 outline-offset-0 transition-colors",
                selected ? "outline outline-fg" : "outline-transparent hover:bg-card",
              )}
            >
              <span className="text-[13px] font-bold">{t.label}</span>
              <span className="text-[12px] leading-[1.45] text-muted-fg">{t.blurb}</span>
            </button>
          );
        })}
      </div>
      <Card className="max-h-[420px] overflow-auto">
        <PacketView packet={packet} mode="preview" />
      </Card>
    </div>
  );
}
