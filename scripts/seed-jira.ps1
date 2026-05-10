<#
.SYNOPSIS
    One-shot seeder for the ESD project in Jira. Creates 10 tickets that
    mirror the eSpaceDev mock repo's PR set, transitions the first 6 to
    "Done" and the rest to "In Progress".

.DESCRIPTION
    Requires that the ESD project already exists in the target Jira
    workspace. Create it manually:
      - Projects -> Create project -> Software -> Kanban
      - Name: eSpace Dev
      - Key:  ESD

.PARAMETER JiraUrl
    Base URL of your Atlassian workspace, e.g. https://foo.atlassian.net

.PARAMETER JiraEmail
    Atlassian account email.

.PARAMETER JiraToken
    API token from id.atlassian.com/manage-profile/security/api-tokens

.PARAMETER ProjectKey
    Defaults to ESD.

.PARAMETER IssueType
    Defaults to Task.

.PARAMETER DoneStatus
    Status name used for completed tickets. Default "Done".

.PARAMETER WipStatus
    Status name used for in-flight tickets. Default "In Progress".

.EXAMPLE
    .\scripts\seed-jira.ps1 `
        -JiraUrl "https://your-workspace.atlassian.net" `
        -JiraEmail "you@example.com" `
        -JiraToken "ATATT3x..."
#>

param(
    [Parameter(Mandatory = $true)] [string] $JiraUrl,
    [Parameter(Mandatory = $true)] [string] $JiraEmail,
    [Parameter(Mandatory = $true)] [string] $JiraToken,
    [string] $ProjectKey = "ESD",
    [string] $IssueType = "Task",
    [string] $DoneStatus = "Done",
    [string] $WipStatus = "In Progress",
    # Re-assign-only mode: skip creation, just walk the project's existing
    # tickets and set their assignee to the token owner. Use this if you
    # already ran the seed before assignee-support was added.
    [switch] $BackfillAssigneeOnly
)

$ErrorActionPreference = "Stop"

# Normalize base URL (strip trailing slash).
$JiraUrl = $JiraUrl.TrimEnd("/")

# Pull the response body out of a failed HTTP exception. Invoke-RestMethod
# throws a RuntimeException that wraps the WebException -- the 4xx body with
# Jira's error details is buried inside. ErrorDetails.Message has it on PS5+.
function Get-JiraErrorBody {
    param($Err)
    if ($Err.ErrorDetails -and $Err.ErrorDetails.Message) {
        return $Err.ErrorDetails.Message
    }
    if ($Err.Exception.Response) {
        try {
            $stream = $Err.Exception.Response.GetResponseStream()
            $reader = [System.IO.StreamReader]::new($stream)
            return $reader.ReadToEnd()
        } catch { return $null }
    }
    return $null
}

# Build Basic auth header.
$authBytes = [Text.Encoding]::ASCII.GetBytes("${JiraEmail}:${JiraToken}")
$authHeader = "Basic " + [Convert]::ToBase64String($authBytes)
$headers = @{
    Authorization = $authHeader
    Accept        = "application/json"
}

function New-JiraIssue {
    param([string]$Summary, [string]$Description, [string]$AccountId)
    $fields = @{
        project     = @{ key = $ProjectKey }
        summary     = $Summary
        issuetype   = @{ name = $IssueType }
        description = @{
            type    = "doc"
            version = 1
            content = @(@{
                type    = "paragraph"
                content = @(@{ type = "text"; text = $Description })
            })
        }
    }
    # Assign to the token owner so the dashboard's
    # `assignee = currentUser()` JQL picks them up.
    if ($AccountId) {
        $fields.assignee = @{ accountId = $AccountId }
    }
    $body = @{ fields = $fields } | ConvertTo-Json -Depth 10 -Compress

    Invoke-RestMethod -Method Post `
        -Uri "$JiraUrl/rest/api/3/issue" `
        -Headers $headers `
        -ContentType "application/json" `
        -Body $body
}

function Set-JiraAssignee {
    param([string]$Key, [string]$AccountId)
    if (-not $AccountId) { return }
    $body = @{ accountId = $AccountId } | ConvertTo-Json -Compress
    Invoke-RestMethod -Method Put `
        -Uri "$JiraUrl/rest/api/3/issue/$Key/assignee" `
        -Headers $headers `
        -ContentType "application/json" `
        -Body $body | Out-Null
}

function Move-JiraIssue {
    param([string]$Key, [string]$TargetStatus)
    $resp = Invoke-RestMethod -Method Get `
        -Uri "$JiraUrl/rest/api/3/issue/$Key/transitions" `
        -Headers $headers
    $t = $resp.transitions | Where-Object { $_.to.name -eq $TargetStatus } | Select-Object -First 1
    if (-not $t) {
        Write-Warning ("  No transition to '{0}' for {1}. Available: {2}" -f `
            $TargetStatus, $Key, ($resp.transitions.to.name -join ", "))
        return
    }
    $body = @{ transition = @{ id = $t.id } } | ConvertTo-Json -Compress
    Invoke-RestMethod -Method Post `
        -Uri "$JiraUrl/rest/api/3/issue/$Key/transitions" `
        -Headers $headers `
        -ContentType "application/json" `
        -Body $body | Out-Null
}

