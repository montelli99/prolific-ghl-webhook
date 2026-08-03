<#
.SYNOPSIS
  Roll back Pipeline to a previous revision
.PARAMETER Revision
  Git tag or commit to roll back to
.PARAMETER SafeMode
  Start in safe mode after rollback
#>
param(
  [Parameter(Mandatory=$true)]
  [string]$Revision,
  [switch]$SafeMode
)

$ErrorActionPreference = 'Stop'
$workspace = 'C:\Users\mscott\AI_Workspace'
$prolificDir = "$workspace\prolificcapital"

Write-Host "Pipeline Rollback" -ForegroundColor Cyan
Write-Host "Target revision: $Revision"

# Verify revision exists
$exists = git -C $prolificDir rev-parse --verify "$Revision^{commit}" 2>&1
if (-not $?) { throw "Revision $Revision not found" }
Write-Host "Revision verified: $exists"

# Check kill switch
$ksPath = "$prolificDir\ghl-automations\data\telegram-outreach-dry-run\kill-switch.json"
if (Test-Path $ksPath) {
  $ks = Get-Content $ksPath -Raw | ConvertFrom-Json
  if ($ks.state -ne 'PAUSED') {
    Write-Host "WARNING: Kill switch is $($ks.state), not PAUSED" -ForegroundColor Yellow
  }
}

# Create pre-rollback backup
$backupScript = Join-Path $PSScriptRoot 'backup-pipeline-runtime.ps1'
if (Test-Path $backupScript) {
  Write-Host "Creating pre-rollback backup..."
  & $backupScript -Destination "$prolificDir\backups"
}

# Stop gateway
Write-Host "Stopping gateway..."
$port18789 = netstat -ano | Select-String ':18789.*LISTENING'
if ($port18789) {
  $pidStr = ($port18789 -split '\s+')[-1]
  Stop-Process -Id ([int]$pidStr) -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  Write-Host "Gateway stopped (PID $pidStr)"
}

# Record current revision
$currentRev = git -C $prolificDir rev-parse --short HEAD
Write-Host "Current revision: $currentRev"

# Checkout target
git -C $prolificDir checkout $Revision
Write-Host "Checked out: $Revision"

# Validate schemas
$ksCheck = Get-Content $ksPath -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json -ErrorAction SilentlyContinue
if (-not $ksCheck) { Write-Host "WARNING: kill-switch.json may be invalid" -ForegroundColor Yellow }

# Start in safe mode or normal
if ($SafeMode) {
  Write-Host "Starting in safe mode..."
  $gatewayCmd = "$env:USERPROFILE\.openclaw\gateway.cmd"
  if (Test-Path $gatewayCmd) {
    Start-Process cmd.exe -ArgumentList "/c `"$gatewayCmd`" --safe-mode" -WindowStyle Hidden
  }
} else {
  Write-Host "Rollback complete. Start gateway manually:"
  Write-Host "  $env:USERPROFILE\.openclaw\gateway.cmd"
}

Write-Host "Rollback: $currentRev -> $Revision" -ForegroundColor Green
