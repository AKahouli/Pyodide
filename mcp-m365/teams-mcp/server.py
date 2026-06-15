"""
Microsoft Teams MCP Server

Provides MCP tools to interact with Microsoft Teams using Microsoft Graph API.
Includes listing teams, channels, and sending messages.

Authentication is injected at runtime via the Authorization header or environment
variables by the connector auth layer. This server is fully stateless — it does
not read or write any local token files.
"""

import json
import os
import sys
from typing import Literal, Optional

import httpx
from dotenv import load_dotenv
from fastmcp import FastMCP
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from starlette.types import ASGIApp, Receive, Scope, Send

# Add parent directory to path to import shared helpers
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../shared')))
from graph_helpers import _request_token, GRAPH_BASE, graph_headers

load_dotenv()

mcp = FastMCP("Microsoft Teams Connector")


class TokenExtractorMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        token = None
        if scope["type"] == "http":
            headers = dict(scope.get("headers", []))
            auth_header = headers.get(b"authorization", b"").decode(
                "utf-8", errors="replace"
            )
            if auth_header.lower().startswith("bearer "):
                token = auth_header[len("bearer ") :]
        _request_token.set(token)
        await self.app(scope, receive, send)


# ---------------------------------------------------------------------------
# Teams Tools
# ---------------------------------------------------------------------------


@mcp.tool()
async def list_joined_teams() -> str:
    """
    List teams that the signed-in user has joined.

    Returns:
        JSON string containing list of teams
    """
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{GRAPH_BASE}/me/joinedTeams", headers=graph_headers()
            )
            response.raise_for_status()
            data = response.json()

        return json.dumps(
            {"status": "success", "teams": data.get("value", [])}, indent=2
        )
    except Exception as e:
        return json.dumps({"status": "error", "message": str(e)}, indent=2)


@mcp.tool()
async def list_channels(team_id: str) -> str:
    """
    List channels in a specific team.

    Args:
        team_id: The ID of the team

    Returns:
        JSON string containing list of channels
    """
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{GRAPH_BASE}/teams/{team_id}/channels", headers=graph_headers()
            )
            response.raise_for_status()
            data = response.json()

        return json.dumps(
            {"status": "success", "channels": data.get("value", [])}, indent=2
        )
    except Exception as e:
        return json.dumps({"status": "error", "message": str(e)}, indent=2)


@mcp.tool()
async def send_teams_message(
    message: str,
    user_email: Optional[str] = None,
    channel_id: Optional[str] = None,
    team_id: Optional[str] = None,
) -> str:
    """
    Send a message to a user (1:1 chat) or a channel.

    Args:
        message: Content of the message (can be HTML)
        user_email: Email of the user to send to (for 1:1 chat)
        channel_id: ID of the channel to send to (requires team_id)
        team_id: ID of the team (required if sending to a channel)

    Returns:
        JSON string with the result
    """
    try:
        if not user_email and not (channel_id and team_id):
            return json.dumps(
                {
                    "status": "error",
                    "message": "Must provide either user_email OR (team_id and channel_id)",
                }
            )

        headers = graph_headers()

        async with httpx.AsyncClient() as client:
            if user_email:
                user_req = await client.get(
                    f"{GRAPH_BASE}/users/{user_email}", headers=headers
                )
                if user_req.status_code != 200:
                    return json.dumps(
                        {"status": "error", "message": f"User not found: {user_email}"}
                    )

                target_user_id = user_req.json().get("id")

                chat_payload = {
                    "chatType": "oneOnOne",
                    "members": [
                        {
                            "@odata.type": "#microsoft.graph.aadUserConversationMember",
                            "roles": ["owner"],
                            "user@odata.bind": f"https://graph.microsoft.com/v1.0/users('{target_user_id}')",
                        },
                        {
                            "@odata.type": "#microsoft.graph.aadUserConversationMember",
                            "roles": ["owner"],
                            "user@odata.bind": "https://graph.microsoft.com/v1.0/me",
                        },
                    ],
                }

                create_chat_res = await client.post(
                    f"{GRAPH_BASE}/chats", headers=headers, json=chat_payload
                )
                if create_chat_res.status_code not in [200, 201]:
                    return json.dumps(
                        {
                            "status": "error",
                            "message": f"Failed to create chat: {create_chat_res.text}",
                        }
                    )

                chat_id = create_chat_res.json().get("id")

                msg_payload = {"body": {"contentType": "html", "content": message}}
                send_res = await client.post(
                    f"{GRAPH_BASE}/chats/{chat_id}/messages",
                    headers=headers,
                    json=msg_payload,
                )

                if send_res.status_code not in [200, 201]:
                    return json.dumps(
                        {
                            "status": "error",
                            "message": f"Failed to send message: {send_res.text}",
                        }
                    )

                return json.dumps(
                    {"status": "success", "data": send_res.json()}, indent=2
                )

            elif team_id and channel_id:
                msg_payload = {"body": {"contentType": "html", "content": message}}
                send_res = await client.post(
                    f"{GRAPH_BASE}/teams/{team_id}/channels/{channel_id}/messages",
                    headers=headers,
                    json=msg_payload,
                )

                if send_res.status_code not in [200, 201]:
                    return json.dumps(
                        {
                            "status": "error",
                            "message": f"Failed to send channel message: {send_res.text}",
                        }
                    )

                return json.dumps(
                    {"status": "success", "data": send_res.json()}, indent=2
                )

    except Exception as e:
        return json.dumps({"status": "error", "message": str(e)}, indent=2)


if __name__ == "__main__":
    os.environ.setdefault("HOST", "0.0.0.0")
    transport = os.getenv("TEAMS_MCP_TRANSPORT", "sse")
    port = int(os.getenv("TEAMS_MCP_PORT", os.getenv("PORT", "8003")))

    middleware = [Middleware(TokenExtractorMiddleware)]

    if transport in ["sse", "http", "streamable-http"]:
        origins = os.getenv("ALLOWED_ORIGINS", "*").split(",")
        allow_credentials = "*" not in origins

        print(
            f"Enabling CORS for origins: {origins} (credentials: {allow_credentials})",
            file=sys.stderr,
        )
        middleware.append(
            Middleware(
                CORSMiddleware,
                allow_origins=origins,
                allow_credentials=allow_credentials,
                allow_methods=["*"],
                allow_headers=["*"],
            )
        )

    print(
        f"Starting Teams MCP server with transport: {transport} on port: {port}",
        file=sys.stderr,
    )
    mcp.run(transport=transport, middleware=middleware, host="0.0.0.0", port=port)
