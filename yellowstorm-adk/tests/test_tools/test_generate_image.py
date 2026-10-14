import inspect
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from google.adk.tools import FunctionTool

from src.smart_rag.tools.native_tool_registry import resolve_native_tools


CONTEXT = {"platform_api_url": "https://platform.test/api", "platform_api_token": "test-token",
           "user_id": "u1", "conversation_id": "c1", "agent_id": "a1"}
RECEIPT = {"imageSource": "generated-image:" + "a" * 24, "fileName": "japan.png", "mimeType": "image/png"}


def test_image_tool_requires_assignment_and_trusted_context():
    assert resolve_native_tools([], CONTEXT) == []
    assert resolve_native_tools([{"name": "generate_image", "enabled": False}], CONTEXT) == []
    for key in CONTEXT:
        assert resolve_native_tools(["generate_image"], {k: v for k, v in CONTEXT.items() if k != key}) == []
    tool = resolve_native_tools(["generate_image"], CONTEXT)[0]
    assert set(inspect.signature(tool).parameters) == {"prompt", "aspectRatio"}
    schema = FunctionTool(tool)._get_declaration().parameters_json_schema
    assert set(schema["properties"]) == {"prompt", "aspectRatio"}
    from src.root_runtime.leaf_tools import is_leaf_tool
    assert is_leaf_tool(tool)
    configured = resolve_native_tools([{"name": "generate_image", "description": "Generate an image."}], CONTEXT)[0]
    assert is_leaf_tool(FunctionTool(configured))


def test_legacy_tool_config_preserves_model_and_routes_as_native():
    from src.smart_rag.agents.tools.tool_configuration import ToolConfigurationManager
    configs = ToolConfigurationManager().process_tool_configs([
        {"name": "generate_image", "model": "catalog-image-model"}])
    assert configs[0].tool_type == "custom"
    assert configs[0].custom_params["model"] == "catalog-image-model"
    assert len(resolve_native_tools(configs, CONTEXT)) == 1


@pytest.mark.asyncio
async def test_image_tool_keeps_model_and_identity_out_of_llm_inputs():
    tool = resolve_native_tools([{"name": "generate_image", "model": "catalog-image-model"}], CONTEXT)[0]
    response = MagicMock()
    response.json.return_value = {"data": {**RECEIPT, "bytes": "must-not-return", "token": "must-not-return"}}
    client = AsyncMock()
    client.post.return_value = response
    with patch("src.smart_rag.tools.utilities.generate_image.httpx.AsyncClient") as factory:
        factory.return_value.__aenter__.return_value = client
        result = await tool("  Japan landscape  ", "landscape")
    assert result == {**RECEIPT, "generated": True}
    client.post.assert_awaited_once_with("https://platform.test/api/v1/internal/root-work/images/generate",
        headers={"X-Internal-Token": "test-token"}, json={"conversationId": "c1", "userId": "u1",
        "agentId": "a1", "model": "catalog-image-model", "prompt": "Japan landscape", "aspectRatio": "landscape"})


@pytest.mark.asyncio
@pytest.mark.parametrize("payload", [{"imageSource": "https://untrusted.test/image.png"}, {"bytes": "base64"}])
async def test_image_tool_rejects_invalid_receipt(payload):
    response = MagicMock()
    response.json.return_value = payload
    with patch("src.smart_rag.tools.utilities.generate_image.httpx.AsyncClient") as factory:
        factory.return_value.__aenter__.return_value.post = AsyncMock(return_value=response)
        result = await resolve_native_tools(["generate_image"], CONTEXT)[0]("Japan")
    assert result["status"] == "error"


@pytest.mark.asyncio
async def test_image_failure_hides_provider_details():
    with patch("src.smart_rag.tools.utilities.generate_image.httpx.AsyncClient") as factory:
        factory.return_value.__aenter__.return_value.post = AsyncMock(side_effect=httpx.ConnectError("secret"))
        result = await resolve_native_tools(["generate_image"], CONTEXT)[0]("Japan")
    assert result == {"status": "error", "detail": "Image generation failed. Please try again."}


@pytest.mark.asyncio
async def test_invalid_image_inputs_make_no_provider_request():
    tool = resolve_native_tools(["generate_image"], CONTEXT)[0]
    with patch("src.smart_rag.tools.utilities.generate_image.httpx.AsyncClient") as factory:
        assert (await tool(" "))["status"] == "error"
        assert (await tool("x" * 12001))["status"] == "error"
        assert (await tool("Japan", "invalid"))["status"] == "error"
        factory.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("base", ["https://platform.test", "https://platform.test/api", "https://platform.test/api/v1/"])
async def test_generation_endpoint_uses_versioned_internal_route(base):
    tool = resolve_native_tools(["generate_image"], {**CONTEXT, "platform_api_url": base})[0]
    response = MagicMock()
    response.json.return_value = RECEIPT
    with patch("src.smart_rag.tools.utilities.generate_image.httpx.AsyncClient") as factory:
        client = factory.return_value.__aenter__.return_value
        client.post = AsyncMock(return_value=response)
        assert (await tool("Japan"))["generated"] is True
        factory.assert_called_once_with(timeout=210.0)
        assert client.post.call_args.args[0] == "https://platform.test/api/v1/internal/root-work/images/generate"
