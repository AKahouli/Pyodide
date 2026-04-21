"""
FastAPI router for MCP Server endpoints.

Provides HTTP/SSE transport for the Logical Indexing MCP server.
Includes BrainIdMiddleware for extracting brain_ids from request headers.
"""

from fastapi import APIRouter
from starlette.applications import Starlette
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from starlette.routing import Mount, Route

from src.mcp_sever.logical_indexing_server import mcp
from src.mcp_sever.context import brain_ids_var, parse_brain_ids_header, external_ids_var, parse_external_ids_header
from src.logger.logging import get_logger

logger = get_logger("vectorstores-api.mcp.router")


class BrainIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        brain_ids = parse_brain_ids_header(request.headers.get("X-Brain-ID"))
        brain_token = None
        if brain_ids:
            brain_token = brain_ids_var.set(brain_ids)
            logger.debug(f"Set brain_ids from X-Brain-ID header: {brain_ids}")

        external_ids = parse_external_ids_header(request.headers.get("X-External-ID"))
        external_token = None
        if external_ids:
            external_token = external_ids_var.set(external_ids)
            logger.debug(f"Set external_ids from X-External-ID header: {external_ids}")

        try:
            return await call_next(request)
        finally:
            if brain_token is not None:
                brain_ids_var.reset(brain_token)
            else:
                brain_ids_var.set(None)
            if external_token is not None:
                external_ids_var.reset(external_token)
            else:
                external_ids_var.set(None)


def create_mcp_info_response():
    """Return information about available MCP tools."""
    tools = mcp.list_tools()
    resources = mcp.list_resources()
    return {
        "name": mcp.name,
        "tools_count": len(tools),
        "resources_count": len(resources),
        "tools": [
            {
                "name": t.name,
                "description": t.description[:100] + "..." if len(t.description) > 100 else t.description
            }
            for t in tools
        ],
        "resources": [
            {
                "uri": str(r.uri),
                "name": r.name
            }
            for r in resources
        ]
    }


# Create the router for MCP-related HTTP endpoints
router = APIRouter(prefix="/mcp", tags=["MCP"])


@router.get("/")
async def mcp_info():
    """
    Get information about the MCP server including available tools and resources.

    Returns:
        JSON with MCP server info, tools list, and resources list
    """
    return create_mcp_info_response()


@router.get("/tools")
async def list_tools():
    """
    List all available MCP tools.

    Returns:
        JSON array of tool definitions
    """
    tools = mcp.list_tools()
    return {
        "tools": [
            {
                "name": t.name,
                "description": t.description,
                "input_schema": t.inputSchema
            }
            for t in tools
        ]
    }


@router.get("/resources")
async def list_resources():
    """
    List all available MCP resources.

    Returns:
        JSON array of resource definitions
    """
    resources = mcp.list_resources()
    return {
        "resources": [
            {
                "uri": str(r.uri),
                "name": r.name,
                "description": getattr(r, 'description', None)
            }
            for r in resources
        ]
    }


def create_mcp_starlette_app() -> Starlette:
    """
    Create a Starlette app that combines MCP SSE transport with info endpoints.

    This creates a standalone Starlette application that can be mounted
    into an existing FastAPI app. BrainIdMiddleware is added to extract
    X-Brain-ID headers and set the brain_ids context variable.

    Returns:
        Starlette application with MCP endpoints and brain ID middleware
    """
    mcp_app = mcp.http_app(path="/")

    routes = [
        Route("/", endpoint=mcp_info, methods=["GET"]),
        Route("/tools", endpoint=list_tools, methods=["GET"]),
        Route("/resources", endpoint=list_resources, methods=["GET"]),
    ]

    app = Starlette(
        routes=routes + [
            Mount("/sse", app=mcp_app),
            Mount("/http", app=mcp_app),
        ],
        lifespan=mcp_app.lifespan
    )

    app.add_middleware(BrainIdMiddleware)

    return app


# Create the standalone MCP app that can be mounted
mcp_starlette_app = create_mcp_starlette_app()
