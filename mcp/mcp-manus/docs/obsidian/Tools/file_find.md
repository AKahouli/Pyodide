---
tool: file_find
category: file
summary: Find files matching a name pattern inside the sandbox.
signature: "file_find(path: str, ctx: Context, pattern: str = '*') -> str"
parameters:
  - "path (str, required) — directory to search in"
  - "pattern (str, default *) — glob pattern to match filenames"
injected: ctx (FastMCP Context — not part of the input schema)
uses_headers:
  - x-user-id
  - x-conversation-id
returns: Newline-separated list of matching files, or a "no files" notice.
mutates: false
idempotent: true
requires_sandbox: true
source: sandbox_mcp/server.py:294
tags:
  - mcp-tool
  - file
---

# `file_find`

Find files matching a name pattern inside the sandbox.

```python
async def file_find(path: str, ctx: Context, pattern: str = "*") -> str
```

> [!note]
> Files provided by the user are mounted under `/mnt/workspace/<workspace>/` — search there
> (or `/mnt/workspace/`) to locate the user's input files.

## Parameters

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `path` | `str` | _required_ | Directory to search in (e.g. `/home/ubuntu` or `/mnt/workspace`). |
| `pattern` | `str` | `*` | Glob pattern to match filenames (e.g. `*.py`, `report*.pdf`). |

`ctx: Context` is injected by FastMCP — see [[Request context and headers]].

## Behavior

- Boots the sandbox on demand via `manager.get_or_create()`.
- Calls `sandbox.file_find(path, pattern)`; matches are recursive under `path`.

## Returns

Newline-separated matching paths, or `No files matching '<pattern>' found under <path>`,
or `Error searching <path>: <message>`.

## Related

[[file_list]] · [[file_read]] · [[Request context and headers]]
