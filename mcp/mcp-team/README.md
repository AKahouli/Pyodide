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

MCP ingress is authenticated before dispatch using `MCP_AUTH_MODE=JWT` with the
dedicated audience `mcp-team` (or explicit private `BEARER` mode). The verified
JWT subject is the actor and untrusted identity headers cannot override it.
Microsoft Graph uses the separate server-side `M365_ACCESS_TOKEN`; the MCP
credential is never forwarded to Graph. This follows ADR-0017 profile C and
requires a protected internal listener with least-privilege delegated/app
permissions.

| Environment Variable | Description |
|---------------------|-------------|
| `M365_ACCESS_TOKEN` | Server-side Microsoft Graph provider token |
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
