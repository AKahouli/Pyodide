---
tool: file_upload_base64
category: file
summary: Upload a file to the sandbox from a base64-encoded string.
signature: "file_upload_base64(path: str, content_base64: str, ctx: Context) -> str"
parameters:
  - "path (str, required) — absolute destination path"
  - "content_base64 (str, required) — base64-encoded binary content"
injected: ctx (FastMCP Context — not part of the input schema)
uses_headers:
  - x-user-id
  - x-conversation-id
returns: JSON with status, path, size, and ceph_path.
mutates: true
idempotent: false
requires_sandbox: true
source: sandbox_mcp/server.py:331
tags:
  - mcp-tool
  - file
---

# `file_upload_base64`

Upload a file to the sandbox by providing its content as a base64-encoded string.

```python
async def file_upload_base64(path: str, content_base64: str, ctx: Context) -> str
```

## Parameters

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `path` | `str` | _required_ | Absolute destination path inside the sandbox. |
| `content_base64` | `str` | _required_ | Base64-encoded binary content of the file. |

`ctx: Context` is injected by FastMCP — see [[Request context and headers]].

## Behavior

- Decodes `content_base64`; invalid base64 returns an error object (no write attempted).
- Boots the sandbox on demand via `manager.get_or_create()`.
- Streams the decoded bytes to `sandbox.file_upload(BytesIO(raw), path)`.
- On success, includes the decoded `size` and the Ceph path from `_ceph_info(path)`.

## Returns

```json
{ "status": "success", "path": "<path>", "size": <bytes>, "ceph_path": "<...>" }
```

or `{ "status": "error", "message": "Invalid base64 content: ...", "path": "<path>" }`.

## Related

[[file_download_base64]] · [[file_write]] · [[send_file_to_user]] · [[Request context and headers]]
