"use client";

/**
 * "GitHub" — the correlation report for your own published goals: each
 * period's issue next to what eSpace holds for it, with the gaps flagged
 * (closed without evidence, logged but not on GitHub, open past due…).
 *
 * Hidden entirely until you have at least one live GitHub link; the report
 * itself is only fetched once that is known.
 */

import { Section } from "@/components/ui";
import {
  CorrelationReport,
  useAllMyGithubLinks,
  useGithubCorrelation,
} from "@/features/github-links";

export function GithubCorrelationSection() {
  const { links } = useAllMyGithubLinks();
  const hasLinks = links.length > 0;
  const { data, isLoading, error } = useGithubCorrelation(undefined, { enabled: hasLinks });
  if (!hasLinks) return null;
  return (
    <Section title="GitHub" className="no-print mt-8">
      <CorrelationReport data={data} loading={isLoading} error={error} actions />
    </Section>
  );
}
