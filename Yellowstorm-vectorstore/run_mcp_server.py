#!/usr/bin/env python
"""
Standalone entry point for running the Logical Indexing MCP server.

This script runs the MCP server with SSE transport, which can be used
by MCP clients like Claude Desktop or other tools that support MCP over SSE.

Usage:
    python run_mcp_server.py

Environment Variables:
    BRAIN_ID - The brain/workspace ID to query (default: "default")
    DATABASE_URL - PostgreSQL connection string

The server will start on http://localhost:8001 by default.
"""

import os
import uvicorn
from src.mcp_sever.router import create_mcp_starlette_app
from src.config.settings import get_settings
from src.logger.setup_logging import setup_logging
from pydantic import TypeAdapter
from logging import getLogger


def main():
    """Run the MCP server."""
    settings = get_settings()

    # Setup logging
    LOG_JSON_FORMAT = TypeAdapter(bool).validate_python(os.getenv("LOG_JSON_FORMAT", False))
    COLOR_LOGS = TypeAdapter(bool).validate_python(os.getenv("COLOR_LOGS", True))
    LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
    setup_logging(json_logs=LOG_JSON_FORMAT, log_level=LOG_LEVEL, color_logs=COLOR_LOGS)

    logger = getLogger("mcp-server")
    logger.info(f"Starting Logical Indexing MCP Server...")
    logger.info(f"Brain ID: {settings.BRAIN_ID}")

    # Create the MCP Starlette app with SSE transport
    mcp_app = create_mcp_starlette_app()

    # Run with uvicorn
    host = os.getenv("MCP_HOST", "0.0.0.0")
    port = int(os.getenv("MCP_PORT", "8045"))

    logger.info(f"MCP Server starting on http://{host}:{port}")
    logger.info(f"SSE endpoint: http://{host}:{port}/sse")
    logger.info(f"Info endpoint: http://{host}:{port}/")

    uvicorn.run(
        mcp_app,
        host=host,
        port=port,
        log_level=LOG_LEVEL.lower()
    )


if __name__ == "__main__":
    main()
