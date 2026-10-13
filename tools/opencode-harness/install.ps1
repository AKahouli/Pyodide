param([string]$Destination = (Join-Path $env:USERPROFILE '.config\opencode'))

$ErrorActionPreference = 'Stop'
$runtime = Join-Path $PSScriptRoot 'runtime'
$config = Join-Path $PSScriptRoot 'config'
if (-not (Test-Path -LiteralPath (Join-Path $Destination 'node_modules\@opencode-ai\plugin'))) {
    throw 'Install the OpenCode plugin SDK in the destination configuration directory first.'
}
New-Item -ItemType Directory -Path (Join-Path $Destination 'plugins'),(Join-Path $Destination 'lib'),(Join-Path $Destination 'agents') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $runtime 'plugins\sdlc.js') -Destination (Join-Path $Destination 'plugins\sdlc.js')
Copy-Item -LiteralPath (Join-Path $runtime 'lib\sdlc-core.mjs') -Destination (Join-Path $Destination 'lib\sdlc-core.mjs')
Copy-Item -LiteralPath (Join-Path $runtime 'lib\startup-health.mjs') -Destination (Join-Path $Destination 'lib\startup-health.mjs')
Copy-Item -LiteralPath (Join-Path $runtime 'lib\memory-settings.mjs') -Destination (Join-Path $Destination 'lib\memory-settings.mjs')
Copy-Item -LiteralPath (Join-Path $config 'AGENTS.md') -Destination (Join-Path $Destination 'AGENTS.md')
foreach ($file in Get-ChildItem -LiteralPath (Join-Path $config 'agents') -Filter '*.md') {
    Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $Destination ('agents\' + $file.Name))
}
foreach ($skill in @('crg-navigation','chrome-devtools')) {
    $target = Join-Path $Destination ('skills\' + $skill)
    New-Item -ItemType Directory -Path $target -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $config ('skills\' + $skill + '\SKILL.md')) -Destination (Join-Path $target 'SKILL.md')
}
Write-Output 'Installed SDLC runtime and approved agent instructions. Restart OpenCode to load them. Provider credentials were not modified.'
