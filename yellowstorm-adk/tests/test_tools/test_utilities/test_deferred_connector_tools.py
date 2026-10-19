from types import SimpleNamespace

import pytest
from google.adk.models.llm_request import LlmRequest

from src.smart_rag.tools.search.tools import SearchToolADK
from src.smart_rag.tools.utilities.connector_tools import (
    DeferredConnectorToolset, install_deferred_connector_tools,
)


def connector(name="authorized_action"):
    async def action(value: str, tool_context):
        return {"value": value, "actor": tool_context.actor}
    action.__name__ = name
    tool = SearchToolADK(action, {"function": {
        "name": name, "description": "Find authorized workspace records.",
        "parameters": {"type": "object", "properties": {"value": {"type": "string"}}, "required": ["value"]},
    }}, reject_unknown_args=True)
    tool._conversation_connector = True
    return tool


async def prepare(toolset, invocation="one"):
    context = SimpleNamespace(invocation_id=invocation, actor="signed-in-user")
    request = LlmRequest()
    for tool in await toolset.get_tools_with_prefix(context):
        await tool.process_llm_request(tool_context=context, llm_request=request)
    names = [d.name for t in request.config.tools or [] for d in t.function_declarations or []]
    return request, names, context


@pytest.mark.asyncio
async def test_load_refreshes_declarations_in_same_invocation_without_executing_action():
    original = connector()
    toolset = DeferredConnectorToolset([original])
    request, names, context = await prepare(toolset)
    assert names == ["load_connector_tools"]
    assert request.tools_dict[original.name] is original
    assert original in await toolset.get_tools()
    assert "_deferred_connector_catalog" not in request.model_dump()
    signature = request._deferred_connector_catalog
    assert original.name in request.config.tools[0].function_declarations[0].description
    loaded = await request.tools_dict["load_connector_tools"].run_async(
        args={"tool_names": [original.name]}, tool_context=context)
    assert loaded["loaded"] == [original.name]
    refreshed, names, _ = await prepare(toolset)
    assert names == ["load_connector_tools", original.name]
    assert refreshed.tools_dict[original.name] is original
    assert refreshed._deferred_connector_catalog == signature
    assert await original.run_async(args={"value": "record"}, tool_context=context) == {
        "value": "record", "actor": "signed-in-user"}


@pytest.mark.asyncio
async def test_invocation_and_agent_isolation_unknown_names_and_validation():
    original = connector()
    toolset = DeferredConnectorToolset([original])
    request, _, context = await prepare(toolset)
    loader = request.tools_dict["load_connector_tools"]
    assert "error" in await loader.run_async(args={"tool_names": [original.name, "unauthorized"]}, tool_context=context)
    assert (await prepare(toolset))[1] == ["load_connector_tools"]
    await loader.run_async(args={"tool_names": [original.name]}, tool_context=context)
    assert (await prepare(toolset, "other-turn"))[1] == ["load_connector_tools"]
    assert (await prepare(DeferredConnectorToolset([connector()])))[1] == ["load_connector_tools"]
    assert "error" in await original.run_async(args={"value": "ok", "_actor": "spoof"}, tool_context=context)


def test_install_preserves_other_tools_and_callable_instruction():
    original, builtin = connector(), connector("builtin")
    builtin._conversation_connector = False
    instruction = lambda ctx: "unchanged"
    agent = SimpleNamespace(tools=[builtin, original], instruction=instruction)
    install_deferred_connector_tools(agent)
    assert agent.instruction is instruction
    assert agent.tools[0] is builtin
    assert isinstance(agent.tools[1], DeferredConnectorToolset)
