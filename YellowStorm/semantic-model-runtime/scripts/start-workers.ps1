# Start the semantic runtime Celery workers without the API.
#   .\scripts\start-workers.ps1                      # datasource + population + search
#   .\scripts\start-workers.ps1 -Only population     # one worker
# Ctrl+C stops every worker this script started.
param([ValidateSet('all', 'datasource', 'population', 'search')][string]$Only = 'all')

$ErrorActionPreference = 'Stop'
$runtimeRoot = Split-Path -Parent $PSScriptRoot

function Import-DotEnv([string]$Path) {
  foreach ($line in [System.IO.File]::ReadAllLines((Resolve-Path $Path))) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
      [Environment]::SetEnvironmentVariable($matches[1], $matches[2].Trim().Trim('"'), 'Process')
    }
  }
}

Import-DotEnv (Join-Path $runtimeRoot '.env')
if (-not $env:SEMANTIC_BROKER_URL) { throw 'SEMANTIC_BROKER_URL is missing or empty in semantic-model-runtime/.env' }

$definitions = @(
  @{ Name = 'datasource'; App = 'app.workers.datasource_tasks:celery_app'
     Queues = 'semantic-model-datasource.preview,semantic-model-datasource.batch' },
  @{ Name = 'population'; App = 'app.workers.population_tasks:celery_app'
     Queues = 'semantic-model-population.batch,semantic-model-population.corrections' },
  @{ Name = 'search'; App = 'app.workers.graph_search_tasks:celery_app'
     Queues = 'semantic-model-search.index' }
) | Where-Object { $Only -eq 'all' -or $_.Name -eq $Only }

$workers = @()
try {
  foreach ($definition in $definitions) {
    $workers += Start-Process -FilePath 'conda' -ArgumentList @(
      'run', '--no-capture-output', '-n', 'meta', 'python', '-m', 'celery',
      '-A', $definition.App, 'worker', '--loglevel=INFO', '--pool=solo',
      '--queues', $definition.Queues, '--hostname', "semantic-$($definition.Name)@%h"
    ) -WorkingDirectory $runtimeRoot -NoNewWindow -PassThru
    Write-Host "Started the $($definition.Name) worker (pid $($workers[-1].Id))"
  }
  Wait-Process -Id ($workers | ForEach-Object Id)
} finally {
  foreach ($worker in $workers) {
    if (-not $worker.HasExited) { & taskkill /PID $worker.Id /T /F *> $null }
  }
}
