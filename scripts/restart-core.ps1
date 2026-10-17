<#
.SYNOPSIS
  Restart backend + frontend + ADK + Playbook MCP (subset of restart-platform.ps1).
#>
[CmdletBinding()]
param(
  [switch]$KillOnly,
  [switch]$StartOnly,
  [switch]$Build,
  [int]$WaitSeconds = 45
)

$ErrorActionPreference = 'Stop'
$Platform = Join-Path $PSScriptRoot 'restart-platform.ps1'
if (-not (Test-Path -LiteralPath $Platform)) { throw "Missing: $Platform" }

$args_ = @{ Only = @('back', 'front', 'adk', 'playbook'); WaitSeconds = $WaitSeconds }
if ($KillOnly) { $args_.KillOnly = $true }
if ($StartOnly) { $args_.StartOnly = $true }
if ($Build) { $args_.Build = $true }

& $Platform @args_
