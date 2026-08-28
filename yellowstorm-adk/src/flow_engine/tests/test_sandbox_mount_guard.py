import asyncio

import pytest

from src.flow_engine.tools import langchain_factory
from src.flow_engine import mcp
from src.flow_engine.tools.sandbox_mount_guard import (
    SANDBOX_CALL_LIMIT_MESSAGE,
    SandboxCallBudget,
    SandboxMountGuard,
    SandboxMountValidationError,
)


EXPECTED_INPUTS = [{"path": "/mnt/workspace/cv/cv_template.docx", "kind": "file"}]
REQUIRED_ACTIONS = {"sandbox_create", "sandbox_destroy", "file_list"}


@pytest.mark.anyio
async def test_sandbox_call_budget_admits_exactly_eight_concurrent_calls() -> None:
    budget = SandboxCallBudget()

    admitted = await asyncio.gather(*(budget.try_acquire() for _ in range(20)))

    assert admitted.count(True) == 8
    assert admitted.count(False) == 12


@pytest.mark.anyio
async def test_mount_guard_accepts_validated_input() -> None:
    calls = []

    async def call(action, params):
        calls.append((action, params))
        return "created" if action == "sandbox_create" else {"name": "cv_template.docx"}

    result = await SandboxMountGuard(EXPECTED_INPUTS, REQUIRED_ACTIONS).create_validated(
        call,
        {"workspace_paths": ["owner/cv"]},
    )

    assert result == "created\nValidated sandbox inputs: /mnt/workspace/cv/cv_template.docx"
    assert calls == [
        ("sandbox_create", {"workspace_paths": ["owner/cv"]}),
        ("file_list", {"path": "/mnt/workspace/cv/cv_template.docx"}),
    ]


@pytest.mark.anyio
async def test_mount_guard_recreates_sandbox_once() -> None:
    calls = []
    validations = iter(["Error: file not found", {"name": "cv_template.docx"}])

    async def call(action, params):
        calls.append((action, params))
        if action == "sandbox_create":
            return "created"
        if action == "file_list":
            return next(validations)
        return "destroyed"

    await SandboxMountGuard(EXPECTED_INPUTS, REQUIRED_ACTIONS).create_validated(call, {})

    assert [action for action, _params in calls] == [
        "sandbox_create",
        "file_list",
        "sandbox_destroy",
        "sandbox_create",
        "file_list",
    ]


@pytest.mark.anyio
async def test_mount_guard_fails_after_one_recreation() -> None:
    calls = []

    async def call(action, params):
        calls.append((action, params))
        return "Error: file not found" if action == "file_list" else action

    guard = SandboxMountGuard(EXPECTED_INPUTS, REQUIRED_ACTIONS)
    with pytest.raises(SandboxMountValidationError, match="after one recreation: cv_template.docx"):
        await guard.create_validated(call, {})

    assert [action for action, _params in calls].count("sandbox_create") == 2
    with pytest.raises(SandboxMountValidationError, match="already attempted"):
        await guard.create_validated(call, {})


@pytest.mark.anyio
async def test_mount_guard_fails_closed_without_validation_actions() -> None:
    called = False

    async def call(_action, _params):
        nonlocal called
        called = True

    with pytest.raises(SandboxMountValidationError, match="lacks the actions"):
        await SandboxMountGuard(EXPECTED_INPUTS, {"sandbox_create"}).create_validated(call, {})

    assert called is False


@pytest.mark.anyio
async def test_mount_guard_blocks_other_actions_until_validation_finishes() -> None:
    validation_started = asyncio.Event()
    finish_validation = asyncio.Event()

    async def call(action, _params):
        if action == "sandbox_create":
            return "created"
        validation_started.set()
        await finish_validation.wait()
        return {"name": "cv_template.docx"}

    guard = SandboxMountGuard(EXPECTED_INPUTS, REQUIRED_ACTIONS)
    create_task = asyncio.create_task(guard.create_validated(call, {}))
    await validation_started.wait()
    wait_task = asyncio.create_task(guard.wait_until_ready())
    await asyncio.sleep(0)
    assert not wait_task.done()

    finish_validation.set()
    await create_task
    await wait_task


