# Outlook/Calendar MCP Server

FastMCP server providing email and calendar tools for Microsoft Outlook via Microsoft Graph API.

## Tools

| Tool | Description |
|------|-------------|
| `list_users` | List or search users in the organization |
| `send_email` | Send an email via Microsoft Outlook |
| `create_meeting` | Create a calendar meeting/event with optional Teams meeting |

## Setup

```bash
cd outlook-mcp
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

## Configuration

| Environment Variable | Description |
|---------------------|-------------|
| `M365_ACCESS_TOKEN` | Fallback access token (injected via header at runtime) |
| `OUTLOOK_MCP_TRANSPORT` | Transport type: `sse` (default), `http`, `streamable-http` |
| `OUTLOOK_MCP_PORT` / `PORT` | Server port (default: 8002) |
| `ALLOWED_ORIGINS` | CORS origins (default: `*`) |

## Running

```bash
python server.py
```

## Required Permissions

Configure these delegated permissions in your Azure AD app:

- `Mail.ReadWrite` - Send and read emails
- `Mail.Send` - Send emails
- `Calendars.ReadWrite` - Create and manage calendar events
- `User.Read.All` - Search and list users

## Examples

### Send Email
```python
send_email(
    to_recipients=["user@example.com"],
    subject="Meeting Notes",
    body="<p>Here are the notes from our meeting...</p>"
)
```

### Create Meeting with Teams
```python
create_meeting(
    subject="Team Sync",
    start_datetime="2024-01-25T14:00:00",
    end_datetime="2024-01-25T15:00:00",
    attendees=["user@example.com"],
    timezone="UTC",
    is_online_meeting=True
)
```
