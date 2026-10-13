/**
 * Hourly GitHub read-back for published tracker periods (modules/github-links).
 *
 * Picks the 200 linked rows that haven't been read in 6 hours (oldest
 * first), groups them by owner so each user's token is decrypted once,
 * and runs the same `syncLink` the manual route uses — so a period closed
 * on GitHub is logged as done even when nobody opens eSpace that day.
 *
 * Idempotent through `claimStamp` per (link, 6-hour bucket), like every
 * other job: a re-tick inside the bucket is a no-op. A link that failed
 * three times in a row is left alone until a manual sync resets it. A
 * rate limit stops the rest of THAT user's links; other users carry on.
 *
 * GITHUB_LINKS_SYNC=false switches the job off (CLAUDE.md §4).
 */

import type { Collection } from "mongodb";
import { getGithubLinksCollection, getGoalInputsCollection } from "../db/collections.js";
import type { GithubLink } from "../db/types.js";
import { writeAudit } from "../lib/audit.js";
import { logger } from "../lib/logger.js";
import { createNotification } from "../lib/notifications.js";
import { HttpError } from "../middleware/error-handler.js";
import { createGithubClient } from "../modules/github-links/github-client.js";
import {
  resolveOwnerName,
  resolveReadingRecipients,
  syncLink,
  type SyncDeps,
} from "../modules/github-links/sync.js";
import {
  loadDecryptedTokens,
  markIntegrationError,
} from "../modules/integrations/controller.js";
import { claimStamp } from "./jobs.js";

const SIX_HOURS_MS = 6 * 3_600_000;
const BATCH_LIMIT = 200;
const MAX_FAILURES = 3;
const SPACING_MS = 500;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function syncGithubLinks(now: Date): Promise<void> {
  if (process.env.GITHUB_LINKS_SYNC === "false") return;
  const col: Collection<GithubLink> = await getGithubLinksCollection();
  const due = await col
    .find({
      status: "linked",
      syncFailures: { $lt: MAX_FAILURES },
      $or: [{ lastSyncedAt: null }, { lastSyncedAt: { $lt: new Date(now.getTime() - SIX_HOURS_MS) } }],
    })
    .sort({ lastSyncedAt: 1 })
    .limit(BATCH_LIMIT)
    .toArray();
  if (due.length === 0) return;

  const bucket = Math.floor(now.getTime() / SIX_HOURS_MS);
  const byUser = new Map<string, GithubLink[]>();
  for (const link of due) {
    const k = link.userId.toHexString();
    const list = byUser.get(k) ?? [];
    list.push(link);
    byUser.set(k, list);
  }

  const inputs = await getGoalInputsCollection();
  let synced = 0;
  let readings = 0;

  for (const links of byUser.values()) {
    const first = links[0] as GithubLink;
    let deps: SyncDeps | null = null;
    for (let i = 0; i < links.length; i += 1) {
      const link = links[i] as GithubLink;
      if (!(await claimStamp(`gh_sync:${link._id.toHexString()}:${bucket}`))) continue;
      if (!deps) {
        let token: string | null = null;
        try {
          token = (
            await loadDecryptedTokens({
              orgId: first.orgId,
              userId: first.userId,
              providerId: "github",
            })
          )?.accessToken ?? null;
        } catch {
          token = null;
        }
        if (!token) {
          // No usable token: nothing to read with. Leave the rows for a
          // manual sync after the user reconnects.
          break;
        }
        deps = {
          links: col,
          inputs,
          client: createGithubClient({ token }),
          now: () => new Date(),
          audit: writeAudit,
          notify: createNotification,
          markError: (message) =>
            markIntegrationError({
              orgId: first.orgId,
              userId: first.userId,
              providerId: "github",
              message,
            }),
          recipients: resolveReadingRecipients,
          ownerName: resolveOwnerName,
        };
      }
      if (i > 0) await sleep(SPACING_MS);
      try {
        const result = await syncLink(deps, link);
        synced += 1;
        if (result.readingWritten) readings += 1;
      } catch (err) {
        if (err instanceof HttpError && err.status === 429) {
          logger.info(
            { userId: link.userId.toHexString(), skipped: links.length - i },
            "[scheduler] github sync rate-limited — skipping the rest for this user",
          );
          break;
        }
        logger.warn(
          { linkId: link._id.toHexString(), err: err instanceof Error ? err.message : String(err) },
          "[scheduler] github sync failed for a link",
        );
      }
    }
  }

  if (synced > 0) {
    logger.info({ synced, readings }, "[scheduler] github links synced");
  }
}
