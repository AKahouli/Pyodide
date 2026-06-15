"""
SharePoint/OneDrive MCP Server

Provides MCP tools to interact with Microsoft SharePoint and OneDrive documents
using Microsoft Graph API. Includes document discovery, search, browsing,
read/write operations.

Authentication is injected at runtime via the Authorization header or environment
variables by the connector auth layer. This server is fully stateless — it does
not read or write any local token files.
"""

import os
import sys
from typing import Any

from dotenv import load_dotenv
from fastmcp import FastMCP
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from starlette.types import ASGIApp, Receive, Scope, Send

# Add parent directory to path to import shared helpers
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../shared')))
from graph_helpers import _request_token, GRAPH_BASE

from document_tools import register_document_tools

load_dotenv()

mcp = FastMCP("SharePoint/OneDrive Document Connector")

register_document_tools(mcp)


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


if __name__ == "__main__":
    import sys

    os.environ.setdefault("HOST", "0.0.0.0")
    transport = os.getenv("SHAREPOINT_MCP_TRANSPORT", "sse")
    port = int(os.getenv("SHAREPOINT_MCP_PORT", os.getenv("PORT", "8001")))

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
        f"Starting SharePoint MCP server with transport: {transport} on port: {port}",
        file=sys.stderr,
    )
    mcp.run(transport=transport, middleware=middleware, host="0.0.0.0", port=port)
