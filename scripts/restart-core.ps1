<#
.SYNOPSIS
  Restart only backend + frontend + ADK (subset of restart-platform.ps1).
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

$args_ = @('-Only', @('back', 'front', 'adk'), '-WaitSeconds', $WaitSeconds)
if ($KillOnly) { $args_ += '-KillOnly' }
if ($StartOnly) { $args_ += '-StartOnly' }
if ($Build) { $args_ += '-Build' }

& $Platform @args_
