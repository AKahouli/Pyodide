---
tool: file_list
category: file
summary: List the contents of a directory inside the sandbox.
signature: "file_list(ctx: Context, path: str = '/home/ubuntu') -> str"
parameters:
  - "path (str, default /home/ubuntu) — directory to list"
injected: ctx (FastMCP Context — not part of the input schema)
uses_headers:
  - x-user-id
  - x-conversation-id
returns: Directory listing text, or an error message.
mutates: false
idempotent: true
requires_sandbox: true
source: sandbox_mcp/server.py:267
tags:
  - mcp-tool
  - file
---

# `file_list`

List the contents of a directory inside the sandbox.

```python
async def file_list(ctx: Context, path: str = "/home/ubuntu") -> str
```

> [!note]
> Files provided by the user are mounted under `/mnt/workspace/`, with one subfolder per
> workspace — list `/mnt/workspace/` to discover the user's input files.

## Parameters

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `path` | `str` | `/home/ubuntu` | Directory path to list. |

`ctx: Context` is injected by FastMCP — see [[Request context and headers]].

## Behavior

- Boots the sandbox on demand via `manager.get_or_create()`.
- Calls `sandbox.file_list(path)` and returns `result.data["listing"]`.

## Returns

The directory listing text (or `(empty)`), or `Error listing <path>: <message>`.

## Related

[[file_find]] · [[file_read]] · [[Request context and headers]]
