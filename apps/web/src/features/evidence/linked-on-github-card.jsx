"use client";

/**
 * "Linked on GitHub" — the pull requests linked to your published goal
 * issues (every goal, deduped), each merged one starrable as proof. The
 * star id is the merged-PR feed's own (`mr-gh-<id>`, via `prEvidenceItem`),
 * so a PR starred here and in "Starred proof" is one star, not two.
 *
 * Renders nothing until at least one published issue links a PR.
 */

import { Badge, Card } from "@/components/ui";
import {
  LinkedPrs,
  collectLinkedPrs,
  prEvidenceId,
  prEvidenceItem,
  useAllMyGithubLinks,
} from "@/features/github-links";
import { toggleEvidence, useStarredEvidence } from "./use-evidence";

export function LinkedOnGithubCard() {
  const { links } = useAllMyGithubLinks();
  const starred = useStarredEvidence();
  const prs = collectLinkedPrs(links);
  if (prs.length === 0) return null;
  const starredIds = new Set(starred.map((s) => s.id));
  const merged = prs.filter((p) => p.state === "merged").length;

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[15px] font-bold text-fg">Linked on GitHub</span>
        <Badge tone="mint">{merged} merged</Badge>
      </div>
      <p className="text-[12.5px] leading-[1.5] text-muted-fg">
        Pull requests linked to your goal issues. Star the merged ones to add
        them to your starred proof.
      </p>
      <LinkedPrs
        prs={prs}
        showPeriods
        isStarred={(pr) => starredIds.has(prEvidenceId(pr))}
        onStar={(pr) => {
          const item = prEvidenceItem(pr);
          return item ? toggleEvidence(item) : undefined;
        }}
      />
    </Card>
  );
}
