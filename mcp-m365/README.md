# Microsoft 365 MCP Server

Monolithic FastMCP server for interacting with Microsoft 365 services via Microsoft Graph API. Includes document management, Outlook, and Teams tools in a single server.

## Quick Start

```bash
cd mcp-m365
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python server.py
```

## Tools Overview

### Document Tools (12 tools)
Document and file management for SharePoint and OneDrive:
- `list_accessible_sites` - List SharePoint sites
- `list_accessible_drives` - List OneDrive and document libraries
- `search_documents` - Full-text search across documents
- `find_items_by_name` - Find files/folders by name
- `list_folder_children` - Browse folder contents
- `get_item_metadata` - Get file/folder metadata
- `get_document_content` - Read document content
- `create_folder`, `create_document`, `update_document_content`, `rename_item`, `delete_item`

### Outlook Tools (3 tools)
Email and calendar operations:
- `list_users` - Search users in organization
- `send_email` - Send emails via Outlook
- `create_meeting` - Create calendar events with optional Teams meeting

### Teams Tools (3 tools)
Microsoft Teams operations:
- `list_joined_teams` - List joined teams
- `list_channels` - List channels in a team
- `send_teams_message` - Send messages to users or channels

## Authentication

The server supports two authentication methods:

1. **Runtime Token Injection** (Recommended): Token is injected via `Authorization: Bearer <token>` header by the connector layer
2. **Environment Variable Fallback**: Set `M365_ACCESS_TOKEN` environment variable

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `TRANSPORT` | Transport type: `sse`, `http`, `streamable-http` | `sse` |
| `PORT` | Server port | `8000` |
| `ALLOWED_ORIGINS` | CORS origins | `*` |
| `M365_ACCESS_TOKEN` | Fallback access token | - |

## Azure AD App Registration

Configure these delegated permissions in your Azure AD app:

**Document Operations**:
- `Files.Read.All` - Read documents
- `Files.ReadWrite.All` - Create, update, rename, delete
- `Sites.Read.All` - Browse SharePoint sites
- `Sites.ReadWrite.All` - Write to SharePoint libraries

**Email & Calendar**:
- `Mail.ReadWrite` - Read and send emails
- `Mail.Send` - Send emails
- `Calendars.ReadWrite` - Create and manage events
- `User.Read.All` - Search and list users

**Teams**:
- `Chat.ReadWrite` - Read and send chat messages
- `Team.ReadBasic.All` - Read teams
- `ChannelMessage.Send` - Send channel messages

## License

[Your License Here]