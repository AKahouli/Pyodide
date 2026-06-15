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

| Environment Variable | Description |
|---------------------|-------------|
| `M365_ACCESS_TOKEN` | Fallback access token (injected via header at runtime) |
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

## Required Permissions

Configure these delegated permissions in your Azure AD app:

- `Files.Read.All` - Read documents
- `Files.ReadWrite.All` - Create, update, rename, delete
- `Sites.Read.All` - Browse SharePoint sites and document libraries
- `Sites.ReadWrite.All` - Write to SharePoint document libraries
