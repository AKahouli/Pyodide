---
tool: sandbox_destroy
category: lifecycle
summary: Destroy the current sandbox and release the microVM resources.
signature: "sandbox_destroy(ctx: Context) -> str"
parameters: []
injected: ctx (FastMCP Context — not part of the input schema)
uses_headers:
  - x-user-id
  - x-conversation-id
returns: Confirmation message, or "No sandbox is running."
mutates: true
idempotent: true
requires_sandbox: true
source: sandbox_mcp/server.py:192
tags:
  - mcp-tool
  - lifecycle
---

# `sandbox_destroy`

Destroy the current sandbox and release the microVM resources.

```python
async def sandbox_destroy(ctx: Context) -> str
```

## Parameters

**No input parameters.** `ctx: Context` is injected by FastMCP (see
[[Request context and headers]]); the target sandbox is resolved from request headers.

## Behavior

- Checks `manager.is_alive`; if nothing is running it returns early without error.
- Otherwise calls `manager.destroy()` to tear down the microVM and free resources.
- Safe to call repeatedly — effectively idempotent.

## Returns

`Sandbox destroyed.` on success, or `No sandbox is running.` if there was nothing to do.

## Related

[[sandbox_create]] · [[sandbox_info]] · [[Request context and headers]] ·
[[Sandbox routing and lifecycle]]
