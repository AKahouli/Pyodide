---
tool: file_read
category: file
summary: Read the full content of a file inside the sandbox.
signature: "file_read(path: str, ctx: Context) -> str"
parameters:
  - "path (str, required) — absolute path to the file"
injected: ctx (FastMCP Context — not part of the input schema)
uses_headers:
  - x-user-id
  - x-conversation-id
returns: File content as text, or an error message.
mutates: false
idempotent: true
requires_sandbox: true
source: sandbox_mcp/server.py:232
tags:
  - mcp-tool
  - file
---

# `file_read`

Read the full content of a file inside the sandbox.

```python
async def file_read(path: str, ctx: Context) -> str
```

> [!note]
> Files provided by the user are mounted under `/mnt/workspace/<workspace>/`.

## Parameters

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `path` | `str` | _required_ | Absolute path (e.g. `/home/ubuntu/script.py` or `/mnt/workspace/<workspace>/input.csv`). |

`ctx: Context` is injected by FastMCP — see [[Request context and headers]].

## Behavior

- Boots the sandbox on demand via `manager.get_or_create()`.
- Calls `sandbox.file_read(path)` and returns `result.data["content"]`.

## Returns

The file content as text, or `Error reading <path>: <message>` on failure.

## Related

[[file_list]] · [[file_find]] · [[file_write]] · [[file_download_base64]]
