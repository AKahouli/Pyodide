# Microsoft 365 Search Backend

FastMCP server for searching Microsoft 365 data using Microsoft Graph Search API.

## Setup

1. **Create virtual environment:**
   ```bash
   python -m venv venv
   venv\Scripts\activate  # Windows
   ```

2. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

3. **Configure environment:**
   - Copy `.env.example` to `.env`
   - Fill in your Azure AD app registration details:
     - `AZURE_CLIENT_ID`: Your app's client ID
     - `AZURE_TENANT_ID`: Your tenant ID
     - `AZURE_CLIENT_SECRET`: Client secret (if using confidential client)

## Running

### Start Token Storage API (Port 8000)
```bash
python token_api.py
```

### Start MCP Server (SSE Transport) on Port 8001
```bash
python server.py
```
By default, the MCP server runs on port **8001** and allows CORS from any origin for direct browser connections. You can configure this in `.env`:
- `MCP_PORT=8001`
- `ALLOWED_ORIGINS=*`

## MCP Tools

### `search_m365`
Search Microsoft 365 data.

**Parameters:**
- `entity_type`: Type of entity to search
  - `drive` - OneDrive drives
  - `driveItem` - Files and folders
  - `list` - SharePoint lists
  - `listItem` - SharePoint list items
  - `chatMessage` - Teams chat messages
  - `message` - Outlook emails
- `query`: Search query (supports KQL)
- `size`: Number of results (default: 25, max: 1000)

**Example:**
```json
{
  "entity_type": "driveItem",
  "query": "contoso",
  "size": 25
}
```

### `get_token_status`
Check if user token is available.

## Required Permissions

Configure these delegated permissions in your Azure AD app:

- `Files.Read.All` - For drive/driveItem
- `Sites.Read.All` - For list/listItem
- `Mail.Read` - For message
- `Chat.Read` - For chatMessage

## Token Storage

User access tokens are stored in `user_token.json` (gitignored).
This is for **testing only** - use proper session management in production.
