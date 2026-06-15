# Microsoft Teams MCP Server

FastMCP server providing Microsoft Teams tools via Microsoft Graph API.

## Tools

| Tool | Description |
|------|-------------|
| `list_joined_teams` | List teams that the signed-in user has joined |
| `list_channels` | List channels in a specific team |
| `send_teams_message` | Send a message to a user (1:1 chat) or a channel |

## Setup

```bash
cd teams-mcp
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

## Configuration

| Environment Variable | Description |
|---------------------|-------------|
| `M365_ACCESS_TOKEN` | Fallback access token (injected via header at runtime) |
| `TEAMS_MCP_TRANSPORT` | Transport type: `sse` (default), `http`, `streamable-http` |
| `TEAMS_MCP_PORT` / `PORT` | Server port (default: 8003) |
| `ALLOWED_ORIGINS` | CORS origins (default: `*`) |

## Running

```bash
python server.py
```

## Required Permissions

Configure these delegated permissions in your Azure AD app:

- `Chat.ReadWrite` - Read and send chat messages
- `Team.ReadBasic.All` - Read teams
- `ChannelMessage.Send` - Send channel messages

## Examples

### List Teams and Channels
```python
# First, list your teams
teams = list_joined_teams()

# Then, list channels for a specific team
channels = list_channels(team_id="team-id-here")
```

### Send Message to User
```python
send_teams_message(
    message="<p>Hello! How are you?</p>",
    user_email="user@example.com"
)
```

### Send Message to Channel
```python
send_teams_message(
    message="<p>Team update: Project completed!</p>",
    team_id="team-id-here",
    channel_id="channel-id-here"
)
```
