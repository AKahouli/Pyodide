import inspect
import json
from types import SimpleNamespace

import pytest
from google.adk.tools import FunctionTool

from src.infrastructure.run_code.context import (
    build_run_code_context,
    build_run_code_context_from_sources,
    parse_run_code_context,
)
import src.infrastructure.run_code.client as client_module
import src.smart_rag.tools.utilities.run_code as run_code_module
from src.smart_rag.agents.factories.delegation_factory_helper import (
    _append_run_code_guidance,
)


def _enabled_settings():
    return SimpleNamespace(
        RUN_CODE_ENABLED=True,
        RUN_CODE_RUNTIME_URL="http://runtime:8080",
        RUN_CODE_RUNTIME_API_KEY="secret",
        RUN_CODE_REQUEST_TIMEOUT_SECONDS=10,
    )


def _assert_workspace_guidance(text: str):
    text = " ".join(text.split())
    assert "no module loader or Node APIs" in text
    assert "import()" in text
    assert "require" in text
    assert "node:*" in text
    for method in ("list", "glob", "find", "stat", "readText", "readJson", "copy", "writeText", "writeJson", "remove"):
        assert method in text
    assert "fs.list('/workspace')" in text
    assert "/workspace/sources/" in text
    assert "/workspace/attachments/" in text
    assert "read-only" in text
    assert "absolute paths" in text
    assert "bare attachment filename" in text
    assert "server-side" in text or "binary processing" in text


def test_context_builds_owner_rooted_read_only_mounts_with_unique_aliases():
    context = build_run_code_context(
        "user-1",
        "conversation-1",
        ["owner-1/finance", "owner-2/finance", "owner-1/finance"],
    )

    assert context.mounts[0].model_dump(exclude_none=True) == {
        "virtualPath": "/workspace/run",
        "cephPrefix": "user-1/system_conversation-1",
        "mode": "rw",
    }
    assert [mount.virtualPath for mount in context.mounts[1:]] == [
        "/workspace/sources/finance",
        "/workspace/sources/finance-2",
    ]
    assert all(mount.mode == "r" for mount in context.mounts[1:])


def test_context_parser_accepts_trusted_source_prefix_payload():
    context = parse_run_code_context({
        "run_code_context_json": json.dumps({
            "userId": "user-1",
            "runId": "run-1",
            "sourcePrefixes": ["workspace-owner/immutable-prefix"],
        })
    })
    assert context is not None
    assert context.mounts[1].cephPrefix == "workspace-owner/immutable-prefix"


def test_descriptor_context_preserves_workspace_and_exact_attachment_scopes():
    context = build_run_code_context_from_sources("user-1", "run-1", [
        {
            "workspaceId": "workspace-1", "alias": "finance-europe",
            "cephPrefix": "owner-1/immutable-finance", "scope": {"kind": "workspace"},
        },
        {
            "workspaceId": "workspace-2", "alias": "contracts",
            "cephPrefix": "owner-2/immutable-legal",
            "scope": {"kind": "files", "relativePaths": ["legal/contract.pdf"]},
        },
    ])
    assert context.mounts[1].model_dump(exclude_none=True) == {
        "virtualPath": "/workspace/sources/finance-europe",
        "cephPrefix": "owner-1/immutable-finance",
        "mode": "r",
    }
    assert context.mounts[2].model_dump(exclude_none=True) == {
        "virtualPath": "/workspace/attachments/contracts",
        "cephPrefix": "owner-2/immutable-legal",
        "mode": "r",
        "allowedRelativePaths": ["legal/contract.pdf"],
    }


def test_context_parser_prefers_descriptor_payload_and_rejects_unknown_fields():
    context = parse_run_code_context({
        "run_code_context_json": json.dumps({
            "userId": "user-1", "runId": "run-1", "sources": [{
                "workspaceId": "workspace-1", "alias": "finance",
                "cephPrefix": "owner-1/finance", "scope": {"kind": "workspace"},
            }]
        })
    })
    assert context is not None
    assert context.sources[0].workspaceId == "workspace-1"


