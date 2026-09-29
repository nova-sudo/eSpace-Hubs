/**
 * The reporting tree, as pure functions over a lightweight roster
 * (hub-audit §1.4 / §2.4). No DB access — the controller loads the org's
 * users once (projection only) and everything here derives from that:
 *
 *   - `managerAssignmentError` — may `managerId` be set as this user's
 *     manager? Active, same org (the roster IS the org), holds the
 *     manager role, not themselves, and no reporting loop (A→B→A or
 *     deeper).
 *   - `buildOrgChart` — the tree an admin reads: roots, per-node flags
 *     (no manager / disabled manager / manager without the role / dangling
 *     pointer / in a loop), loops, and the counts the admin overview
 *     shows ("N people have no manager", "N reports have a disabled
 *     manager").
 */

/** One roster row. Ids are hex strings. */
export interface RosterUser {
  id: string;
  displayName: string;
  email: string;
  status: string;
  roles: string[];
  managerId: string | null;
}

/** Roles whose holders submit goals that need an approver. */
const NEEDS_MANAGER_ROLES = new Set(["dev", "qa"]);

/**
 * Does this person need a manager? Non-disabled devs and QA — the people
 * whose Build-Your-Own trackers go through the approval gate. Admin-only
 * accounts and heads of the tree don't count as "missing a manager".
 */
export function needsManager(u: Pick<RosterUser, "status" | "roles">): boolean {
  return u.status !== "disabled" && u.roles.some((r) => NEEDS_MANAGER_ROLES.has(r));
}

function label(u: RosterUser | undefined, fallback: string): string {
  return u?.displayName || u?.email || fallback;
}

/**
 * The chain from `startId` upward through managers, stopping at a root, a
 * dangling pointer, or the first repeat. Returns the ids visited in order;
 * `loopsTo` is set when the walk revisited an id.
 */
function walkUp(
  startId: string,
  byId: ReadonlyMap<string, RosterUser>,
): { chain: string[]; loopsTo: string | null } {
  const chain: string[] = [];
  const seen = new Set<string>();
  let cur: string | null = startId;
  while (cur) {
    if (seen.has(cur)) return { chain, loopsTo: cur };
    seen.add(cur);
    chain.push(cur);
    cur = byId.get(cur)?.managerId ?? null;
  }
  return { chain, loopsTo: null };
}

/**
 * Would pointing `reportId` at `managerId` be refused? Returns a clear,
 * user-facing reason (for a 400) or null when the assignment is fine.
 * `roster` is every user in the org — a managerId absent from it is, by
 * construction, not in the same org.
 */
export function managerAssignmentError(
  reportId: string,
  managerId: string,
  roster: readonly RosterUser[],
): string | null {
  if (managerId === reportId) return "A user can't be their own manager.";
  const byId = new Map(roster.map((u) => [u.id, u] as const));
  const manager = byId.get(managerId);
  if (!manager) return "Manager not found in this org.";
  const name = label(manager, "That person");
  if (manager.status !== "active") {
    const state =
      manager.status === "disabled"
        ? "disabled"
        : manager.status === "invited"
          ? "still an unaccepted invite"
          : "still waiting for admin approval";
    return `${name} is ${state} — only an active account can be a manager.`;
  }
  if (!manager.roles.includes("manager")) {
    return `${name} doesn't hold the manager role. Grant it first, then assign reports.`;
  }
  // Walk up from the new manager: reaching the report means the report
  // would (transitively) manage their own manager.
  const { chain } = walkUp(managerId, byId);
  const at = chain.indexOf(reportId);
  if (at >= 0) {
    const report = byId.get(reportId);
    const loop = [reportId, ...chain.slice(0, at + 1)].map((id) =>
      label(byId.get(id), id),
    );
    return `That would create a reporting loop: ${loop.join(" → ")}. ${label(
      report,
      "This person",
    )} already sits above ${name}.`;
  }
  return null;
}

export type OrgChartFlag =
  | "no_manager"
  | "manager_disabled"
  | "manager_missing"
  | "manager_not_manager"
  | "in_cycle";

export interface OrgChartNode extends RosterUser {
  reportIds: string[];
  flags: OrgChartFlag[];
}

export interface OrgChart {
  nodes: OrgChartNode[];
  /** Tree roots: no manager, or a manager id that doesn't resolve. */
  rootIds: string[];
  /** Each reporting loop once, as the ids around it. */
  cycles: string[][];
  stats: {
    total: number;
    /** Non-disabled devs/QA with no manager (or a dangling pointer). */
    noManager: number;
    /** Non-disabled people whose manager is disabled. */
    disabledManagerReports: number;
    /** Non-disabled people whose manager no longer holds the role. */
    managerWithoutRole: number;
    cycles: number;
    /** The biggest team, for spotting a manager with 40 reports. */
    largestTeam: { managerId: string; reports: number } | null;
  };
}

export function buildOrgChart(roster: readonly RosterUser[]): OrgChart {
  const byId = new Map(roster.map((u) => [u.id, u] as const));
  const reportsOf = new Map<string, string[]>();
  for (const u of roster) {
    if (u.managerId && byId.has(u.managerId)) {
      const list = reportsOf.get(u.managerId) ?? [];
      list.push(u.id);
      reportsOf.set(u.managerId, list);
    }
  }

  // Find loops: walk up from every node; a walk that revisits an id has
  // found a loop starting at that id. Record each loop once.
  const cycleKey = new Set<string>();
  const cycles: string[][] = [];
  const inCycle = new Set<string>();
  for (const u of roster) {
    const { chain, loopsTo } = walkUp(u.id, byId);
    if (!loopsTo) continue;
    const loop = chain.slice(chain.indexOf(loopsTo));
    const key = [...loop].sort().join(",");
    if (cycleKey.has(key)) continue;
    cycleKey.add(key);
    cycles.push(loop);
    for (const id of loop) inCycle.add(id);
  }

  let noManager = 0;
  let disabledManagerReports = 0;
  let managerWithoutRole = 0;
  const rootIds: string[] = [];
  const nodes: OrgChartNode[] = roster.map((u) => {
    const flags: OrgChartFlag[] = [];
    const mgr = u.managerId ? byId.get(u.managerId) : undefined;
    const active = u.status !== "disabled";
    if (!u.managerId) {
      rootIds.push(u.id);
      if (needsManager(u)) {
        flags.push("no_manager");
        noManager += 1;
      }
    } else if (!mgr) {
      rootIds.push(u.id);
      flags.push("manager_missing");
      if (needsManager(u)) noManager += 1;
    } else {
      if (mgr.status === "disabled") {
        flags.push("manager_disabled");
        if (active) disabledManagerReports += 1;
      } else if (!mgr.roles.includes("manager")) {
        flags.push("manager_not_manager");
        if (active) managerWithoutRole += 1;
      }
    }
    if (inCycle.has(u.id)) flags.push("in_cycle");
    return { ...u, reportIds: reportsOf.get(u.id) ?? [], flags };
  });

  let largestTeam: OrgChart["stats"]["largestTeam"] = null;
  for (const [managerId, ids] of reportsOf) {
    if (!largestTeam || ids.length > largestTeam.reports) {
      largestTeam = { managerId, reports: ids.length };
    }
  }

  return {
    nodes,
    rootIds,
    cycles,
    stats: {
      total: roster.length,
      noManager,
      disabledManagerReports,
      managerWithoutRole,
      cycles: cycles.length,
      largestTeam,
    },
  };
}
