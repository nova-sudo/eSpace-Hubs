<#
.SYNOPSIS
    Adds a fresh round of ESD tickets (ESD-111 -> ESD-116) to the Jira
    ESD project. Mirrors the new PRs created on the eSpaceDev mock repo:

      ESD-111  Migrate metrics export to OpenTelemetry      -> Done
      ESD-112  Idempotency keys for settlement webhook      -> Done
      ESD-113  Cache layer for /healthz dependencies        -> Done
      ESD-114  Wire Prometheus exporter for queue depth     -> In Progress
      ESD-115  Spike -- feature flag service comparison      -> In Progress
      ESD-116  Fix race condition in retry counter increment -> In Progress

.DESCRIPTION
    Reuses the patterns from seed-jira.ps1 (ADF body for description,
    /myself for accountId resolution, transitions endpoint for status).
    Tickets are created assigned to the token owner so they show up in
    the dashboard's "assigned to me" view.

.EXAMPLE
    .\scripts\seed-jira-new.ps1 `
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
    [string] $WipStatus = "In Progress"
)

$ErrorActionPreference = "Stop"
$JiraUrl = $JiraUrl.TrimEnd("/")

$authBytes = [Text.Encoding]::ASCII.GetBytes("${JiraEmail}:${JiraToken}")
$authHeader = "Basic " + [Convert]::ToBase64String($authBytes)
$headers = @{
    Authorization = $authHeader
    Accept        = "application/json"
}

function Get-JiraErrorBody {
    param($Err)
    if ($Err.ErrorDetails -and $Err.ErrorDetails.Message) { return $Err.ErrorDetails.Message }
    if ($Err.Exception.Response) {
        try {
            $stream = $Err.Exception.Response.GetResponseStream()
            $reader = [System.IO.StreamReader]::new($stream)
            return $reader.ReadToEnd()
        } catch { return $null }
    }
    return $null
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
    if ($AccountId) { $fields.assignee = @{ accountId = $AccountId } }
    $body = @{ fields = $fields } | ConvertTo-Json -Depth 10 -Compress

    Invoke-RestMethod -Method Post `
        -Uri "$JiraUrl/rest/api/3/issue" `
        -Headers $headers `
        -ContentType "application/json" `
        -Body $body
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

# Tickets -- (mockKey, summary, description, targetStatus)
$tickets = @(
    @("ESD-111", "Migrate metrics export to OpenTelemetry",
      "Replaced the home-grown statsd shim with the OTel SDK + OTLP exporter. Single dependency, native traces alongside metrics. Merged in PR #14.",
      $DoneStatus),
    @("ESD-112", "Idempotency keys for settlement webhook",
      "Webhook handlers now look for an Idempotency-Key header and short-circuit duplicates via a 1h TTL cache. Stops the double-credit class of bug. Merged in PR #15.",
      $DoneStatus),
    @("ESD-113", "Cache layer for /healthz dependencies",
      "Probe checks for downstream services (Redis, primary DB, settlement) now cache for 5s so a healthy probe doesn't hammer infra at probe-rate. Merged in PR #16.",
      $DoneStatus),
    @("ESD-114", "Wire Prometheus exporter for queue depth",
      "Exposes queue_depth and oldest_message_age_seconds gauges from the worker. In review at PR #17. Open questions on cardinality and naming convention.",
      $WipStatus),
    @("ESD-115", "Spike: feature flag service comparison",
      "Stripped-down comparison of LaunchDarkly vs Unleash vs Flagsmith for our use case. Notes only. Draft at PR #18; pending re-run with real MAU numbers.",
      $WipStatus),
    @("ESD-116", "Fix race condition in retry counter increment",
      "Replace read-modify-write on the retry counter with a single atomic incr to avoid lost increments under concurrent failures. In review at PR #19.",
      $WipStatus)
)

Write-Host ""
Write-Host "Seeding $($tickets.Count) NEW tickets into $ProjectKey at $JiraUrl"
Write-Host ""

# Resolve token owner -> assignee
try {
    $me = Invoke-RestMethod -Method Get -Uri "$JiraUrl/rest/api/3/myself" -Headers $headers
    $accountId = $me.accountId
    Write-Host "[OK] Authenticated as $($me.displayName) (accountId $accountId)"
    Write-Host ""
} catch {
    Write-Warning "  Could not resolve accountId -- tickets will be created without an assignee."
    $accountId = $null
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
        if ($body) { Write-Host "  Jira response body: $body" -ForegroundColor Yellow }
        continue
    }
    $key = $res.key
    Write-Host "  [OK] Created $key -- transitioning to '$target'"
    try {
        Move-JiraIssue -Key $key -TargetStatus $target
    } catch {
        $body = Get-JiraErrorBody $_
        Write-Warning "  Could not transition $key. $($_.Exception.Message)"
        if ($body) { Write-Host $body }
    }
    $created += "$key ($target)"
}

Write-Host ""
Write-Host "Seeding complete. Created:" -ForegroundColor Green
$created | ForEach-Object { Write-Host "  - $_" }
Write-Host ""
Write-Host "Open $JiraUrl/browse/$ProjectKey to verify, then hard-refresh the dashboard."
