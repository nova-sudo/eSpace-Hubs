/**
 * User-facing naming for goals a manager ASSIGNED to you (the `asg_*` goals
 * merged into your own tree). They're "Assigned" — not "Shared" — because
 * "Shared with me" is the viewer page for goals whose analytics someone
 * opened to you, and an assignee looking for their goal there finds
 * nothing. Code identifiers (ASSIGNED_ROOT_ID, `shared` flags) stay as-is.
 */

import { Badge } from "@/components/ui";

/** Display title for the synthetic `asg__root` objective. */
export const ASSIGNED_GROUP_LABEL = "Assigned to you";

/** "Assigned by Dina, Omar — you fill it in; …" from the assigners' names. */
export function assignedTooltip(names = []) {
  const unique = [...new Set(names.filter(Boolean))];
  const by = unique.length > 0 ? unique.join(", ") : "your manager";
  return `Assigned by ${by} — you fill it in; it doesn't count toward your weights`;
}

/** The "Assigned" badge, with the who/why tooltip. */
export function AssignedBadge({ names, className }) {
  const tip = assignedTooltip(names);
  return (
    <Badge tone="sky" title={tip} aria-label={`Assigned. ${tip}`} className={className}>
      Assigned
    </Badge>
  );
}
