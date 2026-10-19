---
tool: file_delete
category: file
summary: Delete a file or directory inside the sandbox (uses rm -rf).
signature: "file_delete(path: str, ctx: Context) -> str"
parameters:
  - "path (str, required) — absolute path to delete"
injected: ctx (FastMCP Context — not part of the input schema)
uses_headers:
  - x-user-id
  - x-conversation-id
returns: Confirmation message, or an error message.
mutates: true
idempotent: true
requires_sandbox: true
source: sandbox_mcp/server.py:281
tags:
  - mcp-tool
  - file
---

# `file_delete`

Delete a file or directory inside the sandbox (uses `rm -rf`).

```python
async def file_delete(path: str, ctx: Context) -> str
```

> [!warning]
> Destructive and recursive — there is no undo. Deletes whatever `path` points to.

## Parameters

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `path` | `str` | _required_ | Absolute path to delete. |

`ctx: Context` is injected by FastMCP — see [[Request context and headers]].

## Behavior

- Boots the sandbox on demand via `manager.get_or_create()`.
- Calls `sandbox.file_delete(path)` (`rm -rf` semantics).

## Returns

`Deleted <path>` on success, or `Error deleting <path>: <message>`.

## Related

[[file_list]] · [[file_find]] · [[Request context and headers]]
