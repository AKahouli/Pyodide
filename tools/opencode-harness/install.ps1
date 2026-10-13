param([string]$Destination = (Join-Path $env:USERPROFILE '.config\opencode'))

$ErrorActionPreference = 'Stop'
$runtime = Join-Path $PSScriptRoot 'runtime'
$config = Join-Path $PSScriptRoot 'config'
if (-not (Test-Path -LiteralPath (Join-Path $Destination 'node_modules\@opencode-ai\plugin'))) {
    throw 'Install the OpenCode plugin SDK in the destination configuration directory first.'
}
$files = @{
    'plugins\sdlc.js' = Join-Path $runtime 'plugins\sdlc.js'
    'lib\sdlc-core.mjs' = Join-Path $runtime 'lib\sdlc-core.mjs'
    'lib\startup-health.mjs' = Join-Path $runtime 'lib\startup-health.mjs'
    'lib\memory-settings.mjs' = Join-Path $runtime 'lib\memory-settings.mjs'
    'AGENTS.md' = Join-Path $config 'AGENTS.md'
}
foreach ($file in Get-ChildItem -LiteralPath (Join-Path $config 'agents') -Filter '*.md') {
    $files['agents\' + $file.Name] = $file.FullName
}
foreach ($skill in @('crg-navigation','chrome-devtools','context7-mcp')) {
    $files['skills\' + $skill + '\SKILL.md'] = Join-Path $config ('skills\' + $skill + '\SKILL.md')
}
foreach ($source in $files.Values) {
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Incomplete harness package: missing $source" }
}
# Preserve only files this installer owns; provider/auth/config files are untouched.
$backup = Join-Path $Destination ('.sdlc-backups\' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8))
foreach ($relative in $files.Keys) {
    $existing = Join-Path $Destination $relative
    if (Test-Path -LiteralPath $existing -PathType Leaf) {
        $saved = Join-Path $backup $relative
        New-Item -ItemType Directory -Path (Split-Path $saved -Parent) -Force | Out-Null
        Copy-Item -LiteralPath $existing -Destination $saved
    }
}
foreach ($relative in $files.Keys) {
    $target = Join-Path $Destination $relative
    New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force | Out-Null
    Copy-Item -LiteralPath $files[$relative] -Destination $target
}
if (Test-Path -LiteralPath $backup) { Write-Output "Previous harness files backed up to $backup" }
Write-Output 'Installed SDLC runtime and approved agent instructions. Restart OpenCode to load them. Provider credentials were not modified.'
