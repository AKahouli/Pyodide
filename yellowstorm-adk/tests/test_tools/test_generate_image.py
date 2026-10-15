import inspect
import base64
from types import SimpleNamespace
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
    assert set(inspect.signature(tool).parameters) == {"prompt", "aspectRatio", "sourceImage", "reuseImage", "sourcePage", "tool_context"}
    schema = FunctionTool(tool)._get_declaration().parameters_json_schema
    assert set(schema["properties"]) == {"prompt", "aspectRatio", "sourceImage", "reuseImage", "sourcePage"}
    assert "sourceImage" not in schema.get("required", [])
    from src.root_runtime.leaf_tools import is_leaf_tool
    assert is_leaf_tool(tool)
    configured = resolve_native_tools([{"name": "generate_image", "description": "Generate an image."}], CONTEXT)[0]
    assert is_leaf_tool(FunctionTool(configured))
    assert "reuseImage" in configured.__doc__
    assert "sandboxPath" in configured.__doc__
    assert "sourceImage" in configured.__doc__


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
async def test_edit_image_passes_source_and_returns_new_receipt():
    source = "generated-image:" + "b" * 24
    tool = resolve_native_tools(["generate_image"], CONTEXT)[0]
    response = MagicMock()
    response.json.return_value = RECEIPT
    with patch("src.smart_rag.tools.utilities.generate_image.httpx.AsyncClient") as factory:
        client = factory.return_value.__aenter__.return_value
        client.post = AsyncMock(return_value=response)
        result = await tool("Make Mount Fuji watercolor and add a boat", "landscape", source)
    assert result == {**RECEIPT, "generated": True}
    assert result["imageSource"] != source
    assert client.post.call_args.kwargs["json"]["sourceImage"] == source
    assert client.post.call_args.kwargs["json"]["model"] == "gpt-image-2.5-flare"


@pytest.mark.asyncio
async def test_reuse_returns_authoritative_path_without_prompt():
    tool = resolve_native_tools(["generate_image"], CONTEXT)[0]
    path = f"/mnt/workspace/generated-images/{'a' * 24}.png"
    response = MagicMock()
    response.json.return_value = {**RECEIPT, "sandboxPath": path, "storageKey": "private"}
    with patch("src.smart_rag.tools.utilities.generate_image.httpx.AsyncClient") as factory:
        client = factory.return_value.__aenter__.return_value
        client.post = AsyncMock(return_value=response)
        result = await tool(reuseImage=RECEIPT["imageSource"])
    assert result == {**RECEIPT, "generated": True, "sandboxPath": path}
    assert client.post.call_args.kwargs["json"]["reuseImage"] == RECEIPT["imageSource"]


@pytest.mark.asyncio
async def test_image_paths_are_recorded_privately_only_for_current_turn():
    from src.smart_rag.tools.utilities.generate_image import IMAGE_SANDBOX_INPUTS_STATE_KEY
    path = f"/mnt/workspace/generated-images/{'a' * 24}.png"
    context = SimpleNamespace(invocation_id="current-turn", state={IMAGE_SANDBOX_INPUTS_STATE_KEY:
        {"invocation": "old-turn", "paths": [f"/mnt/workspace/generated-images/{'b' * 24}.png"]}})
    response = MagicMock()
    response.json.return_value = {**RECEIPT, "sandboxPath": path}
    with patch("src.smart_rag.tools.utilities.generate_image.httpx.AsyncClient") as factory:
        factory.return_value.__aenter__.return_value.post = AsyncMock(return_value=response)
        tool = resolve_native_tools(["generate_image"], CONTEXT)[0]
        await tool(reuseImage=RECEIPT["imageSource"], tool_context=context)
        await tool(reuseImage=RECEIPT["imageSource"], tool_context=context)
    assert context.state[IMAGE_SANDBOX_INPUTS_STATE_KEY] == {"invocation": "current-turn", "paths": [path]}


@pytest.mark.asyncio
@pytest.mark.parametrize("path", ["/mnt/workspace/system_other/generated-images/" + "a" * 24 + ".png",
                                  "/home/manus/private.png", "/mnt/workspace/system_c1/../private.png",
                                  "/mnt/workspace/generated-images/" + "b" * 24 + ".png",
                                  "/mnt/workspace/generated-images/../" + "a" * 24 + ".png"])
