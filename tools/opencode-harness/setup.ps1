param(
    [string]$RepoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..')),
    [ValidateSet('Y','N')][string]$InstallHindsight,
    [ValidatePattern('^[A-Za-z0-9._-]+$')][string]$WslDistribution = 'Ubuntu-22.04'
)

$ErrorActionPreference = 'Stop'

function Invoke-SetupNative([string]$Command, [string[]]$Arguments) {
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Command failed (exit $LASTEXITCODE)." }
}
function Update-SetupPath {
    $setupPaths = ($env:PATH + ';' + [Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
        [Environment]::GetEnvironmentVariable('Path','User')).Split(';', [StringSplitOptions]::RemoveEmptyEntries)
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
function Enable-SetupBackground {
    $env:OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS = '1'
    [Environment]::SetEnvironmentVariable('OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS','1','User')
}
function Backup-SetupSettings([string]$ConfigDirectory, [string]$BackupDirectory) {
    $memoryFile = if ($env:HINDSIGHT_CONFIG) { $env:HINDSIGHT_CONFIG } else { Join-Path $env:USERPROFILE '.hindsight\coding-agent.json' }
    foreach ($existing in @((Join-Path $ConfigDirectory 'opencode.json'), (Join-Path $ConfigDirectory 'opencode.jsonc'), $memoryFile)) {
        if (Test-Path -LiteralPath $existing -PathType Leaf) {
            New-Item -ItemType Directory -Path $BackupDirectory -Force | Out-Null
            Copy-Item -LiteralPath $existing -Destination (Join-Path $BackupDirectory ([IO.Path]::GetFileName($existing)))
        }
    }
}
function Start-SetupGraphWatcher {
    $graphState = Invoke-SetupNative uvx.exe @('--from','code-review-graph==2.3.9','code-review-graph','daemon','status')
    if (($graphState -join [Environment]::NewLine) -match '(?m)^Daemon:\s+running\b') { return }
    if (($graphState -join [Environment]::NewLine) -notmatch '(?m)^Daemon:\s+not running\s*$') { throw 'Unknown graph watcher state; inspect daemon status before starting another.' }
    $uvxExecutable = (Get-Command uvx.exe).Source
    $watcher = Start-Process -FilePath $uvxExecutable -WindowStyle Hidden -PassThru -ArgumentList @('--from','code-review-graph==2.3.9','code-review-graph','daemon','start','--foreground')
    for ($attempt = 0; $attempt -lt 3; $attempt++) {
        Start-Sleep -Milliseconds 500
        $ready = Invoke-SetupNative uvx.exe @('--from','code-review-graph==2.3.9','code-review-graph','daemon','status')
        if (($ready -join [Environment]::NewLine) -match '(?m)^Daemon:\s+running\b') { return }
        if ($watcher.HasExited) { break }
    }
    throw 'Graph watcher did not report readiness. Inspect daemon status before retrying; no existing process was stopped.'
}
function Install-SetupWslMemory([string]$Distribution) {
    $distributions = (& wsl.exe --list --quiet) -join [Environment]::NewLine
    if ($LASTEXITCODE -ne 0 -or $distributions.Replace([string][char]0,'') -notmatch ("(?m)^" + [regex]::Escape($Distribution) + "\s*$")) {
        Invoke-SetupNative wsl.exe @('--install','-d',$Distribution,'--no-launch') | Out-Host
        throw "Complete $Distribution first-run initialization (and Windows restart if requested), then rerun Hindsight Y."
    }
    # Fixed script, no interpolated user paths/secrets. Reuse an existing provider profile.
    $wslSetup = @'
set -eu
if [ "$(id -u)" = 0 ]; then echo "Finish Ubuntu setup with a normal Linux user."; exit 1; fi
if [ ! -x "$HOME/.local/bin/uvx" ]; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
fi
if [ ! -f "$HOME/.hindsight/profiles/coding-agent.env" ]; then
  "$HOME/.local/bin/uvx" --from hindsight-embed==0.10.3 hindsight-embed configure -p coding-agent --port 9077
fi
"$HOME/.local/bin/uvx" --from hindsight-embed==0.10.3 hindsight-embed -p coding-agent daemon start
'@
    # A file avoids Windows PowerShell's native embedded-quote conversion while
    # leaving stdin available for the masked interactive provider wizard.
    $temporaryScript = [IO.Path]::GetTempFileName()
    try {
        [IO.File]::WriteAllText($temporaryScript, $wslSetup.Replace([string][char]13,''), [Text.UTF8Encoding]::new($false))
        $linuxScript = (Invoke-SetupNative wsl.exe @('-d',$Distribution,'-e','wslpath','-a','-u',$temporaryScript) -join '').Trim()
        Invoke-SetupNative wsl.exe @('-d',$Distribution,'-e','bash',$linuxScript) | Out-Host
    } finally { Remove-Item -LiteralPath $temporaryScript -Force }
}
function Start-HarnessSetup([string]$Root, [string]$MemoryChoice, [string]$Distribution = 'Ubuntu-22.04') {
    $setupIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $setupMutex = [Threading.Mutex]::new($false, ('Global\OpenCodeSDLCSetup-' + $setupIdentity))
    $ownsMutex = $false
    try {
        try { $ownsMutex = $setupMutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $ownsMutex = $true }
        if (-not $ownsMutex) { throw 'Another harness installer is running for this Windows user. Retry when it finishes.' }
        if (-not $MemoryChoice) {
            do { $MemoryChoice = (Read-Host 'Install Hindsight local experience memory? (Y/N)').Trim().ToUpperInvariant() } while ($MemoryChoice -notin @('Y','N'))
        }
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
        Invoke-SetupNative npm.cmd @('install','--prefix',$configDirectory,'--save-exact','@opencode-ai/plugin@1.1.42','jsonc-parser@3.3.1') | Out-Host
        if (-not (Get-Command opencode.cmd -ErrorAction SilentlyContinue) -and -not (Get-Command opencode.exe -ErrorAction SilentlyContinue)) {
            Invoke-SetupNative npm.cmd @('install','-g','opencode-ai@1.18.34') | Out-Host
            Update-SetupPath
        }
        $configHelper = Join-Path $PSScriptRoot 'setup-config.mjs'
        Invoke-SetupNative node.exe @($configHelper,'opencode',$configDirectory,$Root,$setupBackup) | Out-Host
        & (Join-Path $PSScriptRoot 'install.ps1') -Destination $configDirectory | Out-Host
        Enable-SetupBackground
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
            if (-not (Test-Path -LiteralPath (Join-Path $Root '.code-review-graph\graph.db'))) {
                Invoke-SetupNative uvx.exe @('--from','code-review-graph==2.3.9','code-review-graph','build','--repo',$Root) | Out-Host
            }
            Invoke-SetupNative uvx.exe @('--from','code-review-graph==2.3.9','code-review-graph','daemon','add',$Root) | Out-Host
            Start-SetupGraphWatcher
        } catch { $pending += 'Graph setup needs attention; inspect index/watcher status in DEVELOPER-SETUP.md.' }
        if ($MemoryChoice -eq 'Y') {
            try {
                Invoke-SetupNative node.exe @($configHelper,'memory',$configDirectory,$Root,$setupBackup) | Out-Host
                # Omitting --server preserves the prepared/existing endpoint and credentials.
                Invoke-SetupNative npx.cmd @('-y','@vectorize-io/hindsight-coding-agents@0.8.1','install','opencode') | Out-Host
                Invoke-SetupNative node.exe @($configHelper,'memory-registration',$configDirectory,$Root,$setupBackup) | Out-Host
                $memoryState = Invoke-SetupNative node.exe @($configHelper,'memory-info',$configDirectory,$Root,$setupBackup) | ConvertFrom-Json
                if (-not $memoryState.reachable -and $memoryState.localBootstrap) { Install-SetupWslMemory $Distribution }
                Invoke-SetupNative node.exe @($configHelper,'memory-check',$configDirectory,$Root,$setupBackup) | Out-Host
            } catch {
                $pending += 'Hindsight setup is pending. Finish WSL initialization/provider configuration or inspect HINDSIGHT-SETUP.md, then rerun Y.'
                Write-Warning 'Hindsight setup did not finish. Existing credentials were not printed. Coding can continue with Git docs/checkpoints.'
            }
        } else { Write-Host 'Hindsight skipped. Existing memory settings/installations are untouched; an unconfigured memory warning is advisory.' }
        Write-Host "Next: fully restart OpenCode from $Root, /connect your provider, select accessible models and run Verify onboarding."
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
    try { exit (Start-HarnessSetup $RepoRoot $InstallHindsight $WslDistribution) }
    catch { Write-Host ("Setup failed: " + $_.Exception.Message) -ForegroundColor Red; exit 1 }
}
