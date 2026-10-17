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

MCP ingress is authenticated before dispatch using `MCP_AUTH_MODE=JWT` with the
dedicated audience `mcp-sharepoint` (or explicit private `BEARER` mode). The
verified JWT subject is the actor and untrusted identity headers cannot override
it. Microsoft Graph uses the separate server-side `M365_ACCESS_TOKEN`; the MCP
credential is never forwarded to Graph. This follows ADR-0017 profile C. Keep
storage credentials server-side and apply site/resource allowlists for writes.

| Environment Variable | Description |
|---------------------|-------------|
| `M365_ACCESS_TOKEN` | Server-side Microsoft Graph provider token |
| `SHAREPOINT_MCP_TRANSPORT` | Transport type: `sse` (default), `http`, `streamable-http` |
| `SHAREPOINT_MCP_PORT` / `PORT` | Server port (default: 8001) |
| `ALLOWED_ORIGINS` | CORS origins (default: `*`) |

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