@pytest.mark.anyio
async def test_code_interpreter_uses_workspace_mounts_without_legacy_file_paths(
    monkeypatch,
) -> None:
    calls = []

    async def call_mcp_tool(
        _transport,
        _url,
        _config,
        action,
        params,
        *,
        auth_headers,
        **_kwargs,
    ):
        calls.append((action, params, auth_headers))
        if action == "sandbox_create":
            return "created"
        return {"name": "cv_template.docx"}

    monkeypatch.setattr(mcp, "call_mcp_tool", call_mcp_tool)
    tools, _collector = langchain_factory.create_langchain_tools(
        agent_config={"tools": []},
        step_connector_bindings=[{
            "connector_id": "code-interpreter",
            "connector_name": "Code Interpreter",
            "connector_slug": "code-interpreter",
            "mcp_server_url": "https://example.test/mcp",
            "actions": [
                {"action_key": "sandbox_create", "parameter_schema": {}},
                {"action_key": "sandbox_destroy", "parameter_schema": {}},
                {
                    "action_key": "file_list",
                    "parameter_schema": {
                        "type": "object",
                        "properties": {"path": {"type": "string"}},
                        "required": ["path"],
                    },
                },
            ],
        }],
        code_interpreter_files=[{
            "filepath": "owner/workspace-id/document-id/cv_template.docx",
        }],
        workspace_ceph_paths=["owner/cv", "owner/default-output"],
        binding_workspace_ids=["workspace-id"],
        sandbox_inputs=EXPECTED_INPUTS,
    )
    create_tool = next(tool for tool in tools if tool.name == "code-interpreter_sandbox_create")
    list_tool = next(tool for tool in tools if tool.name == "code-interpreter_file_list")

    await create_tool.ainvoke({})
    discovery_response = await list_tool.ainvoke({"path": "/mnt/workspace"})

    create_headers = next(headers for action, _params, headers in calls if action == "sandbox_create")
    assert create_headers["x-workspace-paths"] == "owner/cv,owner/default-output"
    assert "x-file-paths" not in create_headers
    assert "Discovery disabled" in discovery_response
    assert [action for action, _params, _headers in calls].count("file_list") == 1


@pytest.mark.anyio
async def test_code_interpreter_blocks_calls_after_per_step_budget(monkeypatch) -> None:
    calls = []

    async def call_mcp_tool(
        _transport,
        _url,
        _config,
        action,
        params,
        *,
        auth_headers,
        **_kwargs,
    ):
        calls.append((action, params, auth_headers))
        return "ok"

    monkeypatch.setattr(mcp, "call_mcp_tool", call_mcp_tool)
    tools, _collector = langchain_factory.create_langchain_tools(
        agent_config={"tools": []},
        step_connector_bindings=[{
            "connector_id": "code-interpreter",
            "connector_name": "Code Interpreter",
            "connector_slug": "code-interpreter",
            "mcp_server_url": "https://example.test/mcp",
            "actions": [
                {"action_key": "shell_exec", "parameter_schema": {}},
                {"action_key": "file_write", "parameter_schema": {}},
            ],
        }],
    )
    shell_tool = next(tool for tool in tools if tool.name == "code-interpreter_shell_exec")
    write_tool = next(tool for tool in tools if tool.name == "code-interpreter_file_write")

    responses = [await shell_tool.ainvoke({}) for _ in range(7)]
    responses.append(await write_tool.ainvoke({}))
    responses.append(await shell_tool.ainvoke({}))

    assert responses[:8] == ["ok"] * 8
    assert responses[8] == SANDBOX_CALL_LIMIT_MESSAGE
    assert len(calls) == 8


@pytest.mark.anyio
async def test_sandbox_call_budget_is_isolated_per_tool_factory(monkeypatch) -> None:
    call_count = 0

    async def call_mcp_tool(*_args, **_kwargs):
        nonlocal call_count
        call_count += 1
        return "ok"

    monkeypatch.setattr(mcp, "call_mcp_tool", call_mcp_tool)
    binding = [{
        "connector_id": "code-interpreter",
        "connector_name": "Code Interpreter",
        "connector_slug": "code-interpreter",
        "mcp_server_url": "https://example.test/mcp",
        "actions": [{"action_key": "shell_exec", "parameter_schema": {}}],
    }]

    first_tools, _collector = langchain_factory.create_langchain_tools(
        agent_config={"tools": []},
        step_connector_bindings=binding,
    )
    second_tools, _collector = langchain_factory.create_langchain_tools(
        agent_config={"tools": []},
        step_connector_bindings=binding,
    )
    first = first_tools[0]
    second = second_tools[0]

    assert all(response == "ok" for response in await asyncio.gather(*(first.ainvoke({}) for _ in range(8))))
    assert await first.ainvoke({}) == SANDBOX_CALL_LIMIT_MESSAGE
    assert await second.ainvoke({}) == "ok"
    assert call_count == 9
