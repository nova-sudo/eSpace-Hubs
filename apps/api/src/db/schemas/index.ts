/**
 * Re-export every collection's validator so the bootstrap pipeline
 * (`applyValidators()` in collections.ts) can iterate over a single
 * registry instead of importing each schema individually.
 */

import { orgsValidator } from "./orgs.schema.js";
import { usersValidator } from "./users.schema.js";
import { sessionsValidator } from "./sessions.schema.js";
import { auditLogValidator } from "./audit-log.schema.js";
import { authTokensValidator } from "./auth-tokens.schema.js";
import type { Document } from "mongodb";

export interface CollectionDef {
  name: string;
  validator: Document;
}

export const COLLECTION_DEFS: readonly CollectionDef[] = [
  { name: "orgs", validator: orgsValidator },
  { name: "users", validator: usersValidator },
  { name: "sessions", validator: sessionsValidator },
  { name: "audit_log", validator: auditLogValidator },
  { name: "auth_tokens", validator: authTokensValidator },
] as const;
