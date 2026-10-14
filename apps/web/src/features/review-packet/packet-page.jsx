"use client";

import { Button, Card, Loader } from "@/components/ui";
import { PacketHeader } from "./packet-header";
import { PacketView } from "./packet-view";
import { useReviewPacket } from "./use-review-packet";

export function PacketPage({ id }) {
  const { loading, packet, error, refresh } = useReviewPacket(id);
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-6">
      {loading ? (
        <div className="flex justify-center py-10 text-muted-fg"><Loader label="Loading packet" /></div>
      ) : error || !packet ? (
        <Card className="p-5">
          {error?.code === "not_found" || (!error && !packet) ? (
            <p className="text-[14px] text-fg">This packet isn't yours to see.</p>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <p className="text-[14px] text-fg">Couldn't load this packet. Try again.</p>
              <Button onClick={() => refresh()}>Retry</Button>
            </div>
          )}
        </Card>
      ) : (
        <>
          <PacketHeader packet={packet} />
          <PacketView packet={packet} mode="page" />
        </>
      )}
    </div>
  );
}
