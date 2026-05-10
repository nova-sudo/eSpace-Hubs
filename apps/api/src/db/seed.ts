/**
 * Idempotent default-org seeder. Runs after `bootstrap()` and ensures
 * a single `default` org exists so M2.3's signup flow has somewhere to
 * place the first admin user without requiring a separate org-creation
 * step.
 *
 * Multi-tenancy doesn't change anything here — when a second org gets
 * provisioned it goes through the admin endpoint (M7), not this seeder.
 */

import { getOrgsCollection } from "./collections.js";
import type { Org } from "./types.js";
import { logger } from "../lib/logger.js";

const DEFAULT_ORG_SLUG = "default";

export async function seedDefaultOrg(): Promise<Org> {
  const orgs = await getOrgsCollection();
  const existing = await orgs.findOne({ slug: DEFAULT_ORG_SLUG });
  if (existing) {
    logger.debug(
      { orgId: existing._id.toHexString() },
      "[seed] default org already present",
    );
    return existing;
  }

  const now = new Date();
  // Insert without _id so Mongo generates one. The driver mutates the
  // doc in place adding the ObjectId, so we cast through unknown to
  // bypass the _id-required field on Org.
  const draft = {
    slug: DEFAULT_ORG_SLUG,
    name: "eSpace Dev Hub",
    settings: {
      // 0 = Sunday — matches the existing app's Sun→Thu work week.
      weekStart: 0,
    },
    createdAt: now,
    updatedAt: now,
  } as unknown as Org;

  await orgs.insertOne(draft);
  logger.info(
    { orgId: draft._id.toHexString(), slug: DEFAULT_ORG_SLUG },
    "[seed] default org created",
  );
  return draft;
}
