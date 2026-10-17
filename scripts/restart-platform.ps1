<#
.SYNOPSIS
  Restart the full YellowStorm platform, including both MCP services.

.DESCRIPTION
  1. Kills whatever listens on the platform ports (3000, 5173, 8001, 50051, 8025, 8027, 8010)
     plus stale semantic-runtime Celery workers.
  2. Starts the 6 services again in hidden processes, in dependency order:
     semantic-runtime -> mcp-semantic-model -> mcp-playbook -> adk -> backend -> front.
     Logs are written under $env:TEMP\YellowStorm-platform.

  Mirrors the currently observed local startup commands:
    back    : npm run start:prod            (node dist/main, port 3000)
    front   : npm run dev                   (vite, port 5173)
    adk     : conda run -n meta python main.py        (REST 8001 + gRPC 50051)
    mcp     : conda run -n meta python server.py     (port 8027)
    runtime : conda run -n meta python -m uvicorn app.main:app --host 127.0.0.1 --port 8010
              + 3 celery workers (same queues as semantic-model-runtime/scripts/start-local.ps1)

.EXAMPLE
  .\scripts\restart-platform.ps1
  Kill everything on the platform ports and start all 5 services.

.EXAMPLE
  .\scripts\restart-platform.ps1 -Only back,front
  Restart only backend + frontend (still kills just their ports).

.EXAMPLE
  .\scripts\restart-platform.ps1 -KillOnly
  Only kill port owners, do not start anything.

.EXAMPLE
  .\scripts\restart-platform.ps1 -StartOnly -NoWorkers -Build
  Only start (skip killing), start semantic-runtime API without celery workers,
  and rebuild the backend (npm run build) before starting it.
#>
[CmdletBinding()]
param(
  [ValidateSet('back', 'backend', 'adk', 'front', 'frontend', 'mcp', 'mcp-semantic-model', 'playbook', 'mcp-playbook', 'runtime', 'semantic-runtime', 'semantic-model-runtime')]
  [string[]]$Only = @(),

  [switch]$KillOnly,
  [switch]$StartOnly,
  [switch]$NoWorkers,
  [switch]$Build,
  [int]$WaitSeconds = 45
)

$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$BackDir  = Join-Path $RepoRoot 'YellowStorm\back'
$McpDir   = Join-Path $RepoRoot 'mcp\mcp-semantic-model'
$PlaybookMcpDir = Join-Path $RepoRoot 'mcp\mcp-playbook'
$AdkDir   = Join-Path $RepoRoot 'yellowstorm-adk'
$FrontDir = Join-Path $RepoRoot 'YellowStorm\front'
$SemDir   = Join-Path $RepoRoot 'YellowStorm\semantic-model-runtime'

# Canonical service definitions. Ports come from each service's .env / settings:
# back PORT=3000 | front VITE_PORT=5173 | adk PORT=8001 + GRPC_PORT=50051 |
# mcp MCP_PORT=8027 | playbook MCP_PORT=8025 | semantic-runtime default 8010.
$Services = @(
  @{ Key = 'runtime'; Label = 'semantic-runtime'; Dir = $SemDir;  Ports = @(8010) },
  @{ Key = 'mcp';     Label = 'mcp-semantic-model'; Dir = $McpDir; Ports = @(8027) },
  @{ Key = 'playbook'; Label = 'mcp-playbook'; Dir = $PlaybookMcpDir; Ports = @(8025) },
  @{ Key = 'adk';     Label = 'adk';               Dir = $AdkDir;  Ports = @(8001, 50051) },
  @{ Key = 'back';    Label = 'backend';            Dir = $BackDir; Ports = @(3000) },
  @{ Key = 'front';   Label = 'front';             Dir = $FrontDir; Ports = @(5173) }
)

function Test-Selected([string]$Key) {
  if ($Only.Count -eq 0) { return $true }
  $aliases = @{
    'back' = @('back', 'backend'); 'adk' = @('adk'); 'front' = @('front', 'frontend');
    'mcp' = @('mcp', 'mcp-semantic-model'); 'runtime' = @('runtime', 'semantic-runtime', 'semantic-model-runtime')
    'playbook' = @('playbook', 'mcp-playbook')
  }
  foreach ($wanted in $Only) {
    if ($aliases[$Key] -contains $wanted) { return $true }
  }
  return $false
}

