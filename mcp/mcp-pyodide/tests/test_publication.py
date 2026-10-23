from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from fastmcp.exceptions import ToolError
from pydantic import ValidationError

from sandbox_mcp import server as module
from sandbox_mcp.client import ToolResult
from sandbox_mcp.config import Settings


@pytest.fixture
def publication(monkeypatch):
    settings = Settings(_env_file=None, sandbox_manager_url="http://manager.test")
    monkeypatch.setattr(module, "get_settings", lambda: settings)
    sandbox = SimpleNamespace(exec_command=AsyncMock(return_value=ToolResult(
        success=True, data={"stdout": "exists=1 is_dir=0 size=12500000", "exit_code": 0})))
    runtime = SimpleNamespace(acquire=AsyncMock(return_value=sandbox))
    multi = MagicMock()
    monkeypatch.setattr(module, "_STATE", {"runtime": runtime, "multi_manager": multi})
    response = httpx.Response(200, json={"ceph_path": "alice/system_conv/report.docx"})
    client = AsyncMock()
    client.__aenter__.return_value = client
    client.post.return_value = response
    factory = MagicMock(return_value=client)
    monkeypatch.setattr(module.httpx, "AsyncClient", factory)
    return settings, client, factory, sandbox


async def invoke(publication, path="/mnt/yellowmind/run/outputs/report.docx"):
    return await module.send_file_to_user(path=path)


@pytest.mark.asyncio
async def test_publication_preserves_scope_and_success_receipt(publication):
    user = module._current_user_id.set("alice")
    scope = module._current_scope_id.set("conversation:conv")
    lane = module._current_lane_id.set("main")
    try:
        result = await invoke(publication)
        assert "alice/system_conv/report.docx" in str(result)
        assert publication[1].post.call_args.kwargs["json"] == {
            "user_id": "alice", "scope_id": "conversation:conv", "lane_id": "main",
            "file_path": "/mnt/yellowmind/run/outputs/report.docx"}
        assert publication[2].call_args.kwargs["timeout"] == 120
    finally:
        module._current_user_id.reset(user)
        module._current_scope_id.reset(scope)
        module._current_lane_id.reset(lane)


@pytest.mark.asyncio
@pytest.mark.parametrize("body", [[], 123, True, {}, {"ceph_path": []},
    {"ceph_path": "   "}, {"ceph_path": "valid", "relative_path": {}},
    {"status": "error", "message": "copy failed"}])
async def test_malformed_success_is_tool_error(publication, body):
    publication[1].post.return_value = httpx.Response(200, json=body)
    with pytest.raises(ToolError):
        await invoke(publication)


@pytest.mark.asyncio
@pytest.mark.parametrize("response", [httpx.Response(503, text="unavailable"),
    httpx.Response(200, text="not json")])
async def test_invalid_http_response_is_tool_error(publication, response):
    publication[1].post.return_value = response
    with pytest.raises(ToolError):
        await invoke(publication)


@pytest.mark.asyncio
async def test_timeout_does_not_retry_or_return_receipt(publication):
    publication[1].post.side_effect = httpx.ReadTimeout("slow copy")
    with pytest.raises(ToolError, match="timed out"):
        await invoke(publication)
    assert publication[1].post.await_count == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("stat", ["exists=0", "exists=1 is_dir=1"])
async def test_missing_file_stops_before_publication(publication, stat):
    publication[3].exec_command.return_value = ToolResult(success=True, data={"stdout": stat})
    with pytest.raises(ToolError, match="missing or is a directory"):
        await invoke(publication)
    publication[1].post.assert_not_called()


@pytest.mark.asyncio
async def test_traversal_stops_before_sandbox_or_publication(publication):
    with pytest.raises(ToolError, match="path not under output contract"):
        await invoke(publication, "/mnt/yellowmind/run/outputs/../../other.docx")
    publication[3].exec_command.assert_not_called()
    publication[1].post.assert_not_called()


@pytest.mark.parametrize("timeout", [0, 601])
def test_publication_timeout_is_bounded(timeout):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, sandbox_publish_timeout_seconds=timeout)


def test_publication_timeout_environment_override(monkeypatch):
    monkeypatch.setenv("SANDBOX_PUBLISH_TIMEOUT_SECONDS", "180")
    assert Settings(_env_file=None).sandbox_publish_timeout_seconds == 180


@pytest.mark.asyncio
async def test_legacy_string_receipt_remains_supported(publication):
    publication[1].post.return_value = httpx.Response(200, json="alice/system_conv/report.docx")
    assert "alice/system_conv/report.docx" in str(await invoke(publication))


@pytest.mark.asyncio
async def test_network_error_is_not_a_success(publication):
    publication[1].post.side_effect = httpx.ConnectError("unavailable")
    with pytest.raises(ToolError):
        await invoke(publication)
    assert publication[1].post.await_count == 1
