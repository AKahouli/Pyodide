param([int]$Port = 8010)

$ErrorActionPreference = 'Stop'
$runtimeRoot = Split-Path -Parent $PSScriptRoot
$backendEnv = Join-Path $runtimeRoot '..\back\.env'

function Import-DotEnv([string]$Path) {
  foreach ($line in [System.IO.File]::ReadAllLines((Resolve-Path $Path))) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
      [Environment]::SetEnvironmentVariable($matches[1], $matches[2].Trim().Trim('"'), 'Process')
    }
  }
}

Import-DotEnv (Join-Path $runtimeRoot '.env')
$backendLines = [System.IO.File]::ReadAllLines((Resolve-Path $backendEnv))
$secretLine = @($backendLines | Where-Object { $_ -match '^\s*INTERNAL_SERVICE_SECRET\s*=' })
if (-not $secretLine.Count) { throw 'INTERNAL_SERVICE_SECRET is missing from back/.env' }

$env:YELLOWSTORM_BACKEND_URL = 'http://127.0.0.1:3000'
$env:YELLOWSTORM_INTERNAL_SERVICE_TOKEN = ($secretLine[0] -split '=', 2)[1].Trim().Trim('"')
if (-not $env:YELLOWSTORM_INTERNAL_SERVICE_TOKEN) { throw 'INTERNAL_SERVICE_SECRET is empty' }

$workers = @()
Push-Location $runtimeRoot
try {
  $workers += Start-Process -FilePath 'conda' -ArgumentList @(
    'run', '--no-capture-output', '-n', 'meta', 'python', '-m', 'celery',
    '-A', 'app.workers.datasource_tasks:celery_app', 'worker', '--loglevel=INFO', '--pool=solo',
    '--queues', 'semantic-model-datasource.preview,semantic-model-datasource.batch',
    '--hostname', 'semantic-datasource@%h'
  ) -WorkingDirectory $runtimeRoot -NoNewWindow -PassThru

  $workers += Start-Process -FilePath 'conda' -ArgumentList @(
    'run', '--no-capture-output', '-n', 'meta', 'python', '-m', 'celery',
    '-A', 'app.workers.population_tasks:celery_app', 'worker', '--loglevel=INFO', '--pool=solo',
    '--queues', 'semantic-model-population.batch,semantic-model-population.corrections',
    '--hostname', 'semantic-population@%h'
  ) -WorkingDirectory $runtimeRoot -NoNewWindow -PassThru

  & conda run --no-capture-output -n meta python -m uvicorn app.main:app --host 127.0.0.1 --port $Port
  if ($LASTEXITCODE) { throw "Semantic runtime exited with code $LASTEXITCODE" }
} finally {
  foreach ($worker in $workers) {
    if (-not $worker.HasExited) { & taskkill /PID $worker.Id /T /F *> $null }
  }
  Pop-Location
}
