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

MCP ingress is two-credential and authenticated before dispatch (ADR-0017): the
`Authorization` bearer is the backend-signed actor assertion (`MCP_AUTH_MODE=JWT`
with the dedicated audience `mcp-team`, or explicit private `BEARER` mode), and
the configured provider-token header carries the acting user's delegated
Microsoft Graph token. Graph calls use only that per-request token; there is no
environment token, so every Teams operation runs with the user's own permissions
and the MCP holds no tenant-wide credential. The `streamable-http` transport runs
stateless, so no session retains either credential.

| Environment Variable | Description |
|---------------------|-------------|
| `M365_TOKEN_HEADER` | Header carrying the acting user's delegated Graph token (default `x-m365-access-token`) |
| `TEAMS_MCP_TRANSPORT` | Transport type: `streamable-http` (default), `sse`, `http` |
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
