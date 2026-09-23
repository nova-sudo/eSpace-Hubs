export declare const ASSIGNED_GOAL_PREFIX: "asg_";
export declare const ASSIGNED_ROOT_ID: "asg__root";
export declare function isAssignedGoalId(id: unknown): boolean;
export declare function assignedGoalId(hex: string | { toString(): string }): string;
export declare function parseAssignedGoalId(id: unknown): string | null;
