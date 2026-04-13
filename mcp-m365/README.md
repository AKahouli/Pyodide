# M365 Document Connector

FastMCP server providing document-oriented tools for Microsoft 365 via Microsoft Graph API.

## Document Tools

| Tool | Description |
|------|-------------|
| `list_accessible_sites` | List SharePoint sites accessible to the user |
| `list_accessible_drives` | List OneDrive and SharePoint document libraries |
| `search_documents` | Full-text and metadata search across M365 documents |
| `find_items_by_name` | Find files/folders by exact name |
| `list_folder_children` | Browse folder contents |
| `get_item_metadata` | Get detailed metadata for a file or folder |
| `get_document_content` | Read document content (inline text or download URL) |
| `create_folder` | Create a new folder |
| `create_document` | Create a new document with text content |
| `update_document_content` | Update an existing text document |
| `rename_item` | Rename a file or folder |
| `delete_item` | Delete a file or folder |

## Collaboration Tools (backward compatible)

| Tool | Description |
|------|-------------|
| `search_m365` | General M365 search across entity types |
| `list_users` | Search users in the organization |
| `list_joined_teams` | List joined Teams |
| `list_channels` | List channels in a team |
| `send_teams_message` | Send a Teams message |
| `send_email` | Send an email via Outlook |
| `create_meeting` | Create a calendar event |

## Setup

```bash
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

## Configuration

| Environment Variable | Description |
|---------------------|-------------|
| `M365_ACCESS_TOKEN` | Fallback access token (injected via header at runtime) |
| `M365_MCP_TRANSPORT` | Transport type: `sse` (default), `http`, `streamable-http` |
| `MCP_PORT` / `PORT` | Server port (default: 8001) |
| `ALLOWED_ORIGINS` | CORS origins (default: `*`) |

## Running

```bash
python server.py
```

## Content Read Behavior

- **Text files** (`.txt`, `.md`, `.json`, `.csv`, `.py`, etc.): content returned inline.
- **Binary/Office files** (`.docx`, `.xlsx`, `.pptx`, `.pdf`, images, etc.): a short-lived `downloadUrl` is returned. Use the platform transfer tools to import the file into the workspace.

## Item Reference Shape

All document tools return normalized items:

```json
{
  "siteId": "...",
  "driveId": "...",
  "itemId": "...",
  "name": "Report.docx",
  "webUrl": "https://...",
  "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "size": 12345,
  "isFolder": false,
  "lastModifiedDateTime": "2026-04-12T10:00:00Z",
  "createdDateTime": "2026-03-01T08:00:00Z"
}
```

## Required Permissions

Configure these delegated permissions in your Azure AD app:

- `Files.Read.All` - Read documents
- `Files.ReadWrite.All` - Create, update, rename, delete
- `Sites.Read.All` - Browse SharePoint sites and document libraries
- `Sites.ReadWrite.All` - Write to SharePoint document libraries
- `Mail.Read` - For email search (collaboration tools)
- `Chat.Read` - For Teams messages (collaboration tools)

## Architecture

```
mcp-m365/
  server.py          # FastMCP entry point, token middleware, collaboration tools
  document_tools.py  # 12 document-oriented MCP tools
  graph_helpers.py   # Shared Graph API client, auth, item normalization
  requirements.txt
```
