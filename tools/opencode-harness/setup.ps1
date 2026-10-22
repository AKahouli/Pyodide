param(
    [string]$RepoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
)

$ErrorActionPreference = 'Stop'
$script:OpenCodeVersion = '2.1.2'

function Invoke-SetupNative([string]$Command, [string[]]$Arguments) {
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Command failed (exit $LASTEXITCODE)." }
}
function Get-SetupEnvironmentPath([string]$Scope) { [Environment]::GetEnvironmentVariable('Path',$Scope) }
function Set-SetupUserPath([string]$Value) { [Environment]::SetEnvironmentVariable('Path',$Value,'User') }
function Update-SetupPath {
    $setupPaths = ($env:PATH + ';' + (Get-SetupEnvironmentPath Machine) + ';' +
        (Get-SetupEnvironmentPath User)).Split(';', [StringSplitOptions]::RemoveEmptyEntries)
    $env:PATH = ($setupPaths | Select-Object -Unique) -join ';'
}
function Install-SetupPrerequisite([string]$Command, [string]$Package) {
    Update-SetupPath
    if (Get-Command $Command -ErrorAction SilentlyContinue) { return }
    if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
        throw "Missing $Command and WinGet. Follow docs/DEVELOPER-SETUP.md, then rerun."
    }
    try {
        Invoke-SetupNative winget.exe @('install','--id',$Package,'--exact','--source','winget','--accept-package-agreements','--accept-source-agreements') | Out-Host
    } catch {
        Update-SetupPath
        if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) { throw }
        return
    }
    Update-SetupPath
    if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) { throw "$Command is not on PATH yet. Open a new terminal and rerun." }
}
function Get-SetupConfigDirectory { Join-Path $env:USERPROFILE '.config\opencode' }
function Show-SetupHostWarning {
    $hosts = @(Get-Process -Name opencode -ErrorAction SilentlyContinue)
    if ($hosts.Count) {
        $hostIds = ($hosts | Select-Object -ExpandProperty Id | Sort-Object) -join ', '
        Write-Warning "OpenCode processes detected (PIDs: $hostIds). Setup will continue without stopping them. Finish/checkpoint active work and fully exit/restart OpenCode after setup to load the updated harness. If installation reports a file in use, exit these hosts and rerun."
    }
}
function Install-SetupOpenCode {
    # Use the native Windows artifact, never bash/WSL or the V1 npm package.
    $bin = Join-Path $env:USERPROFILE '.opencode\bin'
    $exe = Join-Path $bin 'opencode.exe'
    $expected = 'opencode v' + $script:OpenCodeVersion
    $installed = if (Test-Path -LiteralPath $exe) { (Invoke-SetupNative $exe @('--version') -join '').Trim() } else { '' }
    if ($installed -ne $expected) {
        $arch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
        $target = switch ($arch) {
            'ARM64' { 'windows-arm64' }
            # The baseline works on x64 CPUs with and without AVX2.
            'AMD64' { 'windows-x64-baseline' }
            default { throw "Unsupported Windows CPU architecture: $arch" }
        }
        $temporary = Join-Path ([IO.Path]::GetTempPath()) ('opencode-harness-' + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $temporary | Out-Null
        try {
            $metadata = Invoke-RestMethod -Uri ("https://registry.npmjs.org/@opencode%2fcli-$target/" + $script:OpenCodeVersion)
            $archive = Join-Path $temporary 'cli.tgz'
            $artifact = "https://registry.npmjs.org/@opencode/cli-$target/-/cli-$target-$($script:OpenCodeVersion).tgz"
            Invoke-WebRequest -UseBasicParsing -Uri $artifact -OutFile $archive
            $sha = [Security.Cryptography.SHA512]::Create()
            try { $integrity = 'sha512-' + [Convert]::ToBase64String($sha.ComputeHash([IO.File]::ReadAllBytes($archive))) }
            finally { $sha.Dispose() }
            if ($integrity -ne $metadata.dist.integrity) { throw 'OpenCode download integrity mismatch; installation stopped.' }
            Invoke-SetupNative tar.exe @('-xzf',$archive,'-C',$temporary,'package/bin/opencode.exe') | Out-Host
            $download = Join-Path $temporary 'package\bin\opencode.exe'
            if ((Invoke-SetupNative $download @('--version') -join '').Trim() -ne $expected) { throw 'Unexpected OpenCode binary version.' }
            New-Item -ItemType Directory -Path $bin -Force | Out-Null
            Copy-Item -LiteralPath $download -Destination $exe -Force
        } finally {
            # Only this invocation's freshly created, absolute temporary directory.
            if ([IO.Path]::GetDirectoryName($temporary).TrimEnd('\') -ne [IO.Path]::GetTempPath().TrimEnd('\')) { throw 'Unsafe temporary cleanup path.' }
            Remove-Item -LiteralPath $temporary -Recurse -Force
        }
    }
    $userPath = Get-SetupEnvironmentPath User
    $otherPaths = @($userPath -split ';' | Where-Object { $_ -and $_.TrimEnd('\') -ne $bin.TrimEnd('\') })
    Set-SetupUserPath ((@($bin) + $otherPaths) -join ';')
    $env:PATH = $bin + ';' + $env:PATH
    # A machine-wide V1 command can still precede User PATH in a new terminal.
    $currentPath = $env:PATH
    try {
        $env:PATH = (Get-SetupEnvironmentPath Machine) + ';' + (Get-SetupEnvironmentPath User)
        $resolved = Get-Command opencode -ErrorAction Stop
        if ((Invoke-SetupNative $resolved.Source @('--version') -join '').Trim() -ne $expected) {
            throw 'A machine-wide OpenCode installation shadows V2. Remove that older installation from Machine PATH and rerun setup.'
        }
    } finally { $env:PATH = $currentPath }
    Write-Host "Native Windows $expected ready at $exe. Open a new terminal after setup."
}
function Backup-SetupSettings([string]$ConfigDirectory, [string]$BackupDirectory) {
    foreach ($existing in @((Join-Path $ConfigDirectory 'opencode.json'), (Join-Path $ConfigDirectory 'opencode.jsonc'))) {
        if (Test-Path -LiteralPath $existing -PathType Leaf) {
            New-Item -ItemType Directory -Path $BackupDirectory -Force | Out-Null
            Copy-Item -LiteralPath $existing -Destination (Join-Path $BackupDirectory ([IO.Path]::GetFileName($existing)))
        }
    }
}
# Graphify must be a persistent tool install: the git hooks re-run `graphify`
# after commits/checkouts, which an ephemeral uvx cache cannot guarantee.
function Install-SetupGraphify([string]$Root) {
    Update-SetupPath
    if (-not (Get-Command graphify.exe -ErrorAction SilentlyContinue)) {
        Invoke-SetupNative uv.exe @('tool','install','graphifyy')
        Update-SetupPath
    }
    $graphify = Get-Command graphify.exe -ErrorAction SilentlyContinue
    if (-not $graphify) { throw 'graphify is not on PATH yet. Open a new terminal and rerun.' }
    if (-not (Test-Path -LiteralPath (Join-Path $Root 'graphify-out\graph.json'))) {
        # Code-only extraction is local AST parsing: no API key, nothing leaves the machine.
        Invoke-SetupNative $graphify.Source @('extract',$Root,'--code-only','--no-viz') | Out-Host
    }
    Invoke-SetupNative $graphify.Source @('hook','install') | Out-Host
    $hookState = (Invoke-SetupNative $graphify.Source @('hook','status')) -join [Environment]::NewLine
    if (($hookState -split [Environment]::NewLine | Where-Object { $_ -match '^post-(commit|checkout|merge|rewrite):' }) -notmatch ': installed$') {
        throw 'Graphify hooks did not report installed state; inspect graphify hook status before retrying.'
    }
}
function Start-HarnessSetup([string]$Root) {
    $setupIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $setupMutex = [Threading.Mutex]::new($false, ('Global\OpenCodeSDLCSetup-' + $setupIdentity))
    $ownsMutex = $false
    try {
        try { $ownsMutex = $setupMutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $ownsMutex = $true }
        if (-not $ownsMutex) { throw 'Another harness installer is running for this Windows user. Retry when it finishes.' }
        Show-SetupHostWarning
        Install-SetupPrerequisite git.exe Git.Git
        Install-SetupPrerequisite node.exe OpenJS.NodeJS.LTS
        Install-SetupPrerequisite uvx.exe astral-sh.uv
        $nodeVersion = (Invoke-SetupNative node.exe @('--version') -join '').TrimStart('v')
        if ([int]($nodeVersion.Split('.')[0]) -lt 24) { throw 'Node 24+ is required. Upgrade Node, open a new terminal and rerun.' }
        $Root = [IO.Path]::GetFullPath($Root)
        if (-not (Test-Path -LiteralPath (Join-Path $Root 'tools\opencode-harness\policy.json'))) {
            $Root = [IO.Path]::GetFullPath((Read-Host 'Application Git checkout containing tools/opencode-harness/policy.json'))
        }
        $gitRoot = (Invoke-SetupNative git.exe @('-C',$Root,'rev-parse','--show-toplevel') -join '').Trim()
        if ([IO.Path]::GetFullPath($gitRoot) -ne $Root) { throw 'Choose the Git checkout root, not a nested package.' }
        Invoke-SetupNative git.exe @('-C',$Root,'rev-parse','--verify','HEAD') | Out-Null
        $policy = Get-Content -LiteralPath (Join-Path $Root 'tools\opencode-harness\policy.json') -Raw | ConvertFrom-Json
        $requiredDocs = @($policy.documentationIndex) + @($policy.documentationRoutes | ForEach-Object { $_.document })
        foreach ($requiredDoc in $requiredDocs) {
            if (-not (Test-Path -LiteralPath (Join-Path $Root $requiredDoc) -PathType Leaf)) { throw "Missing routed document: $requiredDoc" }
        }
        $configDirectory = Get-SetupConfigDirectory
        New-Item -ItemType Directory -Path $configDirectory -Force | Out-Null
        $setupBackup = Join-Path $configDirectory ('.sdlc-backups\setup-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8))
        Backup-SetupSettings $configDirectory $setupBackup
        Install-SetupOpenCode
        Invoke-SetupNative npm.cmd @('install','--prefix',$configDirectory,'--save-exact',('@opencode/plugin@' + $script:OpenCodeVersion),'jsonc-parser@3.3.1') | Out-Host
        $configHelper = Join-Path $PSScriptRoot 'setup-config.mjs'
        Invoke-SetupNative node.exe @($configHelper,'opencode',$configDirectory,$Root,$setupBackup) | Out-Host
        & (Join-Path $PSScriptRoot 'install.ps1') -Destination $configDirectory | Out-Host
        Write-Host "Harness installed. Configuration backups: $setupBackup"
        $pending = @()
        try {
            $chromeCandidates = @(
                (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe'),
                (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe')
            )
            $chromeX86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
            if ($chromeX86) { $chromeCandidates += Join-Path $chromeX86 'Google\Chrome\Application\chrome.exe' }
            if (-not ($chromeCandidates | Where-Object { Test-Path -LiteralPath $_ })) {
                Invoke-SetupNative winget.exe @('install','--id','Google.Chrome','--exact','--source','winget','--accept-package-agreements','--accept-source-agreements') | Out-Host
            }
        } catch { $pending += 'Chrome setup needs attention; install Chrome before browser QA.' }
        try {
            Install-SetupPrerequisite uv.exe astral-sh.uv
            Install-SetupGraphify $Root
        } catch { $pending += 'Graphify setup needs attention; inspect graphify tool/hook status in DEVELOPER-SETUP.md.' }
        Write-Host "Next: open a new terminal, check opencode --version (v$script:OpenCodeVersion), then start opencode from $Root, /connect your provider and run Verify onboarding."
        Write-Host 'Desktop is a separate installation: install/upgrade the V2 Desktop app before using it with this harness.'
        Write-Host 'Documentation: tools/opencode-harness/docs/DEVELOPER-SETUP.md'
        foreach ($item in $pending) { Write-Warning $item }
        if ($pending.Count) { return 2 }
        return 0
    } finally {
        if ($ownsMutex) { $setupMutex.ReleaseMutex() }
        $setupMutex.Dispose()
    }
}
# Dot-source for isolated tests; ordinary launch runs setup.
if ($MyInvocation.InvocationName -ne '.') {
    try { exit (Start-HarnessSetup $RepoRoot) }
    catch { Write-Host ("Setup failed: " + $_.Exception.Message) -ForegroundColor Red; exit 1 }
}
