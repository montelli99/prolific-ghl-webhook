<#
.SYNOPSIS
  Pipeline health and readiness diagnostic
.DESCRIPTION
  Read-only status check for the Prolific Capital Pipeline system.
  Returns machine-readable JSON or human-readable text.
.PARAMETER Json
  Output machine-readable JSON instead of formatted text.
.EXAMPLE
  .\ops\pipeline-status.ps1
  .\ops\pipeline-status.ps1 -Json
#>
param([switch]$Json)

$ErrorActionPreference = 'SilentlyContinue'
$result = @{
  checkedAt = (Get-Date -Format 'o')
  hostname = $env:COMPUTERNAME
  windowsUptime = ''
  gateway = @{}
  telegram = @{}
  repositories = @{}
  killSwitch = @{}
  recovery = @{}
  dependencies = @{}
  contactCard = @{}
  status = 'UNKNOWN'
}

# Windows uptime
try {
  $os = Get-CimInstance Win32_OperatingSystem
  $boot = $os.LastBootUpTime
  $uptime = New-TimeSpan -Start $boot -End (Get-Date)
  $result.windowsUptime = "$($uptime.Days)d $($uptime.Hours)h $($uptime.Minutes)m"
} catch { $result.windowsUptime = 'unknown' }

# Gateway
$port18789 = netstat -ano | Select-String ':18789.*LISTENING'
if ($port18789) {
  $pidStr = ($port18789 -split '\s+')[-1]
  try {
    $proc = Get-Process -Id ([int]$pidStr) -ErrorAction Stop
    $result.gateway = @{
      running = $true
      pid = $proc.Id
      processName = $proc.ProcessName
      startTime = $proc.StartTime.ToString('o')
      port = 18789
    }
  } catch {
    $result.gateway = @{ running = $false; port = 18789; error = "PID $pidStr not found" }
  }
} else {
  $result.gateway = @{ running = $false; port = 18789; error = 'No process on port 18789' }
}

