---
tool: file_write
category: file
summary: Write content to a file inside the sandbox (creates parent dirs automatically).
signature: "file_write(path: str, content: str, ctx: Context, append: bool = False) -> str"
parameters:
  - "path (str, required) — absolute destination path"
  - "content (str, required) — text content to write"
  - "append (bool, default false) — append instead of overwrite"
injected: ctx (FastMCP Context — not part of the input schema)
uses_headers:
  - x-user-id
  - x-conversation-id
returns: JSON with status, path, and ceph_path.
mutates: true
idempotent: false
requires_sandbox: true
source: sandbox_mcp/server.py:246
tags:
  - mcp-tool
  - file
---

# `file_write`

Write content to a file inside the sandbox. Creates parent directories automatically.

```python
async def file_write(path: str, content: str, ctx: Context, append: bool = False) -> str
```

> [!tip]
> Always write output files to `/home/ubuntu/` or its subdirectories — never to `/tmp`.
> After writing, call [[send_file_to_user]] so the user can access the file.

## Parameters

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `path` | `str` | _required_ | Absolute path (e.g. `/home/ubuntu/output.txt`). |
| `content` | `str` | _required_ | Text content to write. |
| `append` | `bool` | `false` | Append to existing file instead of overwriting. |

`ctx: Context` is injected by FastMCP — see [[Request context and headers]].

## Behavior

- Boots the sandbox on demand via `manager.get_or_create()`.
- `.py` files are `compile()`d before write. Bare Excel A1 refs (`'Sheet'!B4`) are rejected with a fix hint (must be Python strings for openpyxl).
- Calls `sandbox.file_write(path, content, append=append)`.
- On success, derives the Ceph object path via `_ceph_info(path)` and includes it in the
  response (see [[Request context and headers]] for the mapping).

## Returns

```json
{ "status": "success", "path": "<path>", "ceph_path": "<user>/system_<conv>/<rel>" }
```

or `{ "status": "error", "message": "<message>", "path": "<path>" }`.

## Related

[[file_read]] · [[send_file_to_user]] · [[file_upload_base64]] · [[Request context and headers]]
