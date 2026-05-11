/**
 * Type signatures for the hub registry. Runtime in registry.js.
 */

import type { Capability } from "../capabilities/capabilities.js";

export interface HubTheme {
  /** Primary brand colour for the hub (text, borders, badges). */
  primary: string;
  /** Accent colour used for CTAs + selected nav state. */
  accent: string;
  /** Translucent variant used for chip / tile backgrounds. */
  accentSurface: string;
}

export type HubPageSlot =
  | "dashboard"
  | "goals"
  | "evidence"
  | "snapshots"
  | "reviews"
  | "settings"
  | "analyst"
  // Admin-specific
  | "hub-config"
  | "users"
  | "audit"
  // Manager-specific
  | "team"
  | "employees";

export interface HubDefinition {
  id: string;
  label: string;
  description: string;
  theme: HubTheme;
  allowedIntegrations: readonly string[];
  pages: Readonly<Partial<Record<HubPageSlot, string>>>;
  widgets: readonly string[];
  departments: readonly string[];
  /**
   * Capabilities a user must hold (intersection — must satisfy every
   * one) to access this hub. Empty array means "no gate" (open hub —
   * reserved for future public surfaces; no hub today is open).
   */
  requires: readonly Capability[];
}

export const ALL_PROVIDERS: readonly ["github", "gitlab", "jira"];
export const PAGE_SLOTS: readonly HubPageSlot[];

export const HUBS: Readonly<Record<string, HubDefinition>>;
export const HUB_ORDER: readonly string[];
export const DEFAULT_HUB_ID: string;

export function findHubById(id: unknown): HubDefinition | null;
export function getHubIdForDepartment(department: unknown): string | null;

/**
 * @deprecated Pre-capability path. Use resolveHubsForCapabilities
 * for new code. Kept for backward compatibility during the M-CAP
 * migration; will be removed once all callers migrate.
 */
export function resolveAllowedHubs(
  allowedHubIds: readonly string[] | null | undefined,
): HubDefinition[];

/**
 * Capability-driven resolver. Given a user's capability Set, returns
 * the HubDefinition objects whose `requires` is fully satisfied.
 * Preserves HUB_ORDER.
 */
export function resolveHubsForCapabilities(
  userCaps: Set<Capability>,
): HubDefinition[];
