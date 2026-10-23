import io
from unittest.mock import AsyncMock

import httpx
import pytest

from sandbox_mcp.client import SandboxClient, ToolResult


@pytest.mark.asyncio
async def test_upload_creates_exact_quoted_parent_on_same_scoped_client():
    client = SandboxClient("unused", "lease", "http://manager", scope_type="conversation", scope_id="conversation:qa", user_id="qa")
    await client.client.aclose()
    events = []
    async def transport(request):
        events.append(request)
        if request.url.path == "/sandbox/execute":
            return httpx.Response(200, json={"stdout": "", "stderr": "", "exit_code": 0})
        return httpx.Response(200, json={"success": True, "data": {"success": True, "file_size": 4}})
    client.client = httpx.AsyncClient(transport=httpx.MockTransport(transport), headers=client._scope_headers())
    try:
        result = await client.file_upload(io.BytesIO(b"data"), "/mnt/workspace/a'b/image.png")
        assert result.success
        import json
        assert json.loads(events[0].content) == {"sandbox_id": "lease", "command": "mkdir -p -- '/mnt/workspace/a'\"'\"'b'"}
        assert events[1].url.path == "/api/v1/file/upload"
        assert all(request.headers["x-sandbox-scope-id"] == "conversation:qa" for request in events)
        assert b"/mnt/workspace/a'b/image.png" in events[1].content
        assert b"data" in events[1].content
    finally:
        await client.client.aclose()


@pytest.mark.asyncio
async def test_upload_stops_before_post_when_parent_creation_fails():
    client = SandboxClient("unused", "lease", "http://manager")
    await client.client.aclose()
    client._ssh_exec = AsyncMock(return_value=ToolResult(success=False, message="read-only parent"))
    client.client = AsyncMock()
    result = await client.file_upload(io.BytesIO(b"data"), "/mnt/workspace/input/image.png")
    assert not result.success and result.message == "read-only parent"
    client.client.post.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("data", [{"success": False, "error": "write failed"}, {"exit_code": 1, "stderr": "write failed"}])
async def test_upload_rejects_nested_failure_despite_outer_success(data):
    client = SandboxClient("unused", "lease", "http://manager")
    await client.client.aclose()
    client._ssh_exec = AsyncMock(return_value=ToolResult(success=True))
    client.client = AsyncMock()
    client.client.post.return_value = httpx.Response(200, json={"success": True, "data": data})
    result = await client.file_upload(io.BytesIO(b"data"), "/mnt/workspace/input/image.png")
    assert not result.success and result.message == "write failed"
    assert result.data == data


@pytest.mark.asyncio
@pytest.mark.parametrize("fail_part", [None, 1])
async def test_large_upload_chunks_exact_bytes_and_publishes_only_after_success(fail_part):
    client = SandboxClient("unused", "lease", "http://manager")
    await client.client.aclose()
    client._ssh_exec = AsyncMock(return_value=ToolResult(success=True))
    client.client = AsyncMock()
    uploads = []
    async def post(_url, *, data, files):
        raw = files["file"][1].read()
        uploads.append((data, raw))
        return httpx.Response(200, json={"success": True, "data": {"success": len(uploads) - 1 != fail_part, "error": "chunk failed"}})
    client.client.post.side_effect = post
    raw = bytes(range(256)) * 516 + b"end"
    result = await client.file_upload(io.BytesIO(raw), "/mnt/workspace/input/image.png")
    commands = [call.args[0] for call in client._ssh_exec.await_args_list]
    assert all(len(part) <= 32768 for _, part in uploads)
    assert all(data["sandbox_id"] == "lease" and data["path"] != "/mnt/workspace/input/image.png" for data, _ in uploads)
    assert len({data["path"] for data, _ in uploads}) == len(uploads)
    assert commands[-1].startswith("rm -f -- ")
    assert all(data["path"] in commands[-1] for data, _ in uploads)
    if fail_part is None:
        assert result.success
        assert b"".join(part for _, part in uploads) == raw
        assert result.data["file_size"] == len(raw)
        assert commands[-2].startswith("mv -f -- ") and commands[-2].endswith(" /mnt/workspace/input/image.png")
        assert sum(command.startswith("cat -- ") for command in commands) == len(uploads)
    else:
        assert not result.success
        assert not any(command.startswith("mv -f -- ") for command in commands)


@pytest.mark.asyncio
async def test_large_upload_cleans_temporary_files_after_transport_exception():
    client = SandboxClient("unused", "lease", "http://manager")
    await client.client.aclose()
    client._ssh_exec = AsyncMock(return_value=ToolResult(success=True))
    client.client = AsyncMock()
    client.client.post.side_effect = RuntimeError("transport failed")
    with pytest.raises(RuntimeError, match="transport failed"):
        await client.file_upload(io.BytesIO(b"x" * 131990), "/mnt/workspace/input/image.png")
    commands = [call.args[0] for call in client._ssh_exec.await_args_list]
    assert commands[-1].startswith("rm -f -- ")
    assert not any(command.startswith("mv -f -- ") for command in commands)
