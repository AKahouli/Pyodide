import base64
import inspect
from types import SimpleNamespace
import httpx
import pytest
from src.smart_rag.tools.utilities.conversation_assets import create_conversation_asset_tools
CTX = dict(platform_api_url="http://backend/api", platform_api_token="test-token", user_id="actor-a", conversation_id="conversation-a")

def tools():
    return {t.__name__: t for t in create_conversation_asset_tools(CTX)}

@pytest.mark.asyncio
async def test_authority_and_same_names(monkeypatch):
    calls = []
    async def post(self, url, **kwargs):
        calls.append((url, kwargs))
        return httpx.Response(200, json={"data": {"assets": [{"ref":"a", "name":"same.pdf"}, {"ref":"b", "name":"same.pdf"}], "nextCursor":"next"}}, request=httpx.Request("POST",url))
    monkeypatch.setattr(httpx.AsyncClient,"post",post)
    tool = tools()["list_conversation_assets"]
    result = await tool(limit=2)
    assert [a["ref"] for a in result["assets"]] == ["a","b"]
    assert calls[0][0] == "http://backend/api/v1/internal/root-work/assets/list"
    assert calls[0][1]["json"]["userId"] == "actor-a"
    assert calls[0][1]["json"]["conversationId"] == "conversation-a"
    assert "userId" not in inspect.signature(tool).parameters
    assert "conversationId" not in inspect.signature(tool).parameters
    assert create_conversation_asset_tools({}) == []

@pytest.mark.asyncio
async def test_invalid_input_never_calls_backend(monkeypatch):
    async def post(*args, **kwargs):
        pytest.fail("Invalid input reached backend")
    monkeypatch.setattr(httpx.AsyncClient,"post",post)
    for ref in ("/mnt/a", "https://x/a", "../a", "x"*2049):
        assert (await tools()["inspect_conversation_asset"](ref))["status"] == "error"
    for limit in (0,51,True):
        assert (await tools()["list_conversation_assets"](limit=limit))["status"] == "error"
    assert (await tools()["read_conversation_asset"]("ref",maxChars=30001))["status"] == "error"

@pytest.mark.asyncio
async def test_sanitized_permission_errors(monkeypatch):
    async def post(self,url,**kwargs):
        return httpx.Response(403,json={"secret":"actor-b storage key"},request=httpx.Request("POST",url))
    monkeypatch.setattr(httpx.AsyncClient,"post",post)
    result = await tools()["read_conversation_asset"]("ref")
    assert result["status"] == "error"
    assert "actor-b" not in str(result) and "secret" not in str(result)

@pytest.mark.asyncio
async def test_bounded_text_and_image_bridge(monkeypatch):
    async def post(self,url,**kwargs):
        data = ({"contentType":"text", "text":"x"*50} if kwargs["json"]["ref"] == "text_ref" else
            {"contentType":"image", "dataUrl":"data:image/png;base64,"+base64.b64encode(b"png").decode()})
        return httpx.Response(200,json=data,request=httpx.Request("POST",url))
    monkeypatch.setattr(httpx.AsyncClient,"post",post)
    read = tools()["read_conversation_asset"]
    result = await read("text_ref",maxChars=10)
    assert result["text"] == "x"*10 and result["truncated"]
    context=SimpleNamespace(state={})
    result=await read("image_ref",tool_context=context)
    assert "dataUrl" not in result and result["imageAvailableForVisualInspection"]
    assert next(v for k,v in context.state.items() if k.startswith("_list_of_filenames_")) == ["image_ref"]
    assert (await read("image_ref"))["status"] == "error"

def test_default_agent_tools_without_catalog_opt_in():
    from src.smart_rag.tools.native_tool_registry import resolve_native_tools
    resolved=resolve_native_tools([],CTX)
    assert {t.__name__ for t in resolved} == set(tools())
    assert all(t.metadata["safety"] == "read" for t in resolved)
    assert resolve_native_tools([],{}) == []
    configured = resolve_native_tools(["read_conversation_asset"],CTX)
    assert len(configured) == 3
    assert all(t.metadata["safety"] == "read" for t in configured)

@pytest.mark.asyncio
async def test_concurrent_actors_keep_separate_authority(monkeypatch):
    import asyncio
    calls=[]
    async def post(self,url,**kwargs):
        calls.append(kwargs["json"])
        await asyncio.sleep(0)
        return httpx.Response(200,json={"assets":[{"ref":kwargs["json"]["userId"]}],"nextCursor":None},request=httpx.Request("POST",url))
    monkeypatch.setattr(httpx.AsyncClient,"post",post)
    alice=create_conversation_asset_tools(CTX)[0]
    bob=create_conversation_asset_tools({**CTX,"user_id":"actor-b","conversation_id":"conversation-b"})[0]
    results=await asyncio.gather(alice(),bob())
    assert [r["assets"][0]["ref"] for r in results] == ["actor-a","actor-b"]
    assert {(c["userId"],c["conversationId"]) for c in calls} == {("actor-a","conversation-a"),("actor-b","conversation-b")}
