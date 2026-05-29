param(
  [string]$AdkLogPath = (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) '.tmp\adk-phase5.err.log'),
  [switch]$RequireAdkCacheEvidence
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$backDir = Join-Path $repoRoot 'back'
$frontDir = Join-Path $repoRoot 'front'
$adkDir = Join-Path (Split-Path -Parent $repoRoot) 'yellowstorm-adk'

function Invoke-Step {
  param(
    [string]$Label,
    [scriptblock]$Action
  )

  Write-Host "==> $Label"
  & $Action
}

function Assert-HttpOk {
  param(
    [string]$Url
  )

  $response = Invoke-WebRequest -Uri $Url -UseBasicParsing
  if ($response.StatusCode -ne 200) {
    throw "Expected 200 from $Url but got $($response.StatusCode)"
  }
}

function Assert-AdkCacheEvidence {
  param(
    [string]$LogPath
  )

  if (-not (Test-Path $LogPath)) {
    throw "ADK log file not found: $LogPath"
  }

  $logText = Get-Content -Raw $LogPath
  $hasMiss = $logText -match 'playbook_graph_compile_duration_ms.+cache=miss'
  $hasHit = $logText -match 'playbook_graph_compile_duration_ms.+cache=hit'

  if (-not $hasMiss -or -not $hasHit) {
    throw "Expected ADK compile cache evidence in $LogPath (miss=$hasMiss hit=$hasHit)"
  }
}

Invoke-Step 'Backend focused Phase 5 tests' {
  Push-Location $backDir
  try {
    npm test -- --runInBand --runTestsByPath src/modules/playbook-flow/services/playbook-flow.service.spec.ts --testNamePattern="findOneBase|findOneEnriched"
    npm test -- --runInBand --runTestsByPath src/modules/playbook-flow/services/playbook-flow-execution.service.spec.ts --testNamePattern="uses the base execution-start read instead of the enriched read path"
  } finally {
    Pop-Location
  }
}

Invoke-Step 'Frontend focused Phase 5 tests' {
  Push-Location $frontDir
  try {
    npm test -- src/modules/playbook/store.test.ts
  } finally {
    Pop-Location
  }
}

Invoke-Step 'Backend build' {
  Push-Location $backDir
  try {
    npm run build
  } finally {
    Pop-Location
  }
}

Invoke-Step 'Frontend build' {
  Push-Location $frontDir
  try {
    npm run build
  } finally {
    Pop-Location
  }
}

Invoke-Step 'ADK python compile check (meta env)' {
  Push-Location $adkDir
  try {
    $command = @'
& conda shell.powershell hook | Out-String | Invoke-Expression
conda activate meta
python -m py_compile src/flow_engine/runtime/graph_cache.py src/flow_engine/grpc_service.py src/flow_engine/tests/test_graph_cache.py
'@
    powershell -NoProfile -Command $command
  } finally {
    Pop-Location
  }
}

Invoke-Step 'Local service health checks' {
  Assert-HttpOk 'http://localhost:3000/api/v1/health'
  Assert-HttpOk 'http://localhost:8001/docs'
  Assert-HttpOk 'http://localhost:5173/'
}

if ($RequireAdkCacheEvidence) {
  Invoke-Step 'ADK compile cache evidence' {
    Assert-AdkCacheEvidence $AdkLogPath
  }
}

Write-Host 'Phase 5 verification passed.'
