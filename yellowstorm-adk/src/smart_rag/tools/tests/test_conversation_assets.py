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
    assert all(t.metadata["safety"] == ("write" if t.__name__ == "prepare_conversation_asset" else "read") for t in resolved)
    assert resolve_native_tools([],{}) == []
    configured = resolve_native_tools(["read_conversation_asset"],CTX)
    assert len(configured) == 4
    assert all(t.metadata["safety"] == ("write" if t.__name__ == "prepare_conversation_asset" else "read") for t in configured)

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

@pytest.mark.asyncio
async def test_prepare_receipts_are_invocation_bound_and_private(monkeypatch):
    import hashlib
    from src.smart_rag.tools.utilities.generate_image import IMAGE_SANDBOX_INPUTS_STATE_KEY
    calls=[]
    async def post(self,url,**kwargs):
        payload=kwargs["json"]
        calls.append(payload)
        invocation=payload["invocationId"]
        return httpx.Response(200,json={"invocationId":invocation,
            "sandboxPath":f"/mnt/workspace/conversation-assets/{'a'*64}.pdf",
            "fileName":"same.pdf", "sha256":"b"*64, "storagePath":"private storage key"},request=httpx.Request("POST",url))
    monkeypatch.setattr(httpx.AsyncClient,"post",post)
    context=SimpleNamespace(invocation_id="turn-a",state={})
    prepare=tools()["prepare_conversation_asset"]
    first=await prepare("ref",tool_context=context)
    assert "storagePath" not in first
    await prepare("ref",tool_context=context)
    assert context.state[IMAGE_SANDBOX_INPUTS_STATE_KEY]["paths"] == [first["sandboxPath"]]
    assert calls[0]["userId"] == "actor-a" and calls[0]["invocationId"] == "turn-a"
    context.invocation_id="turn-b"
    second=await prepare("ref",tool_context=context)
    assert second["sandboxPath"] == first["sandboxPath"]
    assert context.state[IMAGE_SANDBOX_INPUTS_STATE_KEY]["invocation"] == "turn-b"
    assert context.state[IMAGE_SANDBOX_INPUTS_STATE_KEY]["paths"] == [second["sandboxPath"]]
    assert (await prepare("ref"))["status"] == "error"

@pytest.mark.asyncio
async def test_prepare_rejects_wrong_invocation_or_denied_receipt(monkeypatch):
    from src.smart_rag.tools.utilities.generate_image import IMAGE_SANDBOX_INPUTS_STATE_KEY
    async def post(self,url,**kwargs):
        return httpx.Response(200,json={"invocationId":"other", "sandboxPath":"/mnt/workspace/private.pdf"},request=httpx.Request("POST",url))
    monkeypatch.setattr(httpx.AsyncClient,"post",post)
    context=SimpleNamespace(invocation_id="turn",state={})
    assert (await tools()["prepare_conversation_asset"]("ref",tool_context=context))["status"] == "error"
    assert IMAGE_SANDBOX_INPUTS_STATE_KEY not in context.state


