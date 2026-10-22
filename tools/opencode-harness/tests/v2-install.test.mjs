import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('native V2 setup upgrades V1, verifies downloads and rejects PATH shadowing', { skip: process.platform !== 'win32' }, () => {
  const root = mkdtempSync(path.join(tmpdir(), 'harness-v2-install-'));
  try {
    const script = path.join(root, 'test.ps1');
    writeFileSync(script, String.raw`
. $env:TEST_SETUP_SCRIPT
$env:USERPROFILE = Join-Path $env:TEST_ROOT $env:TEST_SCENARIO
$env:PROCESSOR_ARCHITECTURE = 'AMD64'
$env:PROCESSOR_ARCHITEW6432 = ''
$script:userPath = 'C:\old-npm;C:\personal-tools'
$script:downloads = 0
$script:version = if ($env:TEST_SCENARIO -eq 'current') { 'opencode v2.1.2' } else { '1.19.3' }
$exe = Join-Path $env:USERPROFILE '.opencode\bin\opencode.exe'
if ($env:TEST_SCENARIO -in @('current','legacy')) {
  New-Item -ItemType Directory -Force (Split-Path $exe) | Out-Null
  Set-Content -LiteralPath $exe 'fixture old binary'
}
function Get-SetupEnvironmentPath([string]$Scope) { if ($Scope -eq 'User') { $script:userPath } else { 'C:\Windows\system32' } }
function Set-SetupUserPath([string]$Value) { $script:userPath = $Value }
function Get-Command { [CmdletBinding()] param([string]$Name); [pscustomobject]@{ Source = $(if ($env:TEST_SCENARIO -eq 'shadow') { 'old-v1.cmd' } else { $exe }) } }
function Invoke-RestMethod {
  param($Uri)
  if ($Uri -notmatch '@opencode%2fcli-windows-x64-baseline/2.1.2$') { throw 'Wrong artifact' }
  $sha = [Security.Cryptography.SHA512]::Create()
  try { $integrity = 'sha512-' + [Convert]::ToBase64String($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes('fixture download'))) } finally { $sha.Dispose() }
  [pscustomobject]@{ dist = [pscustomobject]@{ integrity = $integrity } }
}
function Invoke-WebRequest {
  param([switch]$UseBasicParsing, $Uri, $OutFile)
  $script:downloads++
  [IO.File]::WriteAllText($OutFile, $(if ($env:TEST_SCENARIO -eq 'tampered') { 'bad download' } else { 'fixture download' }))
}
function Invoke-SetupNative([string]$Command, [string[]]$Arguments) {
  if ($Command -eq 'tar.exe') {
    $target = Join-Path $Arguments[3] 'package\bin\opencode.exe'
    New-Item -ItemType Directory -Force (Split-Path $target) | Out-Null
    Set-Content -LiteralPath $target 'fixture v2 binary'
    return
  }
  if ($Command -eq 'old-v1.cmd') { return '1.19.3' }
  if ($Command -eq $exe -and (Get-Content -LiteralPath $exe -Raw) -notmatch 'fixture v2 binary') { return $script:version }
  return 'opencode v2.1.2'
}
$failed = $false; $message = ''
try {
  Install-SetupOpenCode | Out-Null
  $script:version = 'opencode v2.1.2'
  Install-SetupOpenCode | Out-Null
} catch { $failed = $true; $message = $_.Exception.Message }
@{ failed = $failed; message = $message; downloads = $script:downloads; userPath = $script:userPath; exists = (Test-Path -LiteralPath $exe) } | ConvertTo-Json | Set-Content -LiteralPath $env:TEST_RESULT
`);
    for (const scenario of ['fresh', 'legacy', 'current', 'tampered', 'shadow']) {
      const result = path.join(root, scenario + '.json');
      execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], {
        env: { ...process.env, TEST_ROOT: root, TEST_SCENARIO: scenario, TEST_RESULT: result, TEST_SETUP_SCRIPT: fileURLToPath(new URL('../setup.ps1', import.meta.url)) },
        windowsHide: true, stdio: 'pipe', timeout: 20000,
      });
      const report = JSON.parse(readFileSync(result, 'utf8').replace(/^\uFEFF/, ''));
      assert.equal(report.failed, ['tampered', 'shadow'].includes(scenario), JSON.stringify(report));
      assert.equal(report.downloads, scenario === 'current' ? 0 : 1, scenario);
      if (scenario === 'tampered') {
        assert.match(report.message, /integrity mismatch/);
        assert.equal(report.exists, false);
        assert.equal(report.userPath, 'C:\\old-npm;C:\\personal-tools');
      } else {
        const bin = path.join(root, scenario, '.opencode/bin');
        assert.equal(report.userPath, `${bin};C:\\old-npm;C:\\personal-tools`);
        assert.equal(report.exists, true);
        if (scenario === 'shadow') assert.match(report.message, /shadows V2/);
      }
    }
  } finally {
    assert.equal(path.dirname(root), tmpdir());
    rmSync(root, { recursive: true, force: true });
  }
});
