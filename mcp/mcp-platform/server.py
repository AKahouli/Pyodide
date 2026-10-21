import os
from pathlib import Path

from fastmcp import FastMCP
from starlette.middleware import Middleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from auth import TrustedIdentityMiddleware
from config import Settings
from tools import agent_tools, playbook_tools, semantic_tools


# Tool modules mounted by the platform. A module exposes INSTRUCTIONS (str) and
# register(mcp, settings). Nothing else changes.
MODULES = [playbook_tools, agent_tools, semantic_tools]


def register_tools(mcp: FastMCP, settings: Settings, modules=MODULES) -> None:
    """Mount every tool module: INSTRUCTIONS + register(mcp, settings) is the contract."""
    for module in modules:
        module.register(mcp, settings)


settings = Settings.from_env()
# Unified logging: stderr JSON lines only (MCP protocol owns stdout).
from yellowmind_observability import setup_observability

setup_observability(service_name=os.environ.get("OBS_SERVICE_NAME") or "mcp-platform")
mcp = FastMCP("YellowStorm Platform MCP", instructions="\n\n".join(module.INSTRUCTIONS for module in MODULES))
register_tools(mcp, settings)


@mcp.custom_route("/health/live", methods=["GET"])
async def health_live(_request: Request) -> JSONResponse:
    return JSONResponse({"status": "ok"})


@mcp.custom_route("/health/ready", methods=["GET"])
async def health_ready(_request: Request) -> JSONResponse:
    try:
        settings.validate()
    except ValueError:
        return JSONResponse({"status": "not_ready"}, status_code=503)
    return JSONResponse({"status": "ready"})


if __name__ == "__main__":
    settings.validate()
    public_key = Path(settings.jwt_public_key_file).read_text(encoding="utf-8")
    middleware = [Middleware(
        TrustedIdentityMiddleware,
        jwt_public_key=public_key,
        jwt_issuer=settings.jwt_issuer,
        jwt_audience=settings.jwt_audience,
    )]
    mcp.run(transport=settings.transport, host=settings.host, port=settings.port, middleware=middleware,
            stateless_http=True)
