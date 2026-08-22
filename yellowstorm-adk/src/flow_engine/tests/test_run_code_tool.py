import pytest

import src.flow_engine.tools.langchain_factory as factory


def _assert_workspace_guidance(text: str):
    assert "no module loader or Node APIs" in text
    assert "import()" in text
    assert "require" in text
    assert "node:*" in text
    for method in ("list", "stat", "readText", "readJson", "writeText", "writeJson"):
        assert method in text
    assert "fs.list('/workspace')" in text
    assert "/workspace/sources/" in text
    assert "read-only" in text
    assert "absolute" in text


@pytest.mark.asyncio
async def test_playbook_run_code_uses_execution_and_authoritative_workspace_paths(monkeypatch):
    monkeypatch.setattr(factory, "run_code_globally_enabled", lambda: True)
    captured = {}

    async def execute(_self, **kwargs):
        captured.update(kwargs)
        return {"ok": True, "result": 3, "logs": [], "written_files": [], "execution_ms": 2}

    monkeypatch.setattr(factory.RunCodeClient, "execute", execute)
    tools, _collector = factory.create_langchain_tools(
        agent_config={"tools": [{"name": "run_code"}], "agent_params": {}},
        user_id="caller-1",
        workspace_ceph_paths=["workspace-owner/immutable-finance"],
        execution_id="execution-1",
    )

    tool = next(item for item in tools if item.name == "run_code")
    assert "must explicitly return" in tool.description
    assert "return { result, expression };" in tool.args_schema.model_fields[
        "code"
    ].description
    _assert_workspace_guidance(tool.description)
    _assert_workspace_guidance(tool.args_schema.model_fields["code"].description)
    assert "/workspace/run" in tool.description
    assert "mcp-manus" in tool.description
    result = await tool.ainvoke({"code": "return 3;", "input": None})
    assert result["result"] == 3
    context = captured["context"]
    assert context.runId == "execution-1"
    assert context.mounts[0].cephPrefix == "caller-1/system_execution-1"
    assert context.mounts[1].cephPrefix == "workspace-owner/immutable-finance"
    assert context.mounts[1].mode == "r"


def test_playbook_run_code_is_absent_when_global_switch_is_off(monkeypatch):
    monkeypatch.setattr(factory, "run_code_globally_enabled", lambda: False)
    tools, _collector = factory.create_langchain_tools(
        agent_config={"tools": [{"name": "run_code"}], "agent_params": {}},
        user_id="caller-1",
        execution_id="execution-1",
    )
    assert all(tool.name != "run_code" for tool in tools)
