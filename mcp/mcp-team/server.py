"""
Microsoft Teams MCP Server

Provides MCP tools to interact with Microsoft Teams using Microsoft Graph API.
Includes listing teams, channels, and sending messages.

Authentication is two-credential and injected at runtime by the connector auth
layer (ADR-0017, ADR-0026): the Authorization bearer is the backend-signed actor
assertion, and the configured provider-token header carries the acting user's
delegated Microsoft Graph token. This server is fully stateless — it does not
read or write any local token files and holds no tenant-wide Graph credential.
"""

import json
import os
import sys
from typing import Literal, Optional

import httpx
from dotenv import load_dotenv
from fastmcp import FastMCP
from starlette.middleware.cors import CORSMiddleware
from starlette.types import ASGIApp, Receive, Scope, Send
from starlette.middleware import Middleware
from starlette.requests import Request
from starlette.responses import JSONResponse
from auth import AuthMiddleware

# Import local helpers (fully independent project)
from graph_helpers import GRAPH_BASE, graph_headers

load_dotenv()

mcp = FastMCP("Microsoft Teams Connector")


@mcp.custom_route("/health/live", methods=["GET"])
async def health_live(_request: Request) -> JSONResponse:
    return JSONResponse({"status": "ok"})


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
                # First, get the authenticated user's ID
                me_req = await client.get(
                    f"{GRAPH_BASE}/me", headers=headers
                )
                if me_req.status_code != 200:
                    return json.dumps(
                        {"status": "error", "message": "Failed to get authenticated user info"}
                    )

                my_user_id = me_req.json().get("id")

                # Then, get the target user's ID
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
                            "user@odata.bind": f"https://graph.microsoft.com/v1.0/users('{my_user_id}')",
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

                # Surface chat_id explicitly: worky binds the reply-wait to this
                # chat, and the message resource does not always echo chatId back.
                return json.dumps(
                    {"status": "success", "chat_id": chat_id, "data": send_res.json()},
                    indent=2,
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
    transport = os.getenv("TEAMS_MCP_TRANSPORT", "streamable-http")
    port = int(os.getenv("TEAMS_MCP_PORT", os.getenv("PORT", "8003")))

    middleware = [Middleware(AuthMiddleware)]

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
    if transport == "streamable-http":
        # Every call carries its own actor assertion and delegated Graph token,
        # so no MCP transport session may retain either (ADR-0026).
        mcp.run(transport=transport, middleware=middleware, host="0.0.0.0", port=port, stateless_http=True)
    else:
        mcp.run(transport=transport, middleware=middleware, host="0.0.0.0", port=port)