@pytest.mark.asyncio
@pytest.mark.parametrize("invalid",["", "invocation", "digest", "bytes", "remote", "missing", "denied", "parent"])
async def test_private_hydration_reauthorizes_and_hash_checks(monkeypatch,invalid):
    import hashlib
    from src.smart_rag.tools.utilities.conversation_assets import hydrate_prepared_assets
    from src.flow_engine.tools.sandbox_mount_guard import SandboxMountValidationError
    raw=b"private PDF bytes"
    digest=hashlib.sha256(raw).hexdigest()
    path=f"/mnt/workspace/conversation-assets/{'a'*64}.pdf"
    async def post(self,url,**kwargs):
        assert kwargs["json"]=={"userId":"actor-a","conversationId":"conversation-a","invocationId":"turn","ref":"ref","includeBytes":True}
        return httpx.Response(200,json={"invocationId":"other" if invalid=="invocation" else "turn", "sandboxPath":path,
            "sha256":"f"*64 if invalid=="digest" else digest,
            "contentBase64":base64.b64encode(b"other" if invalid=="bytes" else raw).decode()},request=httpx.Request("POST",url))
    monkeypatch.setattr(httpx.AsyncClient,"post",post)
    calls=[]
    async def call(action,params):
        calls.append((action,params))
        if action=="shell_exec":
            if params["command"].startswith("mkdir "):
                assert params["command"] == "mkdir -p -- /mnt/workspace/conversation-assets && printf '%s' ASSET_PARENT_READY"
                return {"result": "[stderr] Permission denied" if invalid == "parent" else "ASSET_PARENT_READY"}
            assert params["command"].startswith("python3 -c ")
            if invalid in {"missing", "denied"}:
                error = "FileNotFoundError:2" if invalid == "missing" else "PermissionError:13"
                return {"result": "ASSET_VERIFY_ERROR:" + error}
            return {"result":"f"*64 if invalid=="remote" else digest, "text":digest}
        assert params=={"path":path,"content_base64":base64.b64encode(raw).decode()}
        return {"result":"ok"}
    context=SimpleNamespace(platform_api_url="http://backend/api",platform_api_token="test",user_id="actor-a")
    coro=hydrate_prepared_assets(context,"conversation-a","turn",{path:{"ref":"ref","path":path,"sha256":digest}},[path.rsplit("/",1)[-1]],call)
    if invalid:
        with pytest.raises(SandboxMountValidationError) as failure:
            await coro
        if invalid in {"missing", "denied"}:
            assert "verification failed" in str(failure.value)
            assert path not in str(failure.value) and digest not in str(failure.value)
        elif invalid == "parent": assert [a for a,_ in calls] == ["shell_exec"]
        elif invalid != "remote": assert calls==[]
    else:
        assert await coro is None
        assert [a for a,_ in calls]==["shell_exec","file_upload_base64","shell_exec"]

def test_private_base64_logs_are_redacted():
    from src.mcp import _redact_log_payload
    assert "private" not in str(_redact_log_payload({"content_base64":"private","nested":{"contentBase64":"private"}}))


@pytest.mark.asyncio
@pytest.mark.parametrize("state", ["ready", "deleted", "denied"])
async def test_prepared_asset_access_is_rechecked_without_reading_bytes(monkeypatch, state):
    from src.smart_rag.tools.utilities.conversation_assets import validate_prepared_assets
    from src.flow_engine.tools.sandbox_mount_guard import SandboxMountValidationError
    async def post(self, url, **kwargs):
        assert url.endswith("/assets/inspect")
        assert kwargs["json"] == {"userId": "actor-a", "conversationId": "conversation-a", "ref": "ref"}
        return httpx.Response(404 if state == "denied" else 200, json={"status": state}, request=httpx.Request("POST", url))
    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    ctx = SimpleNamespace(platform_api_url="http://backend/api", platform_api_token="test", user_id="actor-a")
    check = validate_prepared_assets(ctx, "conversation-a", {"path": {"ref": "ref", "sha256": "a" * 64}})
    if state == "ready":
        await check
    else:
        with pytest.raises(SandboxMountValidationError):
            await check


@pytest.mark.asyncio
@pytest.mark.parametrize("body", [{"epoch":None,"cleanupPending":False}, {"epoch":"deleted-at","cleanupPending":True}, {"epoch":None}, {"epoch":123,"cleanupPending":False}])
async def test_revocation_state_requires_trusted_scope_and_valid_contract(monkeypatch, body):
    from src.smart_rag.tools.utilities.conversation_assets import get_asset_revocation
    from src.flow_engine.tools.sandbox_mount_guard import SandboxMountValidationError
    async def post(self,url,**kwargs):
        assert url.endswith("/assets/revocation")
        assert kwargs["json"] == {"userId":"actor-a","conversationId":"conversation-a"}
        return httpx.Response(200,json={"data":body},request=httpx.Request("POST",url))
    monkeypatch.setattr(httpx.AsyncClient,"post",post)
    ctx=SimpleNamespace(user_id="actor-a",platform_api_url="http://backend/api",platform_api_token="test")
    if "cleanupPending" in body and (body["epoch"] is None or isinstance(body["epoch"],str)):
        assert await get_asset_revocation(ctx,"conversation-a") == body
    else:
        with pytest.raises(SandboxMountValidationError):
            await get_asset_revocation(ctx,"conversation-a")
