/**
 * Rename repeated goal ids (`<id>~2`, `<id>~3`, …) so every L1 and L2 in a
 * tree is unique. Deterministic and idempotent; returns the same array
 * when nothing needed renaming.
 */
export declare function uniqueGoalIds<T extends { id: string; l2s?: Array<{ id: string }> }>(
  l1s: T[],
): T[];
