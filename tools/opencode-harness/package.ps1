param([string]$OutputPath, [string]$Ref = 'HEAD')

$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$commit = (& git -C $repo rev-parse --verify "$Ref^{commit}").Trim()
if ($LASTEXITCODE -ne 0) { throw 'The package reference must resolve to a committed Git revision.' }
& git -C $repo cat-file -e ($commit + ':tools/opencode-harness/docs/DEVELOPER-SETUP.md')
if ($LASTEXITCODE -ne 0) { throw 'This revision has no developer distribution guide. Choose a packaged release revision.' }
if (-not $OutputPath) { $OutputPath = Join-Path $env:USERPROFILE ('Downloads\opencode-sdlc-harness-' + $commit.Substring(0,9) + '.zip') }
$output = [IO.Path]::GetFullPath($OutputPath)
if ((Test-Path -LiteralPath $output) -or (Test-Path -LiteralPath ($output + '.sha256'))) { throw 'Output already exists. Choose another OutputPath.' }
New-Item -ItemType Directory -Path (Split-Path $output -Parent) -Force | Out-Null

# Only approved Git files are exported. Never enumerate the user's live config,
# credentials, memory, browser state, node_modules or checkpoint databases.
$paths = @('tools/opencode-harness','AGENTS.md','docs/agent-context','YellowStorm/front/AGENTS.md','YellowStorm/back/AGENTS.md')
& git -C $repo archive --format=zip '--prefix=opencode-sdlc-harness/' "--output=$output" $commit -- $paths
if ($LASTEXITCODE -ne 0) { throw 'Git archive failed.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::Open($output, [IO.Compression.ZipArchiveMode]::Update)
try {
    $intro = $archive.CreateEntry('opencode-sdlc-harness/START-HERE.md')
    $introWriter = [IO.StreamWriter]::new($intro.Open(), [Text.UTF8Encoding]::new($false))
    try {
        $introWriter.WriteLine('# OpenCode SDLC harness')
        $introWriter.WriteLine('')
        $introWriter.WriteLine('Start with [Developer setup](tools/opencode-harness/docs/DEVELOPER-SETUP.md).')
        $introWriter.WriteLine('')
        $introWriter.WriteLine('This Windows release contains the harness and reviewed YellowStorm documentation profile. Use it with the application Git checkout. Each developer configures their own accounts and local services; runtime databases and credentials are excluded.')
        $introWriter.WriteLine('')
        $introWriter.WriteLine('Source commit: ' + $commit)
    } finally { $introWriter.Dispose() }
    $files = @()
    foreach ($entry in $archive.Entries) {
        if ($entry.FullName.EndsWith('/')) { continue }
        $stream = $entry.Open()
        $sha = [Security.Cryptography.SHA256]::Create()
        try { $hash = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','').ToLowerInvariant() }
        finally { $stream.Dispose(); $sha.Dispose() }
        $files += [ordered]@{ path = $entry.FullName; sha256 = $hash }
    }
    $manifest = [ordered]@{
        package = 'OpenCode SDLC harness'
        sourceCommit = $commit
        generatedAt = [DateTime]::UtcNow.ToString('o')
        startHere = 'tools/opencode-harness/docs/DEVELOPER-SETUP.md'
        files = $files
    }
    $entry = $archive.CreateEntry('opencode-sdlc-harness/PACKAGE-MANIFEST.json')
    $writer = [IO.StreamWriter]::new($entry.Open(), [Text.UTF8Encoding]::new($false))
    try { $writer.Write(($manifest | ConvertTo-Json -Depth 10)) } finally { $writer.Dispose() }
} finally { $archive.Dispose() }
$digest = (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText($output + '.sha256', $digest + '  ' + [IO.Path]::GetFileName($output) + [Environment]::NewLine)
Write-Output "Package: $output"
Write-Output "Source commit: $commit"
Write-Output "SHA256: $digest"
