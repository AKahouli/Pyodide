---
tool: sandbox_info
category: lifecycle
summary: Return current sandbox status and connection details (IP, VNC, CDP).
signature: "sandbox_info(ctx: Context) -> str"
parameters: []
injected: ctx (FastMCP Context — not part of the input schema)
uses_headers:
  - x-user-id
  - x-conversation-id
returns: Status, user, ID, IP, VNC URL, CDP URL, created timestamp — or a "not running" notice.
mutates: false
idempotent: true
requires_sandbox: false
source: sandbox_mcp/server.py:175
tags:
  - mcp-tool
  - lifecycle
---

# `sandbox_info`

Return current sandbox status and connection details.

```python
async def sandbox_info(ctx: Context) -> str
```

## Parameters

**No input parameters.** `ctx: Context` is injected by FastMCP (see
[[Request context and headers]]); the user/conversation are resolved from request headers.

## Behavior

- Does **not** boot a sandbox — only reports state via `manager.info()`.
- If `info["status"] == "not_running"`, returns a notice pointing the caller to
  [[sandbox_create]].

## Returns

Plain text:

```
Status:  <status>
User:    <user_id>
ID:      <sandbox_id>
IP:      <ip>
VNC:     <vnc_url>
CDP:     <cdp_url>
Created: <created_at>
```

or `No sandbox running for user <user_id>. Call sandbox_create() to boot one.`

## Related

[[sandbox_create]] · [[sandbox_destroy]] · [[Request context and headers]] ·
[[Sandbox routing and lifecycle]]
