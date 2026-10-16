# Run storage contract

**Any MCP tool that downloads a file for an agent writes it to
`<user_id>/system_<run_id>` in the Ceph bucket. Nowhere else.**

This is the rule `download_mail_attachments` follows. A SharePoint, Drive, or any
other connector MCP that fetches files must follow the same one, or the file it
downloads is invisible to the code interpreter and the agent has no way to use it.

---

## The path

```
<user_id>/system_<run_id>/<filename>
```

| Part | Where it comes from | Never |
|------|--------------------|-------|
| `user_id` | the `x-user-id` request header | from a tool argument — a model could name someone else's folder |
| `run_id` | `x-conversation-id`, falling back to `x-execution-id` | invented, generated, or defaulted |
| `filename` | the source file's name | an absolute path or anything containing `/` |

**Resolve `run_id` in that exact order.** A conversational agent sends
`x-conversation-id`. A playbook run has no conversation and sends only
`x-execution-id` — the sandbox MCP falls back the same way, so a folder built with
the wrong precedence lands somewhere nothing mounts.

**If either id is missing, refuse the call.** Do not substitute a default, a
timestamp, or a uuid. A file in an unmountable folder is worse than an error: the
agent believes the download succeeded and the failure surfaces much later, as an
empty directory.

## Why this exact string

Three services independently build or consume this path. They only work together
because all three spell it the same way.

| Service | What it does with the path | Reference |
|---|---|---|
| Sandbox MCP (`Manus-Mcp`) | builds `{user_id}/system_{conversation_id}/{rel}` for every file the sandbox produces | `sandbox_mcp/server.py:289` |
| Sandbox MCP | resolves the run id, conversation first then execution | `sandbox_mcp/server.py:127-137`, `config.py:16-17` |
| ADK (`yellowstorm-adk`) | appends the run folder to `x-workspace-paths` so the sandbox mounts it | `src/run_workspace.py` |
| Sandbox manager | symlinks each mounted path to live Ceph | `app/sandbox_service.py:398-419` |

The mount is a **symlink into a hostPath-mounted Ceph directory**, not a copy:

```sh
ln -sfn /home/manus/ceph-workspaces/<user_id>/system_<run_id> /mnt/workspace/system_<run_id>
```

That is the whole point. Because it is live, a file written to Ceph **after** the
sandbox booted appears immediately inside it. Your download tool does not need to
run before the sandbox is created, and the sandbox never needs recreating. The
agent reads the file at:

```
/mnt/workspace/system_<run_id>/<filename>
```

Do **not** write to `/mnt/workspace/conversation_workspace/` instead. It looks
equivalent and is not: the manager `mkdir`s it and copies content in **at boot
only** (`app/sandbox_service.py:421-435`), so a later write is never picked up.

## Implementing it in a new MCP

### 1. Extract both ids in ASGI middleware

Read them from the request, not from tool arguments, and hold them in ContextVars.

```python
user_id = header(b"x-user-id")
# A playbook run sends an execution id and no conversation id.
conversation_id = header(b"x-conversation-id") or header(b"x-execution-id")
```

See `server.py:65-85` and `graph_helpers.py:28-36`.

### 2. Build the prefix in one place

One function, returning `""` when either half is missing, so no caller can
assemble a half-formed path by accident.

```python
def system_workspace_prefix() -> str:
    user_id, run_id = get_request_user_id(), get_request_conversation_id()
    if not user_id or not run_id:
        return ""
    return f"{user_id}/system_{run_id}"
```

See `graph_helpers.py:49-62`.

### 3. Refuse early in the tool

```python
folder = system_workspace_prefix()
if not folder:
    return json.dumps({"status": "error", "message":
        "cannot resolve this run's storage folder "
        "(missing X-user-id or x-conversation-id/x-execution-id on this request)"})
```

### 4. Write with `put_object`, return three things

Write to `CEPH_S3_BUCKET` (`graph_helpers.py:475`), and return per file:

| Field | Value | Why the agent needs it |
|---|---|---|
| `storage_key` | `<user_id>/system_<run_id>/<filename>` | `send_email` accepts it directly — the file can be re-sent without its bytes passing through the model |
| `sandbox_path` | `/mnt/workspace/system_<run_id>/<filename>` | the agent can hand it straight to `shell_exec` |
| `size` | byte count | lets the agent sanity-check before processing |

Returning `sandbox_path` matters more than it looks: without it the model has to
derive the mount path from the storage key, and it gets that wrong.

### 5. Register the action in the connector catalog

The ADK builds connector tools from `binding.actions` in the database, **not** from
a live `list_tools` on your server. Publishing the tool is not enough — re-inspect
the connector so the new action appears, then enable it on the binding. Until you
do, the tool exists and no agent can see it.

### 6. Type every optional parameter `Optional[...]`

```python
filenames: Optional[list[str]] = None   # not: filenames: list[str] = None
```

A param defaulting to `None` while typed non-optional produces a schema with no
`null` branch, and models send explicit `null` rather than omitting the argument.
The result is a pydantic validation error before your code runs. `test_attachments.py`
has a check that walks every tool's schema and catches this.

## Known gaps

Honest list, so the next implementer does not assume these are handled.

- **Filename collisions.** Two source files with the same name overwrite each
  other. No de-duplication or suffixing.
- **Filename sanitising.** A name containing `/` would escape the run folder.
  Untrusted names should be sanitised before use as a key.
- **S3 write vs POSIX read.** Tools write over the S3 API; the sandbox manager
  reads the POSIX path `/home/manus/ceph-workspaces/...`. These are treated as one
  namespace. Verify with `ls /home/manus/ceph-workspaces/<user_id>/system_<run_id>/`
  on the manager host on a first run — if the file is not there, nothing downstream
  will work and there is no point debugging further up.
- **No cleanup.** Nothing removes the run folder when the run ends.

## Checking it end to end

```
1. call the download tool          -> storage_key in the response
2. on the sandbox manager host     -> ls /home/manus/ceph-workspaces/<user_id>/system_<run_id>/
3. from the agent                  -> file_list("/mnt/workspace/")   must show system_<run_id>
4. from the agent                  -> shell_exec reads /mnt/workspace/system_<run_id>/<filename>
```

If step 3 comes back without the folder, the download is fine and the mount is
not: check that `x-workspace-paths` on the code-interpreter call ends with
`<user_id>/system_<run_id>` (the ADK adds it in `src/run_workspace.py`).