function Stop-PortOwner([int]$Port) {
  $conns = @()
  try {
    $conns = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  } catch {
    $conns = @()
  }
  $killed = @()
  foreach ($conn in $conns) {
    $pid_ = $conn.OwningProcess
    if ($pid_ -and $pid_ -gt 4) {
      try {
        $proc = Get-Process -Id $pid_ -ErrorAction SilentlyContinue
        $name = 'unknown'
        if ($proc) { $name = $proc.ProcessName }
        Stop-Process -Id $pid_ -Force -ErrorAction SilentlyContinue
        $killed += ('{0} (pid {1})' -f $name, $pid_)
        Write-Host ('  port {0}: killed {1} (pid {2})' -f $Port, $name, $pid_)
      } catch {
        Write-Warning ('  port {0}: could not kill pid {1}: {2}' -f $Port, $pid_, $_.Exception.Message)
      }
    }
  }
  if ($killed.Count -eq 0) { Write-Host ('  port {0}: free (nothing listening)' -f $Port) }
}

function Stop-StaleSemanticWorkers {
  # Same pattern as semantic-model-runtime/scripts/start-local.ps1: leftover
  # celery workers run old code and steal jobs from the new ones.
  try {
    $stale = Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -match '-m celery -A app\.workers\.\w+:celery_app worker' }
  } catch {
    $stale = @()
  }
  foreach ($process in $stale) {
    Write-Host ('  stale celery worker pid {0} -> taskkill' -f $process.ProcessId)
    & taskkill /PID $process.ProcessId /T /F *> $null
  }
  if (-not $stale -or $stale.Count -eq 0) { Write-Host '  no stale celery workers' }
}

function Wait-PortFree([int]$Port, [int]$TimeoutSec = 10) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    $still = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    if ($still.Count -eq 0) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

function Wait-PortListening([int]$Port, [int]$TimeoutSec = 45) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    $hit = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    if ($hit.Count -gt 0) { return $true }
    Start-Sleep -Seconds 1
  }
  return $false
}

function Start-ServiceWindow([string]$Title, [string]$WorkDir, [string]$Command) {
  $logDir = Join-Path $env:TEMP 'YellowStorm-platform'
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
  Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @('-NoProfile', '-Command', $Command) -WorkingDirectory $WorkDir -RedirectStandardOutput (Join-Path $logDir "$Title.log") -RedirectStandardError (Join-Path $logDir "$Title.err.log") | Out-Null
  Write-Host ('  started [{0}]; logs: {1}' -f $Title, $logDir)
}

# --- preflight ---------------------------------------------------------------
foreach ($svc in $Services) {
  if (Test-Selected $svc.Key) {
    if (-not (Test-Path -LiteralPath $svc.Dir)) {
      throw ('Service directory missing: {0}' -f $svc.Dir)
    }
  }
}
try {
  $null = Get-Command npm -ErrorAction Stop
  $null = Get-Command conda -ErrorAction Stop
} catch {
  throw 'npm and conda must be on PATH (backend/front need npm, ADK/MCP/runtime need "conda run -n meta").'
}

$selectedKeys = @($Services | Where-Object { Test-Selected $_.Key } | ForEach-Object { $_.Key })

# --- kill phase --------------------------------------------------------------
if (-not $StartOnly) {
  Write-Host '== Stopping port owners =='
  foreach ($svc in $Services) {
    if (-not (Test-Selected $svc.Key)) { continue }
    Write-Host ('[{0}]' -f $svc.Label)
    foreach ($port in $svc.Ports) { Stop-PortOwner $port }
  }
  if (Test-Selected 'runtime') {
    Write-Host '[semantic-runtime workers]'
    Stop-StaleSemanticWorkers
  }
  Start-Sleep -Seconds 2
  $stuck = @()
  foreach ($svc in $Services) {
    if (-not (Test-Selected $svc.Key)) { continue }
    foreach ($port in $svc.Ports) {
      if (-not (Wait-PortFree $port 8)) { $stuck += $port }
    }
  }
  if ($stuck.Count -gt 0) {
    Write-Warning ('Ports still busy after kill: {0}. Aborting start.' -f ($stuck -join ', '))
    exit 1
  }
  Write-Host 'All selected ports are free.'
}

