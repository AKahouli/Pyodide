---
tool: send_file_to_user
category: file
summary: Make a sandbox file visible and downloadable to the user.
signature: "send_file_to_user(path: str, ctx: Context) -> str"
parameters:
  - "path (str, required) — absolute path to the file inside the sandbox"
injected: ctx (FastMCP Context — not part of the input schema)
uses_headers:
  - x-user-id
  - x-conversation-id
returns: JSON with path and ceph_path.
mutates: false
idempotent: true
requires_sandbox: true
source: sandbox_mcp/server.py:312
tags:
  - mcp-tool
  - file
  - delivery
---

# `send_file_to_user`

Send a file to the user so they can see and download it.

```python
async def send_file_to_user(path: str, ctx: Context) -> str
```

> [!important]
> This is the **only** way the user can access a file. Without this call, the file exists
> in the sandbox but is completely invisible to the user. Call **once per file** — for
> multiple files, call once for each.

## Parameters

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `path` | `str` | _required_ | Absolute path inside the sandbox (e.g. `/home/ubuntu/report.pdf`). |

`ctx: Context` is injected by FastMCP — see [[Request context and headers]].

## Behavior

- Does **not** touch the sandbox or move bytes — it only resolves the Ceph object path via
  `_ceph_info(path)` and returns it so the user/front-end can fetch the already-synced file.
- The Ceph mapping is `{user_id}/system_{conversation_id}/{relative_path}` (see
  [[Request context and headers]]).

## Returns

```json
{ "path": "<path>", "ceph_path": "<user>/system_<conv>/<rel>" }
```

## Related

[[shell_exec]] · [[file_write]] · [[file_upload_base64]] · [[Request context and headers]]
