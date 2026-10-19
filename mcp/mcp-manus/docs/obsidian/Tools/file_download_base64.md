---
tool: file_download_base64
category: file
summary: Download a file from the sandbox as a base64-encoded string.
signature: "file_download_base64(path: str, ctx: Context) -> str"
parameters:
  - "path (str, required) — absolute path to the file inside the sandbox"
injected: ctx (FastMCP Context — not part of the input schema)
uses_headers:
  - x-user-id
  - x-conversation-id
returns: Base64-encoded file content, or an error message.
mutates: false
idempotent: true
requires_sandbox: true
source: sandbox_mcp/server.py:357
tags:
  - mcp-tool
  - file
---

# `file_download_base64`

Download a file from the sandbox as a base64-encoded string.

```python
async def file_download_base64(path: str, ctx: Context) -> str
```

## Parameters

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `path` | `str` | _required_ | Absolute path to the file inside the sandbox. |

`ctx: Context` is injected by FastMCP — see [[Request context and headers]].

## Behavior

- Boots the sandbox on demand via `manager.get_or_create()`.
- Calls `sandbox.file_download(path)`, then base64-encodes the raw bytes.

## Returns

The base64-encoded file content as a string, or:

- `Error: file not found: <path>` when the file does not exist, or
- `Error downloading <path>: <message>` for any other failure.

## Related

[[file_upload_base64]] · [[file_read]] · [[Request context and headers]]
