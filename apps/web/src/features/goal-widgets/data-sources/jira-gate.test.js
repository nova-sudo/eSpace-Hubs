import test from "node:test";
import assert from "node:assert/strict";

import { SOURCE_METRICS } from "@espace-devhub/shared/goal-specs";
import { metricNeedsJiraIssueTypes, metricNeedsJiraTickets } from "./jira-gate.js";

test("only ticket cycle time subscribes to the Jira issue list", () => {
  for (const metric of Object.values(SOURCE_METRICS)) {
    assert.equal(
      metricNeedsJiraTickets(metric),
      metric === SOURCE_METRICS.TICKET_CYCLE_TIME,
      `${metric} should ${metric === SOURCE_METRICS.TICKET_CYCLE_TIME ? "" : "not "}fetch jira:my-issues`,
    );
  }
  // Linkage matches keys in PR text — no Jira call.
  assert.equal(metricNeedsJiraTickets(SOURCE_METRICS.LINKAGE_PCT), false);
  assert.equal(metricNeedsJiraTickets(undefined), false);
});

test("only ticket-type share resolves issue types", () => {
  assert.equal(metricNeedsJiraIssueTypes(SOURCE_METRICS.TICKET_TYPE_SHARE), true);
  assert.equal(metricNeedsJiraIssueTypes(SOURCE_METRICS.TICKET_CYCLE_TIME), false);
  assert.equal(metricNeedsJiraIssueTypes(SOURCE_METRICS.MERGED_COUNT), false);
});
