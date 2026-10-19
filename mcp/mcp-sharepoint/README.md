# SharePoint/OneDrive MCP Server

FastMCP server providing document-oriented tools for Microsoft SharePoint and OneDrive via Microsoft Graph API.

## Tools

| Tool | Description |
|------|-------------|
| `list_accessible_sites` | List SharePoint sites accessible to the user |
| `list_accessible_drives` | List OneDrive and SharePoint document libraries |
| `search_documents` | Full-text and metadata search across M365 documents |
| `find_items_by_name` | Find files/folders by exact name |
| `list_folder_children` | Browse folder contents |
| `get_item_metadata` | Get detailed metadata for a file or folder |
| `get_document_content` | Read document content (inline text or download URL) |
| `download_documents` | Download files/folders into the run's storage folder (Ceph) |
| `send_file_to_user` | Deliver a downloaded file to the user in the conversation |
| `create_folder` | Create a new folder |
| `create_document` | Create a new document with text content |
| `update_document_content` | Update an existing text document |
| `rename_item` | Rename a file or folder |
| `delete_item` | Delete a file or folder |

## Setup

```bash
cd sharepoint-mcp
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

## Configuration

Two independent credentials arrive on every call, and neither substitutes for the
other (ADR-0017, ADR-0026):

1. **Ingress** — `Authorization: Bearer <assertion>`, verified before dispatch
   with `MCP_AUTH_MODE=JWT` against the dedicated audience `mcp-sharepoint` (or
   explicit private `BEARER` mode with `MCP_INGRESS_TOKEN`). The verified JWT
   subject is the actor, and untrusted identity headers cannot override it.
2. **Provider authority** — the acting user's delegated Microsoft Graph token,
   sent by the connector auth layer in `M365_TOKEN_HEADER` (default
   `x-m365-access-token`). Graph calls use only that token, so every SharePoint
   operation runs with the user's own permissions. The MCP holds no tenant-wide
   Graph credential, and there is no environment fallback: tool calls fail closed
   (`{"error":"provider_credential_required"}`) when the header is missing,
   duplicated (a repeated header counts even when only one value is non-blank),
   or echoes the ingress assertion.

Both credentials are bound per HTTP request. The `streamable-http` transport runs
stateless (`stateless_http=True`), so no transport session retains a token: a
later call without the provider header is refused even if an earlier one supplied
it. The `sse`/`http` transports keep their previous launch path and do not carry
that guarantee.

Keep storage credentials server-side and apply site/resource allowlists for writes.

| Environment Variable | Description |
|---------------------|-------------|
| `M365_TOKEN_HEADER` | Header carrying the acting user's delegated Graph token (default `x-m365-access-token`) |
| `SHAREPOINT_MCP_TRANSPORT` | Transport type: `streamable-http`, `sse`, `http` |
| `SHAREPOINT_MCP_PORT` / `PORT` | Server port (default: 8001) |
| `ALLOWED_ORIGINS` | CORS origins (default: `*`) |
| `MCP_AUTH_MODE` / `MCP_INGRESS_TOKEN` / `MCP_JWT_PUBLIC_KEY` / `MCP_JWT_ISSUER` / `MCP_JWT_AUDIENCE` | Ingress authentication |

### Tests

```bash
cd mcp-sharepoint
python -m pytest tests -q
```

## Running

```bash
python server.py
```

## Content Read Behavior

- **Text files** (`.txt`, `.md`, `.json`, `.csv`, `.py`, etc.): content returned inline.
- **Binary/Office files** (`.docx`, `.xlsx`, `.pptx`, `.pdf`, images, etc.): a short-lived `downloadUrl` is returned.

To make a document available to the code interpreter, use `download_documents`
rather than the `downloadUrl` — see below.

## Run storage folder

`download_documents` writes to `<user_id>/system_<run_id>` in Ceph, where `run_id`
is `x-conversation-id` or, for a playbook run, `x-execution-id`. That is the same
folder the sandbox MCP uses, so when the caller also mounts it (the ADK appends it
to `x-workspace-paths`) a downloaded file is readable in the sandbox at
`/mnt/workspace/system_<run_id>/<relative path>` with no extra step.

`send_file_to_user` accepts either of those two names for a file, and only under
this run's folder — a file has to be downloaded by this run before it can be sent.

Folders are walked and their structure preserved under the run folder, so
same-named files in different subfolders do not collide. Both the file count and
the total size of one call are capped (`MAX_DOWNLOAD_FILES`, `MAX_DOWNLOAD_BYTES`);
anything over the cap is reported in `skipped` rather than failing the call.

The rule is shared with every other connector MCP that downloads files —
see `RUN_STORAGE_CONTRACT.md` in the `mcp-outlook` repo.

## Required Permissions

Configure these delegated permissions in your Azure AD app:

- `Files.Read.All` - Read documents
- `Files.ReadWrite.All` - Create, update, rename, delete
- `Sites.Read.All` - Browse SharePoint sites and document libraries
- `Sites.ReadWrite.All` - Write to SharePoint document libraries