def test_native_tool_requires_flag_assignment_and_trusted_context(monkeypatch):
    monkeypatch.setattr(run_code_module, "get_settings", _enabled_settings)
    runtime_context = {
        "run_code_context_json": json.dumps({
            "userId": "user-1",
            "runId": "run-1",
            "sourcePrefixes": [],
        })
    }

    assert run_code_module.create_run_code_tool({}) is None
    tool = run_code_module.create_run_code_tool(runtime_context)
    assert tool is not None
    assert set(inspect.signature(tool).parameters) == {"code", "input", "tool_context"}
    declaration = FunctionTool(tool)._get_declaration()
    schema = declaration.parameters_json_schema
    normalized_description = " ".join(declaration.description.split())
    assert set(schema["properties"]) == {"code", "input"}
    assert len(declaration.description) <= 512
    assert "JSON explicitly" in normalized_description
    assert "/workspace/run" in declaration.description
    assert "mcp-manus" in declaration.description
    _assert_workspace_guidance(declaration.description)


@pytest.mark.asyncio
async def test_native_tool_normalizes_result_without_exposing_context(monkeypatch):
    monkeypatch.setattr(run_code_module, "get_settings", _enabled_settings)
    captured = {}

    async def execute(_self, **kwargs):
        captured.update(kwargs)
        return {"ok": True, "result": {"count": 2}, "logs": [], "written_files": [], "execution_ms": 4}

    monkeypatch.setattr(run_code_module.RunCodeClient, "execute", execute)
    tool = run_code_module.create_run_code_tool({
        "run_code_context_json": json.dumps({
            "userId": "user-1", "runId": "run-1", "sourcePrefixes": []
        })
    })
    result = await tool("return input;", {"count": 2})
    assert result["result"] == {"count": 2}
    assert captured["context"].userId == "user-1"
    assert captured["code"] == "return input;"


def test_prompt_guidance_is_only_added_for_available_assigned_tool(monkeypatch):
    monkeypatch.setattr(run_code_module, "get_settings", _enabled_settings)
    runtime_context = {
        "run_code_context_json": json.dumps({
            "userId": "user-1", "runId": "run-1", "sourcePrefixes": []
        })
    }
    assert _append_run_code_guidance("base", [], runtime_context) == "base"
    guided = _append_run_code_guidance(
        "base", [{"name": "run_code"}], runtime_context
    )
    assert "Use run_code for small JavaScript" in guided
    assert "async JavaScript function body" in guided
    assert "bare final expression" in guided
    assert "Do not retry run_code" in guided
    assert "fs.readText(files.find" in guided
    assert "return Object.fromEntries([['text', text]]);" in guided
    assert "{" not in run_code_module.RUN_CODE_PROMPT_GUIDANCE
    assert "}" not in run_code_module.RUN_CODE_PROMPT_GUIDANCE
    assert "/workspace/run" in guided
    assert "metadata-only" in guided
    assert "current execution" in guided
    _assert_workspace_guidance(guided)


@pytest.mark.asyncio
async def test_runtime_client_supplies_auth_and_normalizes_response(monkeypatch):
    monkeypatch.setattr(client_module, "get_settings", _enabled_settings)
    captured = {}

    class Response:
        status_code = 200

        @staticmethod
        def json():
            return {
                "ok": True,
                "result": {"count": 1},
                "logs": [],
                "writtenFiles": [],
                "mutations": [],
                "execution": {"durationMs": 3},
            }

    class Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def post(self, url, **kwargs):
            captured.update(url=url, **kwargs)
            return Response()

    monkeypatch.setattr(client_module.httpx, "AsyncClient", lambda **_kwargs: Client())
    context = build_run_code_context("user-1", "run-1")
    result = await client_module.RunCodeClient().execute(
        code="return 1;", input_value=None, context=context
    )
    assert captured["headers"]["Authorization"] == "Bearer secret"
    assert captured["json"]["context"]["userId"] == "user-1"
    assert result == {
        "ok": True,
        "result": {"count": 1},
        "logs": [],
        "written_files": [],
        "mutations": [],
        "execution_ms": 3,
    }
