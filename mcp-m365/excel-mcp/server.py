"""
Microsoft Excel MCP Server

Provides MCP tools to interact with Microsoft Excel files via Microsoft Graph API.
NOTE: This is a placeholder implementation. Excel tools are yet to be implemented.

Authentication is injected at runtime via the Authorization header or environment
variables by the connector auth layer. This server is fully stateless — it does
not read or write any local token files.
"""

import os
import sys

from dotenv import load_dotenv
from fastmcp import FastMCP
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from starlette.types import ASGIApp, Receive, Scope, Send

# Add parent directory to path to import shared helpers
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../shared')))
from graph_helpers import _request_token

load_dotenv()

mcp = FastMCP("Microsoft Excel Connector")


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
# Excel Tools (Placeholder - To be implemented)
# ---------------------------------------------------------------------------

@mcp.tool()
async def excel_placeholder() -> str:
    """
    Placeholder tool for Excel MCP.

    Excel tools are yet to be implemented. Future tools may include:
    - Read Excel files
    - Write to Excel files
    - Query Excel data
    - Create Excel workbooks

    Returns:
        JSON string with placeholder message
    """
    return '{"status": "info", "message": "Excel MCP tools are yet to be implemented. This is a placeholder server."}'


if __name__ == "__main__":
    os.environ.setdefault("HOST", "0.0.0.0")
    transport = os.getenv("EXCEL_MCP_TRANSPORT", "sse")
    port = int(os.getenv("EXCEL_MCP_PORT", os.getenv("PORT", "8004")))

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
        f"Starting Excel MCP server with transport: {transport} on port: {port}",
        file=sys.stderr,
    )
    mcp.run(transport=transport, middleware=middleware, host="0.0.0.0", port=port)
