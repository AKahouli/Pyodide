---
type: concept
tags:
  - mcp-concept
  - routing
---

# Request context and headers

Every tool in this server takes a `ctx: Context` argument, but **`ctx` is not a tool
parameter**. FastMCP detects the `Context` type annotation and injects it at call time, so
it is excluded from the tool's input schema. From the MCP client's perspective these tools
expose only their *real* arguments (and several, like [[sandbox_create]], expose none).

## Why most lifecycle tools take no params

The information a tool needs to route to the right sandbox does not come from arguments — it
comes from **HTTP request headers**, read once per request by the ASGI middleware
(`RequestHeaderLogMiddleware`, `sandbox_mcp/server.py:28`) and stored in `ContextVar`s:

| Header | Setting | ContextVar | Meaning |
|--------|---------|-----------|---------|
| `x-user-id` | `sandbox_user_id_header` | `_current_user_id` | Identifies the calling user. |
| `x-conversation-id` | `sandbox_conversation_id_header` | `_current_conversation_id` | Identifies the conversation/session. |
| `x-workspace-paths` | `sandbox_workspace_paths_header` | `_current_workspace_paths` | Comma-separated workspace paths to mount under `/mnt/workspace/`. |

The header names are configurable in `sandbox_mcp/config.py:15-17`.

## How a tool resolves its sandbox

Inside each tool, `_get_manager(ctx)` (`sandbox_mcp/server.py:113`) reads those ContextVars
and returns the per-user / per-conversation manager:

```python
user_id = _current_user_id.get()
conversation_id = _current_conversation_id.get()
workspace_paths = _current_workspace_paths.get()
return multi.get_manager(user_id, conversation_id, workspace_paths=workspace_paths)
```

Because identity is taken from headers rather than tool arguments, a caller **cannot** spoof
another user's sandbox by passing a different `user_id` — there is no such argument to pass.

## Output paths and Ceph

Files written under `/home/ubuntu/` or `/mnt/workspace/conversation_workspace/` are mapped to
a Ceph object path of the form `{user_id}/system_{conversation_id}/{relative_path}` by
`_ceph_info(path)` (`sandbox_mcp/server.py:126`). That `ceph_path` is what file-producing
tools return so the user can locate the synced file.

## Related

[[MCP Server Tools]] · [[sandbox_create]] · [[send_file_to_user]]
