# Microsoft 365 MCP Servers Collection

This repository contains a collection of FastMCP servers for interacting with Microsoft 365 services via Microsoft Graph API. The original monolithic MCP has been split into separate, focused servers for better modularity and maintainability.

## Structure

```
mcp-m365/
├── shared/
│   └── graph_helpers.py          # Shared Graph API utilities (auth, HTTP helpers)
│
├── sharepoint-mcp/               # SharePoint/OneDrive Document Connector (12 tools)
│   ├── server.py
│   ├── document_tools.py
│   ├── requirements.txt
│   └── README.md
│
├── outlook-mcp/                  # Outlook/Calendar Connector (3 tools)
│   ├── server.py
│   ├── requirements.txt
│   └── README.md
│
└── teams-mcp/                    # Microsoft Teams Connector (3 tools)
    ├── server.py
    ├── requirements.txt
    └── README.md
```

## Quick Start

Each MCP server can be run independently:

### SharePoint MCP (Port 8001)
```bash
cd sharepoint-mcp
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python server.py
```

### Outlook MCP (Port 8002)
```bash
cd outlook-mcp
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python server.py
```

### Teams MCP (Port 8003)
```bash
cd teams-mcp
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python server.py
```

## Tools Overview

### SharePoint MCP (12 tools)
Document and file management for SharePoint and OneDrive:
- `list_accessible_sites` - List SharePoint sites
- `list_accessible_drives` - List OneDrive and document libraries
- `search_documents` - Full-text search across documents
- `find_items_by_name` - Find files/folders by name
- `list_folder_children` - Browse folder contents
- `get_item_metadata` - Get file/folder metadata
- `get_document_content` - Read document content
- `create_folder`, `create_document`, `update_document_content`, `rename_item`, `delete_item`

### Outlook MCP (3 tools)
Email and calendar operations:
- `list_users` - Search users in organization
- `send_email` - Send emails via Outlook
- `create_meeting` - Create calendar events with optional Teams meeting

### Teams MCP (3 tools)
Microsoft Teams operations:
- `list_joined_teams` - List joined teams
- `list_channels` - List channels in a team
- `send_teams_message` - Send messages to users or channels

## Authentication

All MCP servers use the same authentication mechanism:

1. **Runtime Token Injection** (Recommended): Token is injected via `Authorization: Bearer <token>` header by the auth layer
2. **Environment Variable Fallback**: Set `M365_ACCESS_TOKEN` environment variable

## Configuration

Each MCP server supports these environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `{MCP}_TRANSPORT` | Transport type: `sse`, `http`, `streamable-http` | `sse` |
| `{MCP}_PORT` / `PORT` | Server port | Varies (8001-8003) |
| `ALLOWED_ORIGINS` | CORS origins | `*` |
| `M365_ACCESS_TOKEN` | Fallback access token | - |

Example:
```bash
set SHAREPOINT_MCP_TRANSPORT=sse
set SHAREPOINT_MCP_PORT=8001
set ALLOWED_ORIGINS=*
```

## Azure AD App Registration

Configure these delegated permissions in your Azure AD app:

### SharePoint MCP
- `Files.Read.All` - Read documents
- `Files.ReadWrite.All` - Create, update, rename, delete
- `Sites.Read.All` - Browse SharePoint sites
- `Sites.ReadWrite.All` - Write to SharePoint libraries

### Outlook MCP
- `Mail.ReadWrite` - Read and send emails
- `Mail.Send` - Send emails
- `Calendars.ReadWrite` - Create and manage events
- `User.Read.All` - Search and list users

### Teams MCP
- `Chat.ReadWrite` - Read and send chat messages
- `Team.ReadBasic.All` - Read teams
- `ChannelMessage.Send` - Send channel messages

## Migration from Original MCP

If you were using the original monolithic `mcp-m365` server:

1. **Identify which tools you use**: Check which MCP category your tools belong to
2. **Run the specific MCP**: Start only the MCP servers you need
3. **Update your configuration**: Point to the new server ports

| Original Tool | New MCP | Port |
|--------------|---------|------|
| Document tools (12) | sharepoint-mcp | 8001 |
| send_email, list_users, create_meeting | outlook-mcp | 8002 |
| list_joined_teams, list_channels, send_teams_message | teams-mcp | 8003 |

## Development

### Adding New Tools

1. Identify which MCP the tool belongs to
2. Add the `@mcp.tool()` decorated function in the appropriate `server.py`
3. Test the tool independently

### Shared Code

All MCPs share the `graph_helpers.py` module which provides:
- Authentication (`get_access_token`, `graph_headers`)
- HTTP helpers (`graph_get`, `graph_post`, `graph_patch`, `graph_delete`)
- Response utilities (`error_response`, `success_response`)
- Item normalization (`normalize_drive_item`, `normalize_site`, etc.)

## License

[Your License Here]