# Telegram consumer count
$telegramProcs = Get-Process node -ErrorAction SilentlyContinue | Where-Object {
  try { (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)").CommandLine -match 'telegram|gateway' } catch { $false }
}
$result.telegram = @{
  nodeProcesses = ($telegramProcs | Measure-Object).Count
  kaylaTelegramBotRunning = (Get-Process node -ErrorAction SilentlyContinue | Where-Object {
    try { (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)").CommandLine -match 'kayla-telegram-bot' } catch { $false }
  } | Measure-Object).Count -gt 0
}

# Repositories
$workspace = 'C:\Users\mscott\AI_Workspace'
$repos = @(
  @{name='prolificcapital'; path="$workspace\prolificcapital"},
  @{name='openclaw'; path="$workspace\OpenClaw"},
  @{name='prolific-ghl-webhook'; path="$workspace\prolificcapital\prolific-ghl-webhook"}
)
foreach ($repo in $repos) {
  if (Test-Path "$($repo.path)\.git") {
    try {
      $rev = git -C $repo.path rev-parse --short HEAD 2>&1
      $branch = git -C $repo.path rev-parse --abbrev-ref HEAD 2>&1
      $dirty = (git -C $repo.path status --porcelain 2>&1 | Measure-Object).Count -gt 0
      $result.repositories[$repo.name] = @{ revision = $rev.Trim(); branch = $branch.Trim(); dirty = $dirty }
    } catch {
      $result.repositories[$repo.name] = @{ error = 'git failed' }
    }
  } else {
    $result.repositories[$repo.name] = @{ error = 'not a git repo' }
  }
}

# Kill switch
$ksPath = "$workspace\prolificcapital\ghl-automations\data\telegram-outreach-dry-run\kill-switch.json"
if (Test-Path $ksPath) {
  try {
    $ks = Get-Content $ksPath -Raw | ConvertFrom-Json
    $result.killSwitch = @{
      state = $ks.state
      liveSends = $ks.liveSends
      productionWrites = $ks.productionWrites
      stageMovements = $ks.stageMovements
      updatedAt = $ks.updatedAt
    }
  } catch { $result.killSwitch = @{ error = 'parse failed' } }
} else { $result.killSwitch = @{ error = 'file not found' } }

# Recovery queue
$rqPath = "$workspace\prolificcapital\ghl-automations\data\runtime\recovery-queue.json"
if (Test-Path $rqPath) {
  try {
    $rq = Get-Content $rqPath -Raw | ConvertFrom-Json
    $result.recovery = @{ queueCount = $rq.count; items = $rq.items }
  } catch { $result.recovery = @{ error = 'parse failed' } }
} else { $result.recovery = @{ queueCount = 0; items = @() } }

# Dependencies
$result.dependencies = @{
  ollama = @{ running = (Get-Process ollama -ErrorAction SilentlyContinue | Measure-Object).Count -gt 0 }
  nodeVersion = (node --version 2>&1)
  openclawVersion = (npm list -g openclaw --depth=0 2>&1 | Select-String 'openclaw@')
}

# Contact card
$cardPath = "$workspace\prolificcapital\ghl-automations\data\runtime\montelli-scott-divinity-aligned.vcf"
if (Test-Path $cardPath) {
  try {
    $vcf = Get-Content $cardPath -Raw
    $hash = (Get-FileHash -Path $cardPath -Algorithm SHA256).Hash.ToLower()
    $result.contactCard = @{
      exists = $true
      sha256 = $hash
      expectedHash = '77bbcbdab80a604d3161d0a898fd92e1832d258c7c91a41349a86a5d18f60065'
      hashMatch = ($hash -eq '77bbcbdab80a604d3161d0a898fd92e1832d258c7c91a41349a86a5d18f60065')
    }
  } catch { $result.contactCard = @{ exists = $true; error = 'hash failed' } }
} else { $result.contactCard = @{ exists = $false } }

# Overall status
$gw = $result.gateway.running
$ks = $result.killSwitch.state
$rq = $result.recovery.queueCount
if (-not $gw) { $result.status = 'GATEWAY_DOWN' }
elseif ($ks -ne 'PAUSED') { $result.status = 'RECOVERY_REQUIRED_PAUSED' }
elseif ($rq -gt 0) { $result.status = 'RECOVERY_REQUIRED_PAUSED' }
else { $result.status = 'READY_PAUSED' }

if ($Json) {
  $result | ConvertTo-Json -Depth 4
} else {
  Write-Host "=== Pipeline Status ===" -ForegroundColor Cyan
  Write-Host "Host: $($result.hostname) | Uptime: $($result.windowsUptime)"
  Write-Host ""
  Write-Host "Gateway: $(if($result.gateway.running){'RUNNING'}else{'DOWN'}) PID=$($result.gateway.pid) Port=$($result.gateway.port)"
  Write-Host "Kill Switch: $($result.killSwitch.state) | Sends: $($result.killSwitch.liveSends) | Writes: $($result.killSwitch.productionWrites) | Moves: $($result.killSwitch.stageMovements)"
  Write-Host "Recovery Queue: $($result.recovery.queueCount) items"
  Write-Host "Telegram: $($result.telegram.nodeProcesses) node process(es) | Kayla bot: $(if($result.telegram.kaylaTelegramBotRunning){'RUNNING (BLOCKED)'}else{'stopped'})"
  Write-Host ""
  Write-Host "Repositories:"
  foreach ($r in $result.repositories.Keys) {
    $v = $result.repositories[$r]
    Write-Host "  $r : $($v.revision) ($($v.branch)) $(if($v.dirty){'DIRTY'}else{'clean'})"
  }
  Write-Host ""
  Write-Host "Dependencies: Ollama=$(if($result.dependencies.ollama.running){'running'}else{'down'}) | Node=$($result.dependencies.nodeVersion)"
  Write-Host "Contact Card: $(if($result.contactCard.exists){'exists'}else{'MISSING'}) | Hash: $(if($result.contactCard.hashMatch){'MATCH'}else{'MISMATCH'})"
  Write-Host ""
  Write-Host "Status: $($result.status)" -ForegroundColor $(if($result.status -eq 'READY_PAUSED'){'Green'}else{'Yellow'})
}