async def test_untrusted_sandbox_paths_never_reach_agent(path):
    response = MagicMock()
    response.json.return_value = {**RECEIPT, "sandboxPath": path}
    with patch("src.smart_rag.tools.utilities.generate_image.httpx.AsyncClient") as factory:
        factory.return_value.__aenter__.return_value.post = AsyncMock(return_value=response)
        result = await resolve_native_tools(["generate_image"], CONTEXT)[0]("Japan")
    assert "sandboxPath" not in result


@pytest.mark.asyncio
async def test_reuse_rejects_ambiguous_or_invalid_sources_before_request():
    tool = resolve_native_tools(["generate_image"], CONTEXT)[0]
    with patch("src.smart_rag.tools.utilities.generate_image.httpx.AsyncClient") as factory:
        assert (await tool(reuseImage="http://untrusted.test/a.png"))["status"] == "error"
        assert (await tool(sourceImage=RECEIPT["imageSource"], reuseImage=RECEIPT["imageSource"]))["status"] == "error"
        factory.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("source", ["", "http://example.test/image.png", "https://[bad/image.png", "generated-image:" + "a" * 23,
                                    "generated-image:" + "A" * 24, "generated-image:" + "a" * 24 + "\n", 123])
async def test_invalid_edit_source_makes_no_request(source):
    tool = resolve_native_tools(["generate_image"], CONTEXT)[0]
    with patch("src.smart_rag.tools.utilities.generate_image.httpx.AsyncClient") as factory:
        assert (await tool("Add a boat", sourceImage=source))["status"] == "error"
        factory.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("source", ["https://example.test/photo.png", "My uploaded image.jpg", "test_image.pdf"])
async def test_external_sources_reach_authorized_backend_without_local_fetch(source):
    response = MagicMock()
    response.json.return_value = {**RECEIPT, "generated": False}
    with patch("src.smart_rag.tools.utilities.generate_image.httpx.AsyncClient") as factory:
        client = factory.return_value.__aenter__.return_value
        client.post = AsyncMock(return_value=response)
        result = await resolve_native_tools(["generate_image"], CONTEXT)[0](reuseImage=source)
    assert result["generated"] is False
    assert client.post.call_args.kwargs["json"]["reuseImage"] == source


@pytest.mark.asyncio
async def test_pdf_preflight_renders_selected_bounded_page_privately():
    import pymupdf
    with pymupdf.open() as pdf:
        pdf.new_page(width=600, height=400)
        pdf.new_page(width=2000, height=1800).insert_text((50, 50), "Bar chart")
        encoded = base64.b64encode(pdf.tobytes()).decode("ascii")
    prepared, final = MagicMock(), MagicMock()
    prepared.json.return_value = {"data": {"sourcePdf": encoded, "mimeType": "application/pdf"}}
    final.json.return_value = {**RECEIPT, "generated": False, "sourcePdf": "never expose"}
    with patch("src.smart_rag.tools.utilities.generate_image.httpx.AsyncClient") as factory:
        client = factory.return_value.__aenter__.return_value
        client.post = AsyncMock(side_effect=[prepared, final])
        result = await resolve_native_tools(["generate_image"], CONTEXT)[0](reuseImage="test_image.pdf", sourcePage=2)
    assert client.post.await_count == 2
    data = base64.b64decode(client.post.call_args.kwargs["json"]["preparedImage"])
    image = pymupdf.Pixmap(data)
    assert data.startswith(b"\x89PNG\r\n\x1a\n")
    assert max(image.width, image.height) <= 1400
    assert "sourcePdf" not in result and "preparedImage" not in result


@pytest.mark.asyncio
@pytest.mark.parametrize("page", [0, 5001, True, 1.5])
async def test_invalid_pdf_page_never_calls_backend(page):
    with patch("src.smart_rag.tools.utilities.generate_image.httpx.AsyncClient") as factory:
        result = await resolve_native_tools(["generate_image"], CONTEXT)[0](reuseImage="test_image.pdf", sourcePage=page)
    assert result["status"] == "error"
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
