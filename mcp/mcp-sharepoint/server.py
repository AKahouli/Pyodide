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

from dotenv import load_dotenv
from fastmcp import FastMCP
from starlette.middleware.cors import CORSMiddleware
from starlette.types import ASGIApp, Receive, Scope, Send
from starlette.middleware import Middleware
from starlette.requests import Request
from starlette.responses import JSONResponse
from auth import AuthMiddleware

# Import local helpers (fully independent project)
from document_tools import register_document_tools

load_dotenv()

mcp = FastMCP("SharePoint/OneDrive Document Connector")


@mcp.custom_route("/health/live", methods=["GET"])
async def health_live(_request: Request) -> JSONResponse:
    return JSONResponse({"status": "ok"})

register_document_tools(mcp)


if __name__ == "__main__":
    import sys

    os.environ.setdefault("HOST", "0.0.0.0")
    transport = os.getenv("SHAREPOINT_MCP_TRANSPORT", "sse")
    port = int(os.getenv("SHAREPOINT_MCP_PORT", os.getenv("PORT", "8001")))

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
        f"Starting SharePoint MCP server with transport: {transport} on port: {port}",
        file=sys.stderr,
    )
    mcp.run(transport=transport, middleware=middleware, host="0.0.0.0", port=port)