# Ticket definitions: (mockKey, summary, description, targetStatus)
$tickets = @(
    @("ESD-101", "Add /healthz endpoint for readiness probes",
      "Kubernetes readiness probe endpoint. Returns status ok + uptime from GET /healthz. Merged in PR #1 on nova-sudo/eSpaceDev.",
      $DoneStatus),
    @("ESD-102", "Fix database connection pool timeout",
      "Default pool timeout of 0 was making transient network blips look like total failures. Set to 5s with explicit max=10. Merged in PR #2.",
      $DoneStatus),
    @("ESD-103", "Add unit tests for user service",
      "Baseline test coverage for UserService: create, find, updateRole. Structure in place; real cases to follow in ESD-103-followup. Merged in PR #3.",
      $DoneStatus),
    @("ESD-104", "Upgrade dependencies for security patches",
      "Enabled Dependabot weekly npm scans after the CVE sweep flagged four advisories. Merged in PR #4.",
      $DoneStatus),
    @("ESD-105", "Refactor settlement worker to extract RetryPolicy",
      "Pulled retry/backoff logic out of SettlementWorker into a reusable RetryPolicy value object. Jitter to follow in ESD-105-followup. Merged in PR #5.",
      $DoneStatus),
    @("ESD-106", "Fix off-by-one on reports pagination",
      "Pagination returning N+1 items when page size set explicitly. Clamping via Math.min/max with integration tests for edge cases. Merged in PR #6.",
      $DoneStatus),
    @("ESD-107", "Add role-based access control middleware",
      "requireRole() Express middleware for gating routes on admin/auditor/support. In review at PR #10. Blocking questions on the trust boundary for req.user.role.",
      $WipStatus),
    @("ESD-108", "Implement rate limiting on public API routes",
      "In-memory sliding-window rate limiter: 60 req/min per IP. Stopgap before Redis-backed limiting in prod. In review at PR #11. Open questions on multi-instance and XFF spoofing.",
      $WipStatus),
    @("ESD-109", "Explore GraphQL schema for reports API",
      "Draft prototype schema for the reports API. Parked for Thursday's architecture review. Draft PR #12.",
      $WipStatus),
    @("ESD-110", "Add audit logging for privileged actions",
      "Structured JSON audit-log middleware for admin/auditor endpoints. In review at PR #13. Waiting on SIEM schema alignment.",
      $WipStatus)
)

Write-Host ""
Write-Host "Seeding $($tickets.Count) tickets into $ProjectKey at $JiraUrl"
Write-Host ""

# Probe the project up front so we fail fast with a clear message instead of
# leaking a raw 400 on the first createIssue call.
try {
    $project = Invoke-RestMethod -Method Get `
        -Uri "$JiraUrl/rest/api/3/project/$ProjectKey" `
        -Headers $headers
    Write-Host "[OK] Project '$ProjectKey' found: $($project.name)"
    $issuetypes = $project.issueTypes | ForEach-Object { $_.name }
    Write-Host "     Issue types available: $($issuetypes -join ', ')"
    if ($issuetypes -notcontains $IssueType) {
        Write-Warning "  Requested IssueType '$IssueType' is NOT in this project."
        Write-Host "  Re-run with: -IssueType '$($issuetypes[0])'" -ForegroundColor Yellow
        exit 1
    }
    Write-Host ""
} catch {
    Write-Host "[X] Could not fetch project '$ProjectKey' at $JiraUrl." -ForegroundColor Red
    $body = Get-JiraErrorBody $_
    if ($body) { Write-Host $body }
    Write-Host ""
    Write-Host "Most likely: you have not created the project yet, or the key is different."
    Write-Host "Open $JiraUrl/jira/projects to check, then either:"
    Write-Host "  - Create a project with key '$ProjectKey', or"
    Write-Host "  - Pass -ProjectKey with the key you actually have"
    exit 1
}

