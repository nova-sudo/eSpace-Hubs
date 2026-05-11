/**
 * Type signatures for the hub registry. Runtime lives in registry.js.
 */

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
  | "analyst";

export interface HubDefinition {
  /** Stable URL slug + storage key. */
  id: string;
  /** Human-readable name shown in switchers, page titles, emails. */
  label: string;
  /** One-line description for admin UI + onboarding hover state. */
  description: string;
  /** Hub-level theme overrides merged on top of the base palette. */
  theme: HubTheme;
  /** Integration provider ids the hub UI exposes. */
  allowedIntegrations: readonly string[];
  /**
   * Page slots the hub mounts. Values are symbolic — apps/web resolves
   * them to React components at render time. Missing slots aren't
   * routable for that hub.
   */
  pages: Readonly<Partial<Record<HubPageSlot, string>>>;
  /** Widget ids the hub's dashboard can mount. */
  widgets: readonly string[];
  /**
   * Lowercased, whitespace-trimmed department strings that route to
   * this hub during onboarding.
   */
  departments: readonly string[];
}

export const ALL_PROVIDERS: readonly ["github", "gitlab", "jira"];
export const PAGE_SLOTS: readonly HubPageSlot[];

export const HUBS: Readonly<Record<string, HubDefinition>>;
export const HUB_ORDER: readonly string[];
export const DEFAULT_HUB_ID: string;

export function findHubById(id: unknown): HubDefinition | null;
export function getHubIdForDepartment(department: unknown): string | null;
export function resolveAllowedHubs(
  allowedHubIds: readonly string[] | null | undefined,
): HubDefinition[];
