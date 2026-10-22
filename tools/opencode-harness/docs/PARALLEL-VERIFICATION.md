# Optional two-process startup verification

**Historical V1 procedure.** The `live-startup.mjs` runner below uses the V1
server API and is not compatible with OpenCode V2. For the current model-free
V2 smoke check use `node tools/opencode-harness/tests/live-v2.mjs`; background
and two-process interaction need separate V2 verification.

Install/configure the harness and services using [the user guide](DEVELOPER-SETUP.md)
first. This checks real session identity/readiness; it does not send model prompts,
test application behavior or prove memory extraction.

Use available localhost ports 6193/6194. The shipped script assumes these ports
and no server password. Never reuse someone else's servers.

In a new PowerShell terminal A:

```powershell
$repoRoot = 'C:\work\YellowStorm-poc' # Your checkout.
Set-Location -LiteralPath $repoRoot
opencode serve --hostname 127.0.0.1 --port 6193
```

In a separate PowerShell terminal B:

```powershell
$repoRoot = 'C:\work\YellowStorm-poc' # The same checkout.
Set-Location -LiteralPath (Join-Path $repoRoot 'YellowStorm\front')
opencode serve --hostname 127.0.0.1 --port 6194
```

In a third PowerShell terminal:

```powershell
$repoRoot = 'C:\work\YellowStorm-poc'
Set-Location -LiteralPath $repoRoot
node tools/opencode-harness/tests/live-startup.mjs "$repoRoot"
```

Expect distinct process/session/probe identities, graph/checkpoint PASS
and `diagnosticModelToolCalls: 0`. Failed integrations need their specific recovery;
do not infer success from one other healthy session.
Stop only these owned test servers with Ctrl+C in their terminals.
For another application, choose a real nested package directory in terminal B.
