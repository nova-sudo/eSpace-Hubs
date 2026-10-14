"use client";

import { Card } from "@/components/ui";
import { PacketLegacy } from "./packet-legacy";
import { selectTemplate } from "./packet-model";
import { Deck } from "./templates/deck";
import { Dossier } from "./templates/dossier";
import { Journey } from "./templates/journey";
import { Scorecard } from "./templates/scorecard";

export { selectTemplate };

const TEMPLATES = { scorecard: Scorecard, journey: Journey, deck: Deck, dossier: Dossier };

/** Renders a packet in whichever template it was frozen with. */
export function PacketView({ packet, mode = "page" }) {
  const kind = selectTemplate(packet);
  if (kind === "legacy") return <PacketLegacy packet={packet} />;
  const Template = TEMPLATES[kind];
  if (!Template || !packet?.payload) {
    return (
      <Card className="p-5">
        <p className="text-[13px] text-muted-fg">Unknown template. This packet can't be shown in this version of the app.</p>
      </Card>
    );
  }
  return <Template payload={packet.payload} mode={mode} />;
}