# Resolve the token owner's accountId so we can assign tickets to them.
# The dashboard filters `assignee = currentUser()`, so tickets with no
# assignee are invisible.
try {
    $me = Invoke-RestMethod -Method Get `
        -Uri "$JiraUrl/rest/api/3/myself" `
        -Headers $headers
    $accountId = $me.accountId
    Write-Host "[OK] Authenticated as $($me.displayName) (accountId $accountId)"
    Write-Host ""
} catch {
    Write-Warning "  Could not resolve your accountId via /myself. Tickets will be created without an assignee."
    $accountId = $null
}

# Backfill-only mode: walk existing tickets in the project and set assignee.
if ($BackfillAssigneeOnly) {
    if (-not $accountId) {
        Write-Host "[X] Cannot backfill without accountId." -ForegroundColor Red
        exit 1
    }
    Write-Host "Backfilling assignee on existing $ProjectKey tickets..."
    $jql = "project = $ProjectKey AND assignee IS EMPTY"
    $searchBody = @{
        jql        = $jql
        fields     = @("summary")
        maxResults = 100
    } | ConvertTo-Json -Compress
    $res = Invoke-RestMethod -Method Post `
        -Uri "$JiraUrl/rest/api/3/search/jql" `
        -Headers $headers `
        -ContentType "application/json" `
        -Body $searchBody
    $issues = $res.issues
    if (-not $issues -or $issues.Count -eq 0) {
        Write-Host "  No unassigned tickets found in $ProjectKey. Nothing to do."
        exit 0
    }
    foreach ($iss in $issues) {
        Write-Host ("-> {0,-10} {1}" -f ($iss.key + ":"), $iss.fields.summary)
        try {
            Set-JiraAssignee -Key $iss.key -AccountId $accountId
            Write-Host "  [OK] Assigned to $($me.displayName)"
        } catch {
            $body = Get-JiraErrorBody $_
            Write-Warning "  Could not assign $($iss.key). $($_.Exception.Message)"
            if ($body) { Write-Host $body }
        }
    }
    Write-Host ""
    Write-Host "Backfill complete. Hard-refresh the dashboard." -ForegroundColor Green
    exit 0
}

$created = @()
foreach ($t in $tickets) {
    $mock = $t[0]; $summary = $t[1]; $description = $t[2]; $target = $t[3]
    Write-Host ("-> {0,-8} {1}" -f ($mock + ":"), $summary)
    try {
        $res = New-JiraIssue -Summary $summary -Description $description -AccountId $accountId
    } catch {
        Write-Host "  [X] Create failed: $($_.Exception.Message)" -ForegroundColor Red
        $body = Get-JiraErrorBody $_
        if ($body) {
            Write-Host "  Jira response body:" -ForegroundColor Yellow
            Write-Host $body
        }
        Write-Host ""
        Write-Host "Common causes:" -ForegroundColor Yellow
        Write-Host "  - Project '$ProjectKey' does not exist yet. Create it in the Jira UI first."
        Write-Host "  - Issue type '$IssueType' is not available in this project."
        Write-Host "    Try: -IssueType 'Story' or 'Bug' or 'Epic' (depends on template)"
        Write-Host "  - The project has required custom fields that are not set here."
        exit 1
    }
    $key = $res.key
    Write-Host "  [OK] Created $key -- transitioning to '$target'"
    try {
        Move-JiraIssue -Key $key -TargetStatus $target
    } catch {
        $body = Get-JiraErrorBody $_
        Write-Warning "  Could not transition $key to '$target'. $($_.Exception.Message)"
        if ($body) { Write-Host $body }
    }
    $created += "$key ($target)"
}

Write-Host ""
Write-Host "Seeding complete. Created:" -ForegroundColor Green
$created | ForEach-Object { Write-Host "  - $_" }
Write-Host ""
Write-Host "Open $JiraUrl/browse/$ProjectKey to verify. Then hard-refresh the dashboard."
