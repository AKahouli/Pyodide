# Manus Sandbox — MCP Server Tools

MCP server exposing a Firecracker microVM sandbox. Use `shell_exec` to run commands,
the `file_*` tools to manage files inside the VM, and `send_file_to_user` to deliver
results. Files provided by the user are mounted under `/mnt/workspace/<workspace>/`.

> [!info] Read this first
> Every tool takes a `ctx: Context` argument that is **injected by FastMCP and is not a tool
> parameter**. User/conversation/workspace identity comes from request headers, not
> arguments — which is why lifecycle tools like [[sandbox_create]] expose no inputs at all.
> Full explanation: [[Request context and headers]].

## Database

The database view lives in [[Tools.base]] — open it in Obsidian (v1.9+) to browse, sort,
group, and filter every tool. Each row is a note in the `Tools/` folder.

If you prefer the [Dataview](https://github.com/blacksmithgu/obsidian-dataview) plugin
instead of native Bases, this query renders the same table:

```dataview
TABLE category AS Category, requires_sandbox AS "Needs sandbox", mutates AS Mutates, summary AS Summary
FROM "Tools"
WHERE tool
SORT category ASC, tool ASC
```

## Tools by category

### Lifecycle
- [[sandbox_create]] — boot the microVM (idempotent).
- [[sandbox_info]] — status and connection details.
- [[sandbox_destroy]] — tear down and release resources.

### Shell
- [[shell_exec]] — run a shell command inside the VM.

### Files
- [[file_read]] — read a file's content.
- [[file_write]] — write content to a file.
- [[file_list]] — list a directory.
- [[file_find]] — find files by glob pattern.
- [[file_delete]] — delete a file or directory.
- [[file_upload_base64]] — upload via base64 string.
- [[file_download_base64]] — download as base64 string.
- [[send_file_to_user]] — make a file visible/downloadable to the user.

## Concepts

- [[Request context and headers]] — how `ctx` injection and the `x-user-id` /
  `x-conversation-id` / `x-workspace-paths` headers route every tool call.
- [[Sandbox routing and lifecycle]] — how all tool calls share one microVM (no `sandbox_id`
  param), the `SandboxManager` registry, the create → reuse sequence, and production caveats.

## Property schema

Each tool note carries these frontmatter properties (the database columns):

| Property | Meaning |
|----------|---------|
| `tool` | Tool name (function name on the server). |
| `category` | `lifecycle` · `shell` · `file`. |
| `summary` | One-line description. |
| `signature` | Full Python signature, including the injected `ctx`. |
| `parameters` | Real input arguments with type / default (excludes `ctx`). |
| `injected` | Arguments injected by FastMCP and hidden from the schema (`ctx`). |
| `uses_headers` | Request headers the tool relies on for routing. |
| `returns` | What the tool returns. |
| `mutates` | Whether it changes sandbox state. |
| `idempotent` | Whether repeated calls are safe / have the same effect. |
| `requires_sandbox` | Whether a running sandbox is needed. |
| `source` | `file:line` of the tool definition. |
| `tags` | `mcp-tool` plus category tags. |
