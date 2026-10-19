#!/usr/bin/env python
"""
Standalone entry point for running the Logical Indexing MCP server.

This script runs the MCP server with SSE transport, which can be used
by MCP clients like Claude Desktop or other tools that support MCP over SSE.

Usage:
    python run_mcp_server.py

Environment Variables:
    DATABASE_URL - PostgreSQL connection string
    MCP_HOST - Server bind host (default: "0.0.0.0")
    MCP_PORT - Server bind port (default: 8045)

The server will start on http://localhost:8045 by default.
"""

import os
import uvicorn
from src.mcp_server.router import create_mcp_starlette_app
from src.config.settings import get_settings
from src.logger.setup_logging import setup_logging
from pydantic import TypeAdapter
from logging import getLogger


def main():
    """Run the MCP server."""
    settings = get_settings()

    log_json_format = TypeAdapter(bool).validate_python(os.getenv("LOG_JSON_FORMAT", settings.LOG_JSON_FORMAT))
    color_logs = TypeAdapter(bool).validate_python(os.getenv("COLOR_LOGS", settings.COLOR_LOGS))
    log_level = os.getenv("LOG_LEVEL", settings.LOG_LEVEL)
    setup_logging(json_logs=log_json_format, log_level=log_level, color_logs=color_logs)

    logger = getLogger("mcp-server")
    logger.info("Starting Logical Indexing MCP Server")

    mcp_app = create_mcp_starlette_app()

    host = settings.app_host
    port = settings.app_port

    logger.info("MCP Server starting on http://%s:%s", host, port)
    logger.info("Info endpoint: http://%s:%s/", host, port)
    logger.info("SSE endpoint: http://%s:%s/sse", host, port)
    logger.info("HTTP endpoint: http://%s:%s/http", host, port)
    logger.info("Document routing-profile endpoint: http://%s:%s/routing-profile", host, port)
    logger.info("Document search endpoint: http://%s:%s/search_documents", host, port)
    logger.info("Native search endpoint: http://%s:%s/search_native", host, port)
    logger.info("Swagger documentation: http://%s:%s/docs", host, port)

    uvicorn.run(
        mcp_app,
        host=host,
        port=port,
        log_level=log_level.lower(),
        log_config=None,
        # Network restrictions must use the actual peer, not forwarded headers.
        proxy_headers=False,
    )


if __name__ == "__main__":
    main()
