"""
Outlook/Calendar MCP Server

Provides MCP tools to interact with Microsoft Outlook (email) and Calendar
using Microsoft Graph API. Includes email sending, user lookup, and meeting creation.

Authentication is injected at runtime via the Authorization header or environment
variables by the connector auth layer. This server is fully stateless — it does
not read or write any local token files.
"""

import json
import os
import sys
from typing import Optional

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

mcp = FastMCP("Outlook/Calendar Connector")


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
# Outlook Email Tools
# ---------------------------------------------------------------------------


@mcp.tool()
async def list_users(query: str = None) -> str:
    """
    List or search users in the organization.

    Args:
        query: Optional search query (starts with name or email)

    Returns:
        JSON string containing list of users
    """
    try:
        url = f"{GRAPH_BASE}/users"
        params = {"$select": "id,displayName,mail,userPrincipalName", "$top": 20}

        headers = graph_headers()
        if query:
            params["$search"] = f'"displayName:{query}" OR "mail:{query}"'
            headers["ConsistencyLevel"] = "eventual"

        async with httpx.AsyncClient() as client:
            response = await client.get(url, headers=headers, params=params)
            response.raise_for_status()
            data = response.json()

        return json.dumps(
            {"status": "success", "users": data.get("value", [])}, indent=2
        )
    except Exception as e:
        return json.dumps({"status": "error", "message": str(e)}, indent=2)


@mcp.tool()
async def send_email(
    to_recipients: list[str],
    subject: str,
    body: str,
    cc_recipients: list[str] = None,
    bcc_recipients: list[str] = None,
    importance: str = "normal",
) -> str:
    """
    Send an email via Microsoft Outlook.

    Args:
        to_recipients: List of recipient email addresses
        subject: Email subject
        body: Email body (HTML supported)
        cc_recipients: Optional list of CC recipient email addresses
        bcc_recipients: Optional list of BCC recipient email addresses
        importance: Email importance (low, normal, high)

    Returns:
        JSON string with the result

    Examples:
        - send_email(["user@example.com"], "Meeting Notes", "<p>Here are the notes...</p>")
        - send_email(["user1@example.com", "user2@example.com"], "Project Update", "Status: On track", importance="high")
    """
    try:
        headers = graph_headers()

        email_payload: dict = {
            "message": {
                "subject": subject,
                "body": {"contentType": "HTML", "content": body},
                "toRecipients": [
                    {"emailAddress": {"address": email}} for email in to_recipients
                ],
                "importance": importance,
            }
        }

        if cc_recipients:
            email_payload["message"]["ccRecipients"] = [
                {"emailAddress": {"address": email}} for email in cc_recipients
            ]
        if bcc_recipients:
            email_payload["message"]["bccRecipients"] = [
                {"emailAddress": {"address": email}} for email in bcc_recipients
            ]

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{GRAPH_BASE}/me/sendMail",
                headers=headers,
                json=email_payload,
                timeout=30.0,
            )

            if response.status_code not in [200, 202]:
                return json.dumps(
                    {
                        "status": "error",
                        "message": f"Failed to send email: {response.text}",
                    },
                    indent=2,
                )

            return json.dumps(
                {"status": "success", "message": "Email sent successfully"}, indent=2
            )

    except Exception as e:
        return json.dumps({"status": "error", "message": str(e)}, indent=2)


# ---------------------------------------------------------------------------
# Calendar Tools
# ---------------------------------------------------------------------------


@mcp.tool()
async def create_meeting(
    subject: str,
    start_datetime: str,
    end_datetime: str,
    attendees: list[str],
    timezone: str = "UTC",
    location: str = None,
    body: str = None,
    is_online_meeting: bool = False,
) -> str:
    """
    Create a calendar meeting/event.

    Args:
        subject: Meeting subject
        start_datetime: Start date and time in ISO 8601 format (e.g., "2024-01-25T14:00:00")
        end_datetime: End date and time in ISO 8601 format (e.g., "2024-01-25T15:00:00")
        attendees: List of attendee email addresses
        timezone: Timezone (default: UTC). Examples: "Europe/Paris", "America/New_York"
        location: Optional meeting location
        body: Optional meeting description (HTML supported)
        is_online_meeting: If True, creates a Teams online meeting

    Returns:
        JSON string with the result including event ID and Teams meeting URL (if online)

    Examples:
        - create_meeting("Team Sync", "2024-01-25T14:00:00", "2024-01-25T15:00:00", ["user@example.com"])
        - create_meeting("Project Review", "2024-01-26T10:00:00", "2024-01-26T11:00:00",
                        ["user1@example.com", "user2@example.com"],
                        timezone="Europe/Paris", is_online_meeting=True)
    """
    try:
        headers = graph_headers()

        meeting_payload: dict = {
            "subject": subject,
            "start": {"dateTime": start_datetime, "timeZone": timezone},
            "end": {"dateTime": end_datetime, "timeZone": timezone},
            "attendees": [
                {"emailAddress": {"address": email}, "type": "required"}
                for email in attendees
            ],
        }

        if location:
            meeting_payload["location"] = {"displayName": location}
        if body:
            meeting_payload["body"] = {"contentType": "HTML", "content": body}
        if is_online_meeting:
            meeting_payload["isOnlineMeeting"] = True
            meeting_payload["onlineMeetingProvider"] = "teamsForBusiness"

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{GRAPH_BASE}/me/events",
                headers=headers,
                json=meeting_payload,
                timeout=30.0,
            )

            if response.status_code not in [200, 201]:
                return json.dumps(
                    {
                        "status": "error",
                        "message": f"Failed to create meeting: {response.text}",
                    },
                    indent=2,
                )

            event_data = response.json()

            result = {
                "status": "success",
                "message": "Meeting created successfully",
                "event_id": event_data.get("id"),
            }
            if is_online_meeting and "onlineMeeting" in event_data:
                result["online_meeting_url"] = event_data["onlineMeeting"].get(
                    "joinUrl"
                )

            return json.dumps(result, indent=2)

    except Exception as e:
        return json.dumps({"status": "error", "message": str(e)}, indent=2)


if __name__ == "__main__":
    os.environ.setdefault("HOST", "0.0.0.0")
    transport = os.getenv("OUTLOOK_MCP_TRANSPORT", "sse")
    port = int(os.getenv("OUTLOOK_MCP_PORT", os.getenv("PORT", "8002")))

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
        f"Starting Outlook MCP server with transport: {transport} on port: {port}",
        file=sys.stderr,
    )
    mcp.run(transport=transport, middleware=middleware, host="0.0.0.0", port=port)
