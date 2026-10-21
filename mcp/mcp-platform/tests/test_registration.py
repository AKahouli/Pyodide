"""The registration helper must mount a second tool module unchanged: the
platform's extensibility contract, proven with a dummy module."""
from types import SimpleNamespace

import pytest
from fastmcp import Client, FastMCP

from config import Settings
from server import MODULES, register_tools
from tools import agent_tools, playbook_tools, semantic_tools


async def dummy_tool() -> dict:
    """Dummy tool of the second module."""
    return {"ok": True}


@pytest.mark.asyncio
async def test_registration_helper_mounts_a_dummy_second_module():
    dummy = SimpleNamespace(
        INSTRUCTIONS="Dummy module instructions.",
        register=lambda mcp, settings: mcp.tool()(dummy_tool),
    )
    mcp = FastMCP("extensibility", instructions="")
    register_tools(mcp, Settings("http://backend", 190, 2097152, 25, 8030, "0.0.0.0", "streamable-http", "public.pem"),
                   [playbook_tools, dummy])
    async with Client(mcp) as client:
        tools = {tool.name for tool in await client.list_tools()}
    assert "search_playbooks" in tools  # the real module is mounted unchanged
    assert "dummy_tool" in tools        # the second module is mounted by the same helper
    assert len(tools) == len(playbook_tools._TOOLS) + 1


def test_platform_module_registry_mounts_all_consolidated_modules():
    assert MODULES == [playbook_tools, agent_tools, semantic_tools]
