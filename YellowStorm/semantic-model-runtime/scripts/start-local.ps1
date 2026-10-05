param([int]$Port = 8010)

$ErrorActionPreference = 'Stop'
$runtimeRoot = Split-Path -Parent $PSScriptRoot

function Import-DotEnv([string]$Path) {
  foreach ($line in [System.IO.File]::ReadAllLines((Resolve-Path $Path))) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
      [Environment]::SetEnvironmentVariable($matches[1], $matches[2].Trim().Trim('"'), 'Process')
    }
  }
}

# The semantic runtime is self-sufficient: everything it needs — including
# YELLOWSTORM_BACKEND_URL and YELLOWSTORM_INTERNAL_SERVICE_TOKEN — comes from
# its own .env. No back/.env dependency.
Import-DotEnv (Join-Path $runtimeRoot '.env')
if (-not $env:YELLOWSTORM_INTERNAL_SERVICE_TOKEN) { throw 'YELLOWSTORM_INTERNAL_SERVICE_TOKEN is missing or empty in semantic-model-runtime/.env' }
if (-not $env:YELLOWSTORM_BACKEND_URL) { throw 'YELLOWSTORM_BACKEND_URL is missing or empty in semantic-model-runtime/.env' }

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

  $workers += Start-Process -FilePath 'conda' -ArgumentList @(
    'run', '--no-capture-output', '-n', 'meta', 'python', '-m', 'celery',
    '-A', 'app.workers.graph_search_tasks:celery_app', 'worker', '--loglevel=INFO', '--pool=solo',
    '--queues', 'semantic-model-search.index',
    '--hostname', 'semantic-search@%h'
  ) -WorkingDirectory $runtimeRoot -NoNewWindow -PassThru

  & conda run --no-capture-output -n meta python -m uvicorn app.main:app --host 127.0.0.1 --port $Port
  if ($LASTEXITCODE) { throw "Semantic runtime exited with code $LASTEXITCODE" }
} finally {
  foreach ($worker in $workers) {
    if (-not $worker.HasExited) { & taskkill /PID $worker.Id /T /F *> $null }
  }
  Pop-Location
}
