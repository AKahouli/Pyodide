"""Entry point for the Manus Sandbox MCP server (HTTP transport).

Usage:
    python main.py
    python main.py --host 0.0.0.0 --port 8001
"""
from __future__ import annotations

import argparse
import logging
import sys

from sandbox_mcp.config import get_settings, validate_settings
from sandbox_mcp.server import create_mcp


def main() -> None:
    settings = get_settings()
    validate_settings(settings)

    logging.basicConfig(
        level=getattr(logging, settings.log_level.upper(), logging.INFO),
        format="%(asctime)s %(name)-30s %(levelname)-8s %(message)s",
        stream=sys.stderr,
    )

    parser = argparse.ArgumentParser(description="Manus Sandbox MCP Server")
    parser.add_argument(
        "--host",
        default=settings.mcp_host,
        help=f"HTTP server host (default: {settings.mcp_host})",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=settings.mcp_port,
        help=f"HTTP server port (default: {settings.mcp_port})",
    )
    args = parser.parse_args()

    import asyncio
    import uvicorn
    from sandbox_mcp.server import RequestHeaderLogMiddleware
    from sandbox_mcp.manager import MultiUserSandboxManager
    from sandbox_mcp.runtime import SandboxRuntime
    from sandbox_mcp.eviction import run_ttl_eviction_loop

    multi_manager = MultiUserSandboxManager(settings)
    runtime = SandboxRuntime(settings)
    mcp = create_mcp(host=args.host, port=args.port, multi_manager=multi_manager, runtime=runtime)

    starlette_app = mcp.streamable_http_app()
    app = RequestHeaderLogMiddleware(starlette_app, settings)

    logging.getLogger(__name__).info(
        "Starting Manus Sandbox MCP over HTTP on %s:%d", args.host, args.port
    )
    config = uvicorn.Config(
        app,
        host=args.host,
        port=args.port,
        log_level="debug" if settings.log_level.upper() == "DEBUG" else "info",
    )

    async def _serve():
        eviction_task = asyncio.create_task(
            run_ttl_eviction_loop(multi_manager, settings),
            name="sandbox-ttl-eviction",
        )
        try:
            await uvicorn.Server(config).serve()
        finally:
            eviction_task.cancel()
            try:
                await eviction_task
            except asyncio.CancelledError:
                pass
            logging.getLogger(__name__).info("Server shutting down — destroying all sandboxes")
            await multi_manager.destroy_all()

    asyncio.run(_serve())


if __name__ == "__main__":
    main()
