param([int]$Port = 8010)

$ErrorActionPreference = 'Stop'
$runtimeRoot = Split-Path -Parent $PSScriptRoot
$python = @(
  (Join-Path $runtimeRoot 'venv311\Scripts\python.exe'),
  (Join-Path $runtimeRoot '.venv\Scripts\python.exe'),
  (Join-Path $runtimeRoot 'venv\Scripts\python.exe')
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $python) { $python = 'python' }

# The task bodies use asyncio.timeout(), added in Python 3.11. On 3.10 a task
# dies deep inside the fetch with a bare AttributeError and the job surfaces an
# unrelated error code, so refuse to start rather than fail unreadably later.
& $python -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)'
if ($LASTEXITCODE -ne 0) {
  $found = (& $python -c 'import sys; print(".".join(map(str, sys.version_info[:3])))')
  throw "Python 3.11+ required (app/workers uses asyncio.timeout); $python is $found. Recreate the virtualenv with a 3.11 interpreter."
}

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

# Workers outlive a Ctrl-C when the finally block below does not run, and a
# leftover worker on the same queues runs old code and takes jobs from the new
# ones. Stop every worker of this runtime before starting fresh ones.
$stale = Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" |
  Where-Object { $_.CommandLine -match '-m celery -A app\.workers\.\w+:celery_app worker' }
foreach ($process in $stale) {
  Write-Host "Stopping leftover worker $($process.ProcessId)"
  & taskkill /PID $process.ProcessId /T /F *> $null
}

$workers = @()
Push-Location $runtimeRoot
try {
  $workers += Start-Process -FilePath $python -ArgumentList @(
    '-m', 'celery',
    '-A', 'app.workers.datasource_tasks:celery_app', 'worker', '--loglevel=INFO', '--pool=solo',
    '--queues', 'semantic-model-datasource.preview,semantic-model-datasource.batch',
    '--hostname', "semantic-datasource@$(hostname)-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
  ) -WorkingDirectory $runtimeRoot -NoNewWindow -PassThru

  $workers += Start-Process -FilePath $python -ArgumentList @(
    '-m', 'celery',
    '-A', 'app.workers.population_tasks:celery_app', 'worker', '--loglevel=INFO', '--pool=solo',
    '--queues', 'semantic-model-population.batch,semantic-model-population.corrections',
    '--hostname', "semantic-population@$(hostname)-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
  ) -WorkingDirectory $runtimeRoot -NoNewWindow -PassThru

  $workers += Start-Process -FilePath $python -ArgumentList @(
    '-m', 'celery',
    '-A', 'app.workers.graph_search_tasks:celery_app', 'worker', '--loglevel=INFO', '--pool=solo',
    '--queues', 'semantic-model-search.index',
    '--hostname', "semantic-search@$(hostname)-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
  ) -WorkingDirectory $runtimeRoot -NoNewWindow -PassThru

  & $python -m uvicorn app.main:app --host 127.0.0.1 --port $Port
  if ($LASTEXITCODE) { throw "Semantic runtime exited with code $LASTEXITCODE" }
} finally {
  foreach ($worker in $workers) {
    if (-not $worker.HasExited) { & taskkill /PID $worker.Id /T /F *> $null }
  }
  Pop-Location
}
