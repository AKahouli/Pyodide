"""
SharePoint/OneDrive MCP Server

Provides MCP tools to interact with Microsoft SharePoint and OneDrive documents
using Microsoft Graph API. Includes document discovery, search, browsing,
read/write operations.

Authentication is two-credential and injected at runtime by the connector auth
layer (ADR-0017, ADR-0026): the Authorization bearer is the backend-signed actor
assertion, and the configured provider-token header carries the acting user's
delegated Microsoft Graph token. This server is fully stateless — it does not
read or write any local token files and holds no tenant-wide Graph credential.
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
from graph_helpers import logger

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

        logger.info(
            f"Enabling CORS for origins: {origins} (credentials: {allow_credentials})",
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

    logger.info(
        f"Starting SharePoint MCP server with transport: {transport} on port: {port}",
    )
    if transport == "streamable-http":
        # Every call carries its own actor assertion and delegated Graph token,
        # so no MCP transport session may retain either (ADR-0026).
        mcp.run(transport=transport, middleware=middleware, host="0.0.0.0", port=port, stateless_http=True)
    else:
        mcp.run(transport=transport, middleware=middleware, host="0.0.0.0", port=port)