if ($KillOnly) { Write-Host 'KillOnly: done.'; exit 0 }

# --- start phase --------------------------------------------------------------
Write-Host '== Starting services =='

if (Test-Selected 'runtime') {
  Write-Host '[1/6] semantic-runtime (port 8010)...'
  if (-not $NoWorkers) {
    Start-ServiceWindow 'semantic-datasource-worker' $SemDir "conda run -n meta --no-capture-output python -m celery -A app.workers.datasource_tasks:celery_app worker --loglevel=INFO --pool=solo --queues semantic-model-datasource.preview,semantic-model-datasource.batch --hostname 'semantic-datasource@%h'"
    Start-ServiceWindow 'semantic-population-worker' $SemDir "conda run -n meta --no-capture-output python -m celery -A app.workers.population_tasks:celery_app worker --loglevel=INFO --pool=solo --queues semantic-model-population.batch,semantic-model-population.corrections --hostname 'semantic-population@%h'"
    Start-ServiceWindow 'semantic-search-worker' $SemDir "conda run -n meta --no-capture-output python -m celery -A app.workers.graph_search_tasks:celery_app worker --loglevel=INFO --pool=solo --queues semantic-model-search.index --hostname 'semantic-search@%h'"
  }
  Start-ServiceWindow 'semantic-runtime' $SemDir 'conda run -n meta --no-capture-output python -m uvicorn app.main:app --host 127.0.0.1 --port 8010'
}

if (Test-Selected 'mcp') {
  Write-Host '[2/6] mcp-semantic-model (port 8027)...'
  Start-ServiceWindow 'mcp-semantic-model' $McpDir 'conda run -n meta --no-capture-output python server.py'
}

if (Test-Selected 'playbook') {
  Write-Host '[3/6] mcp-playbook (port 8025)...'
  Start-ServiceWindow 'mcp-playbook' $PlaybookMcpDir 'conda run -n meta --no-capture-output python server.py'
}

if (Test-Selected 'adk') {
  Write-Host '[4/6] adk (ports 8001 + 50051)...'
  Start-ServiceWindow 'adk' $AdkDir 'conda run -n meta --no-capture-output python main.py'
}

if (Test-Selected 'back') {
  Write-Host '[5/6] backend (port 3000)...'
  if ($Build) {
    Write-Host '  building backend (npm run build)...'
    Push-Location $BackDir
    try { & npm run build } finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) { throw 'Backend build failed; aborting.' }
  } elseif (-not (Test-Path -LiteralPath (Join-Path $BackDir 'dist\main.js'))) {
    Write-Warning '  backend dist/main.js missing: running npm run build first.'
    Push-Location $BackDir
    try { & npm run build } finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) { throw 'Backend build failed; aborting.' }
  }
  Start-ServiceWindow 'backend' $BackDir 'npm run start:prod'
}

if (Test-Selected 'front') {
  Write-Host '[6/6] front (port 5173)...'
  Start-ServiceWindow 'front' $FrontDir 'npm run dev'
}

# --- verify -------------------------------------------------------------------
Write-Host ('== Waiting up to {0}s for ports == ' -f $WaitSeconds)
$failed = @()
foreach ($svc in $Services) {
  if (-not (Test-Selected $svc.Key)) { continue }
  foreach ($port in $svc.Ports) {
    if (Wait-PortListening $port $WaitSeconds) {
      Write-Host ('  OK   port {0} [{1}] listening' -f $port, $svc.Label)
    } else {
      Write-Warning ('  MISS port {0} [{1}] not listening yet - check logs in %TEMP%\YellowStorm-platform' -f $port, $svc.Label)
      $failed += $port
    }
  }
}

Write-Host ''
Write-Host 'Health endpoints to confirm manually:'
Write-Host '  back    http://localhost:3000/api/v1/health/ready'
Write-Host '  front   http://localhost:5173/'
Write-Host '  adk     http://localhost:8001/health/ready + grpc localhost:50051'
Write-Host '  playbook http://localhost:8025/health/ready'
Write-Host '  mcp     http://localhost:8027/ (streamable-http) + /health/ready'
Write-Host '  runtime http://127.0.0.1:8010/health (or /health/ready)'

if ($failed.Count -gt 0) { exit 1 }
Write-Host 'Platform restart complete.'
