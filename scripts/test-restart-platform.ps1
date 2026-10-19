# Exercise service selection and launch wiring without stopping/starting services.
$ErrorActionPreference = 'Stop'
$tokens = $null
$parseErrors = $null
$scriptPath = Join-Path $PSScriptRoot 'restart-platform.ps1'
$ast = [System.Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw $parseErrors[0] }
$RepoRoot = Split-Path -Parent $PSScriptRoot
$McpDir = Join-Path $RepoRoot 'mcp\mcp-semantic-model'
$PlaybookMcpDir = Join-Path $RepoRoot 'mcp\mcp-playbook'
$AdkDir = Join-Path $RepoRoot 'yellowstorm-adk'
$BackDir = Join-Path $RepoRoot 'YellowStorm\back'
$FrontDir = Join-Path $RepoRoot 'YellowStorm\front'
$SemDir = Join-Path $RepoRoot 'YellowStorm\semantic-model-runtime'
$assignment = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -eq '$Services' }, $true)
$Services = & ([scriptblock]::Create($assignment.Right.Extent.Text))
$selection = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Test-Selected' }, $true)
. ([scriptblock]::Create($selection.Extent.Text))
$Only = @()
if (@($Services | Where-Object { Test-Selected $_.Key }).Count -ne 6) { throw 'Full restart must include all six services' }
foreach ($alias in @('playbook', 'mcp-playbook')) {
  $Only = @($alias)
  $selected = @($Services | Where-Object { Test-Selected $_.Key })
  if ($selected.Count -ne 1 -or $selected[0].Key -ne 'playbook' -or $selected[0].Ports[0] -ne 8025) { throw "Incorrect service selection for $alias" }
}
$script:launch = $null
function Start-ServiceWindow($Title, $WorkDir, $Command) { $script:launch = @($Title, $WorkDir, $Command) }
$start = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.IfStatementAst] -and $node.Clauses[0].Item1.Extent.Text -eq "Test-Selected 'playbook'" }, $true)
& ([scriptblock]::Create($start.Extent.Text))
if ($script:launch[0] -ne 'mcp-playbook' -or $script:launch[1] -ne $PlaybookMcpDir -or $script:launch[2] -ne 'conda run -n meta --no-capture-output python server.py') { throw 'Incorrect Playbook MCP launch' }
$coreAst = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'restart-core.ps1'), [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw $parseErrors[0] }
$Platform = {
  param([string[]]$Only, [int]$WaitSeconds, [switch]$KillOnly, [switch]$StartOnly, [switch]$Build)
  $script:forwarded = @{ Only = $Only; WaitSeconds = $WaitSeconds; KillOnly = $KillOnly; StartOnly = $StartOnly; Build = $Build }
}
$WaitSeconds = 17
$KillOnly = $true
$StartOnly = $true
$Build = $true
foreach ($statement in $coreAst.EndBlock.Statements) {
  if ($statement.Extent.Text.Contains('$args_') -or $statement.Extent.Text.Contains('@args_')) { . ([scriptblock]::Create($statement.Extent.Text)) }
}
if (($script:forwarded.Only -join ',') -ne 'back,front,adk,playbook' -or $script:forwarded.WaitSeconds -ne 17 -or !$script:forwarded.KillOnly -or !$script:forwarded.StartOnly -or !$script:forwarded.Build) { throw 'Incorrect core restart parameter forwarding' }
Write-Host 'PASS: full restart, both aliases, Playbook launch and core parameter forwarding'
