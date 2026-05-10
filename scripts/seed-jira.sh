#!/usr/bin/env bash
#
# seed-jira.sh
#
# One-shot seeder for the ESD project — creates 10 Jira tickets that mirror
# the eSpaceDev mock repo's PR set, then transitions the first 6 to "Done"
# and the rest to "In Progress". Matches the states of PRs #1–13 so the
# dashboard's ticket / PR tiles show consistent data on both sides.
#
# Prerequisites:
#   1. Create the Jira project manually in the UI first:
#        - Project type: Software (Scrum or Kanban — doesn't matter)
#        - Name: eSpace Dev
#        - Key: ESD
#   2. Generate an Atlassian API token:
#        https://id.atlassian.com/manage-profile/security/api-tokens
#   3. Install `jq` (already bundled in Git Bash on Windows; `brew install jq` on mac).
#
# Usage:
#   export JIRA_URL="https://your-workspace.atlassian.net"
#   export JIRA_EMAIL="you@example.com"
#   export JIRA_TOKEN="ATATT3xFfGF0T..."
#   bash scripts/seed-jira.sh
#
# Override the project key / issue type via env if the project you created
# doesn't match the defaults:
#   PROJECT_KEY=ESD ISSUE_TYPE=Task bash scripts/seed-jira.sh

set -euo pipefail

: "${JIRA_URL:?JIRA_URL is required (e.g. https://your-workspace.atlassian.net)}"
: "${JIRA_EMAIL:?JIRA_EMAIL is required}"
: "${JIRA_TOKEN:?JIRA_TOKEN is required}"

PROJECT_KEY="${PROJECT_KEY:-ESD}"
ISSUE_TYPE="${ISSUE_TYPE:-Task}"

AUTH=$(printf '%s:%s' "$JIRA_EMAIL" "$JIRA_TOKEN" | base64 -w0 2>/dev/null || \
       printf '%s:%s' "$JIRA_EMAIL" "$JIRA_TOKEN" | base64)

hdr_auth="Authorization: Basic $AUTH"
hdr_json="Content-Type: application/json"

# ─── helpers ─────────────────────────────────────────────────────────────

create_issue() {
  local summary="$1" description="$2"
  local body
  body=$(jq -n \
    --arg pk "$PROJECT_KEY" \
    --arg summary "$summary" \
    --arg description "$description" \
    --arg itype "$ISSUE_TYPE" \
    '{
      fields: {
        project: { key: $pk },
        summary: $summary,
        issuetype: { name: $itype },
        description: {
          type: "doc", version: 1,
          content: [{ type: "paragraph", content: [{ type: "text", text: $description }] }]
        }
      }
    }')
  curl -sS -X POST -H "$hdr_auth" -H "$hdr_json" \
    "$JIRA_URL/rest/api/3/issue" -d "$body"
}

transition_issue() {
  local key="$1" target="$2"
  local transitions
  transitions=$(curl -sS -H "$hdr_auth" "$JIRA_URL/rest/api/3/issue/$key/transitions")
  local tid
  tid=$(echo "$transitions" | jq -r --arg t "$target" \
    '.transitions[] | select(.to.name == $t) | .id' | head -1)
  if [ -z "$tid" ] || [ "$tid" = "null" ]; then
    echo "  ⚠ No transition to \"$target\" for $key (workflow may use different names)."
    echo "  Available targets:"
    echo "$transitions" | jq -r '.transitions[] | "    - \(.to.name)"' | sort -u
    return 0
  fi
  curl -sS -X POST -H "$hdr_auth" -H "$hdr_json" \
    "$JIRA_URL/rest/api/3/issue/$key/transitions" \
    -d "{\"transition\":{\"id\":\"$tid\"}}" > /dev/null
}

# ─── tickets ─────────────────────────────────────────────────────────────
# Format:  "summary|description|target-status"
# Target statuses: "Done" or "In Progress" — if your workflow uses different
# names, pass the target via the TICKETS_DONE / TICKETS_WIP env vars or edit
# the table here.

TICKETS_DONE_STATUS="${TICKETS_DONE_STATUS:-Done}"
TICKETS_WIP_STATUS="${TICKETS_WIP_STATUS:-In Progress}"

TICKETS=(
  "ESD-101|Add /healthz endpoint for readiness probes|Kubernetes readiness probe endpoint. Returns {status: ok, uptime: ...} from GET /healthz. Merged in PR #1 on nova-sudo/eSpaceDev.|$TICKETS_DONE_STATUS"
  "ESD-102|Fix database connection pool timeout|Default pool timeout of 0 was making transient network blips look like total failures. Set to 5s with explicit max=10. Merged in PR #2.|$TICKETS_DONE_STATUS"
  "ESD-103|Add unit tests for user service|Baseline test coverage for UserService: create, find, updateRole. Structure in place; real cases to follow in ESD-103-followup. Merged in PR #3.|$TICKETS_DONE_STATUS"
  "ESD-104|Upgrade dependencies for security patches|Enabled Dependabot weekly npm scans after the CVE sweep flagged four advisories. Merged in PR #4.|$TICKETS_DONE_STATUS"
  "ESD-105|Refactor settlement worker to extract RetryPolicy|Pulled retry/backoff logic out of SettlementWorker into a reusable RetryPolicy value object. Jitter to follow in ESD-105-followup. Merged in PR #5.|$TICKETS_DONE_STATUS"
  "ESD-106|Fix off-by-one on reports pagination|Pagination returning N+1 items when page size set explicitly. Clamping via Math.min/max with integration tests for edge cases. Merged in PR #6.|$TICKETS_DONE_STATUS"
  "ESD-107|Add role-based access control middleware|requireRole() Express middleware for gating routes on admin/auditor/support. In review at PR #10. Blocking questions on the trust boundary for req.user.role.|$TICKETS_WIP_STATUS"
  "ESD-108|Implement rate limiting on public API routes|In-memory sliding-window rate limiter: 60 req/min per IP. Stopgap before Redis-backed limiting in prod. In review at PR #11. Open questions on multi-instance and XFF spoofing.|$TICKETS_WIP_STATUS"
  "ESD-109|Explore GraphQL schema for reports API|Draft prototype schema for the reports API. Parked for Thursday's architecture review. Draft PR #12.|$TICKETS_WIP_STATUS"
  "ESD-110|Add audit logging for privileged actions|Structured JSON audit-log middleware for admin/auditor endpoints. In review at PR #13. Waiting on SIEM schema alignment with Maii.|$TICKETS_WIP_STATUS"
)

# ─── main ────────────────────────────────────────────────────────────────

echo "Seeding ${#TICKETS[@]} tickets into $PROJECT_KEY at $JIRA_URL"
echo ""

created=()
for spec in "${TICKETS[@]}"; do
  IFS='|' read -r mock_key summary description target <<< "$spec"
  printf "→ %-8s %s\n" "$mock_key:" "$summary"
  result=$(create_issue "$summary" "$description")
  key=$(echo "$result" | jq -r .key 2>/dev/null || true)
  if [ -z "$key" ] || [ "$key" = "null" ]; then
    echo "  ✗ Create failed. Response:"
    echo "$result" | jq -C . 2>/dev/null || echo "$result"
    exit 1
  fi
  echo "  ✓ Created $key — transitioning to \"$target\""
  transition_issue "$key" "$target"
  created+=("$key ($target)")
done

echo ""
echo "Seeding complete. Created:"
for c in "${created[@]}"; do
  echo "  - $c"
done
echo ""
echo "Open $JIRA_URL/browse/$PROJECT_KEY to verify. Then hard-refresh the dashboard."
