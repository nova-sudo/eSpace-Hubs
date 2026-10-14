/**
 * Pure rules behind the shared packet URL (`GET /review-packets/:id`):
 * who may read a frozen packet, and how its per-goal readings are read
 * whether the row is v1 (flat `goals`) or v2 (structured `payload`).
 *
 * DB-free so the authorization invariant is unit-tested
 * (packet-access.test.ts). The handler loads the packet, its owner and
 * the caller's capabilities, then asks `packetAccess`; null → 404.
 */

import type { ObjectId } from "mongodb";
import { CAPABILITIES } from "@espace-devhub/shared/capabilities";
import type { ReviewPacket } from "../../db/types.js";

export type PacketAccess = "owner" | "manager" | "admin";

export interface PacketAccessInput {
  session: {
    userId: ObjectId;
    orgId: ObjectId;
    capabilities: ReadonlySet<string>;
  };
  packet: { orgId: ObjectId; userId: ObjectId };
  /** The packet's submitter as they are NOW (null = account gone). */
  owner: { managerId?: ObjectId | null; status?: string } | null;
}

/**
 * Owner → always. Manager → only the submitter's CURRENT manager, only
 * while the submitter is active (same rule as resolveReportFor — a
 * reassignment moves the packets with the report), and only while the
 * caller still holds manager.team.view (revoking the manager role does
 * not clear reports' managerId; the manager routes demand it too). Admin → anyone
 * holding admin.users.manage. A packet in another org → null for all.
 */
export function packetAccess({
  session,
  packet,
  owner,
}: PacketAccessInput): PacketAccess | null {
  if (!packet.orgId.equals(session.orgId)) return null;
  if (packet.userId.equals(session.userId)) return "owner";
  if (
    owner &&
    owner.status !== "disabled" &&
    owner.managerId?.equals(session.userId) &&
    session.capabilities.has(CAPABILITIES.MANAGER_TEAM_VIEW)
  ) {
    return "manager";
  }
  if (session.capabilities.has(CAPABILITIES.ADMIN_USERS_MANAGE)) return "admin";
  return null;
}

/**
 * goalId → headline reading frozen in a packet. v2 rows read the
 * structured payload (the source the templates render); v1 rows — and a
 * v2 row somehow missing its payload — read the flat `goals` rows.
 */
export function latestReadingMap(
  packet: Pick<ReviewPacket, "version" | "payload" | "goals"> | null | undefined,
): Map<string, string | null> {
  const map = new Map<string, string | null>();
  if (!packet) return map;
  if (packet.version === 2 && packet.payload) {
    for (const objective of packet.payload.objectives ?? []) {
      for (const g of objective.goals ?? []) map.set(g.id, g.reading ?? null);
    }
    return map;
  }
  for (const g of packet.goals ?? []) map.set(g.goalId, g.reading ?? null);
  return map;
}
