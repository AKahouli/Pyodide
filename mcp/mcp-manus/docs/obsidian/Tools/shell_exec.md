---
tool: shell_exec
category: shell
summary: Execute a shell command inside the sandbox microVM.
signature: "shell_exec(command: str, ctx: Context, exec_dir: str = '/home/ubuntu') -> str"
parameters:
  - "command (str, required) — shell command to run"
  - "exec_dir (str, default /home/ubuntu) — working directory"
injected: ctx (FastMCP Context — not part of the input schema)
uses_headers:
  - x-user-id
  - x-conversation-id
  - x-workspace-paths
returns: stdout, stderr, and exit code (if non-zero).
mutates: true
idempotent: false
requires_sandbox: true
source: sandbox_mcp/server.py:205
tags:
  - mcp-tool
  - shell
---

# `shell_exec`

Execute a shell command inside the sandbox microVM.

```python
async def shell_exec(command: str, ctx: Context, exec_dir: str = "/home/ubuntu") -> str
```

> [!important]
> After running any command that creates or generates files, you **must** call
> [[send_file_to_user]] with the full absolute path for each file created. That is the
> only way the user can see and download the file.

## Parameters

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `command` | `str` | _required_ | Shell command to run (e.g. `python3 script.py`, `pip install pandas`). |
| `exec_dir` | `str` | `/home/ubuntu` | Working directory for the command. |

`ctx: Context` is injected by FastMCP and is **not** a parameter — see
[[Request context and headers]].

## Behavior

- Boots the sandbox on demand via `manager.get_or_create()` (so a prior [[sandbox_create]]
  is not strictly required, though the `requires_sandbox` flag reflects that one will exist
  after this call).
- Runs the command through `sandbox.exec_command(exec_dir, command)`.
- Output is assembled by `_format_result(...)`: stdout, then stderr (prefixed `[stderr]`),
  then `[exit_code: N]` when the exit code is non-zero.

## Returns

Combined text:

```
<stdout>

[stderr]
<stderr>      # only if present

[exit_code: 1]  # only if non-zero
```

Returns `(no output)` when the command produced nothing.

## Related

[[sandbox_create]] · [[file_write]] · [[send_file_to_user]] · [[Request context and headers]]
