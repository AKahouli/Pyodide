---
tool: sandbox_create
category: lifecycle
summary: Boot a Firecracker microVM sandbox for the current session (idempotent).
signature: "sandbox_create(ctx: Context) -> str"
parameters: []
injected: ctx (FastMCP Context — not part of the input schema)
uses_headers:
  - x-user-id
  - x-conversation-id
  - x-workspace-paths
returns: Sandbox running info — user, ID, IP, VNC URL, CDP URL, created timestamp.
mutates: true
idempotent: true
requires_sandbox: false
source: sandbox_mcp/server.py
tags:
  - mcp-tool
  - lifecycle
---

# `sandbox_create`

Boot a Firecracker microVM sandbox for this session.

```python
async def sandbox_create(ctx: Context) -> str
```

## Parameters

This tool exposes **no input parameters**. The only argument, `ctx: Context`, is
dependency-injected by FastMCP and excluded from the tool schema — see
[[Request context and headers]]. The sandbox is identified entirely from the request
headers `x-user-id`, `x-conversation-id`, and `x-workspace-paths`.

## Behavior

- **Idempotent** — if a sandbox is already running for this scope/lane, probe validates the
  cache and returns info without booting a second VM.
- Internally calls `SandboxRuntime.acquire(manager)` then `manager.info()`.
- Mount inventory is best-effort via `get_inventory_preview()` (never fails the tool).
- The sandbox stays alive until [[sandbox_destroy]], TTL eviction, or server shutdown.
- Workspaces named in `x-workspace-paths` are mounted under `/mnt/workspace/`.

## Returns

Plain text, e.g.:

```
Sandbox is running.
  User:    <user_id>
  ID:      <sandbox_id>
  IP:      <ip>
  VNC:     <vnc_url>
  CDP:     <cdp_url>
  Created: <created_at>
  Inputs workspace_paths: [...]
  Inputs filename_paths (N): [...]
--- mounted FS preview ---
...
```

## Errors

On acquisition failure, returns a structured message (does not raise):

```
Sandbox acquire failed (retryable=true, code=LEASE_GONE, attempts=3).
Hint: Retry sandbox_create.
Detail: ...
```

Other tools using `_with_sandbox()` raise `RuntimeError` with the same formatted message.

## Related

[[sandbox_info]] · [[sandbox_destroy]] · [[shell_exec]] · [[Request context and headers]] ·
[[Sandbox routing and lifecycle]]
