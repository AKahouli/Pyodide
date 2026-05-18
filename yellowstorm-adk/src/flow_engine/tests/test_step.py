import sys
import types
from types import SimpleNamespace

import pytest
from pydantic import BaseModel

fake_litellm = types.ModuleType("litellm")
fake_litellm.api_base = None
fake_litellm.api_key = None
fake_litellm.drop_params = False
fake_litellm.acompletion = None
sys.modules.setdefault("litellm", fake_litellm)

fake_structlog = types.ModuleType("structlog")
fake_structlog.get_logger = lambda *args, **kwargs: SimpleNamespace(
    info=lambda *a, **k: None,
    warning=lambda *a, **k: None,
    error=lambda *a, **k: None,
)
sys.modules.setdefault("structlog", fake_structlog)

fake_langgraph = types.ModuleType("langgraph")
fake_langgraph_config = types.ModuleType("langgraph.config")
fake_langgraph_config.get_stream_writer = lambda: (lambda event: None)
sys.modules.setdefault("langgraph", fake_langgraph)
sys.modules.setdefault("langgraph.config", fake_langgraph_config)

fake_settings = types.ModuleType("src.config.settings")
fake_settings.get_settings = lambda: SimpleNamespace(
    LITELLM_API_BASE_URL="http://localhost",
    LITELLM_API_SECRET_KEY="test-key",
)
sys.modules.setdefault("src.config.settings", fake_settings)

from src.flow_engine.nodes.step import run_step
from src.flow_engine.nodes.step_prompt import build_step_prompt


@pytest.fixture
def anyio_backend():
    return "asyncio"


class TestStepPrompt:
    def test_build_prompt_includes_prompt_contract_sections(self):
        prompt = build_step_prompt(
            label="Draft summary",
            node_id="step-1",
            node_description="Write an executive summary using the resolved inputs.",
            input_context={"brief": "Quarterly results", "tone": "concise"},
            output_contract={
                "raw": "Return JSON",
                "ports": [{"id": "summary", "label": "Summary", "type": "text", "required": True}],
            },
            iteration=2,
            trigger_context={"email": {"subject": "Q2 review"}},
        )

        assert "Task Title:\nDraft summary" in prompt
        assert "Task Node ID:\nstep-1" in prompt
        assert "Task Description:\nWrite an executive summary using the resolved inputs." in prompt
        assert 'Resolved Inputs:\n{\n  "brief": "Quarterly results"' in prompt
        assert 'Trigger Context:\n{\n  "email": {' in prompt
        assert 'Output Contract:\n{\n  "raw": "Return JSON"' in prompt
        assert "Iteration:\n2" in prompt
        assert "Complete this node using only the resolved input data and declared output contract." in prompt

    def test_build_prompt_omits_duplicate_trigger_context(self):
        prompt = build_step_prompt(
            label="Draft summary",
            node_id="step-1",
            input_context={"brief": "Quarterly results"},
            trigger_context={"brief": "Quarterly results"},
        )

        assert "Trigger Context:" not in prompt

    def test_build_prompt_includes_structured_response_schema_when_required(self):
        prompt = build_step_prompt(
            label="Draft summary",
            node_id="step-1",
            input_context={"brief": "Quarterly results"},
            output_contract={
                "ports": [
                    {"id": "summary", "type": "text"},
                    {"id": "report", "type": "document"},
                ],
            },
            require_structured_output=True,
        )

        assert "Response Format:" in prompt
        assert '"display_text": "user-visible final answer"' in prompt
        assert '"output_port_id": "summary"' in prompt
        assert '"output_port_id": "report"' in prompt


class _CalculatorArgs(BaseModel):
    expression: str


class _FakeTool:
    name = "calculator"
    description = "Math helper"
    args_schema = _CalculatorArgs

    async def ainvoke(self, args):
        return "4"


class _ToolCallResponse:
    def __init__(self, content, tool_calls=None):
        self.choices = [
            SimpleNamespace(
                message=SimpleNamespace(content=content, tool_calls=tool_calls or []),
            ),
        ]


@pytest.mark.anyio
async def test_run_step_executes_bound_tools(monkeypatch):
    events = []
    calls = []

    def _writer(event):
        events.append(event)

    async def _fake_acompletion(*args, **kwargs):
        calls.append(kwargs)
        if len(calls) == 1:
            return _ToolCallResponse(
                "",
                [{
                    "id": "call-1",
                    "type": "function",
                    "function": {
                        "name": "calculator",
                        "arguments": '{"expression":"2+2"}',
                    },
                }],
            )
        return _ToolCallResponse("The answer is 4.")

    monkeypatch.setattr("src.flow_engine.nodes.step.get_stream_writer", lambda: _writer)
    monkeypatch.setattr("src.flow_engine.nodes.step.litellm.acompletion", _fake_acompletion)
    monkeypatch.setattr("src.flow_engine.nodes.step_tools.litellm.acompletion", _fake_acompletion)
    fake_factory_module = types.ModuleType("src.langgraph_engine.playbook_tool_factory")
    fake_factory_module.create_langchain_tools = lambda **kwargs: ([_FakeTool()], None)
    monkeypatch.setitem(sys.modules, "src.langgraph_engine.playbook_tool_factory", fake_factory_module)

    result = await run_step(
        node_id="step-1",
        node_config={
            "label": "Calculate",
            "metadata": {
                "agent_name": "Research agent",
                "agent_tools": [{"name": "calculator", "description": "Math helper"}],
            },
        },
        state={
            "execution_id": "exec-1",
            "flow_id": "flow-1",
            "inputs": {},
            "task_outputs": {},
            "iterations": {},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": False,
        },
    )

    assert len(calls) == 2
    assert calls[0]["tools"][0]["function"]["name"] == "calculator"
    assert any(message.get("role") == "tool" and message.get("content") == "4" for message in calls[1]["messages"])
    assert result["task_outputs"][("step-1", 0)]["output"] == "The answer is 4."
    assert events[-1]["type"] == "NodeCompleted"


@pytest.mark.anyio
async def test_run_step_uses_state_workspace_when_node_inputs_are_resolved(monkeypatch):
    captured_kwargs = {}

    def _fake_create_langchain_tools(**kwargs):
        captured_kwargs.update(kwargs)
        return [], None

    class _Chunk:
        def __init__(self, token):
            self.choices = [SimpleNamespace(delta=SimpleNamespace(content=token))]

    class _Stream:
        def __aiter__(self):
            self._iter = iter([_Chunk("done")])
            return self

        async def __anext__(self):
            try:
                return next(self._iter)
            except StopIteration as exc:
                raise StopAsyncIteration from exc

    async def _fake_acompletion(*args, **kwargs):
        return _Stream()

    monkeypatch.setattr("src.flow_engine.nodes.step.litellm.acompletion", _fake_acompletion)
    fake_factory_module = types.ModuleType("src.langgraph_engine.playbook_tool_factory")
    fake_factory_module.create_langchain_tools = _fake_create_langchain_tools
    monkeypatch.setitem(sys.modules, "src.langgraph_engine.playbook_tool_factory", fake_factory_module)

    await run_step(
        node_id="step-1",
        node_config={
            "label": "Calculate",
            "metadata": {
                "agent_name": "Document agent",
                "agent_tools": [{"name": "code interpreter"}],
            },
        },
        state={
            "execution_id": "exec-1",
            "flow_id": "flow-1",
            "inputs": {"__playbook_workspace_ids": ["workspace-1"]},
            "task_outputs": {},
            "iterations": {},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": False,
        },
        node_inputs={},
    )

    assert captured_kwargs["output_workspace_id"] == "workspace-1"


@pytest.mark.anyio
async def test_run_step_emits_structured_result_payload(monkeypatch):
    events = []

    def _writer(event):
        events.append(event)

    class _Chunk:
        def __init__(self, token):
            self.choices = [SimpleNamespace(delta=SimpleNamespace(content=token))]

    class _Stream:
        def __init__(self, chunks):
            self._chunks = chunks

        def __aiter__(self):
            self._iter = iter(self._chunks)
            return self

        async def __anext__(self):
            try:
                return next(self._iter)
            except StopIteration as exc:
                raise StopAsyncIteration from exc

    response_text = (
        '{"display_text":"Executive summary","outputs":['
        '{"output_port_id":"summary","artifact_kind":"text","content":"Executive summary"},'
        '{"output_port_id":"report","artifact_kind":"document","content":{"filename":"report.pdf","url":"https://example.com/report.pdf","mime_type":"application/pdf"}}'
        ']}'
    )

    async def _fake_acompletion(*args, **kwargs):
        return _Stream([_Chunk(response_text)])

    monkeypatch.setattr("src.flow_engine.nodes.step.get_stream_writer", lambda: _writer)
    monkeypatch.setattr("src.flow_engine.nodes.step.litellm.acompletion", _fake_acompletion)
    fake_factory_module = types.ModuleType("src.langgraph_engine.playbook_tool_factory")
    fake_factory_module.create_langchain_tools = lambda **kwargs: ([], None)
    monkeypatch.setitem(sys.modules, "src.langgraph_engine.playbook_tool_factory", fake_factory_module)

    result = await run_step(
        node_id="step-1",
        node_config={
            "label": "Draft summary",
            "output": {
                "ports": [
                    {"id": "summary", "type": "text"},
                    {"id": "report", "type": "document"},
                ],
            },
            "metadata": {},
        },
        state={
            "execution_id": "exec-1",
            "flow_id": "flow-1",
            "inputs": {},
            "task_outputs": {},
            "iterations": {},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": False,
        },
    )

    payload = result["task_outputs"][("step-1", 0)]
    assert payload["output"] == "Executive summary"
    assert payload["display_text"] == "Executive summary"
    assert payload["outputs"]["summary"]["content"] == "Executive summary"
    assert payload["outputs"]["report"]["ref"] == "https://example.com/report.pdf"
    assert payload["artifacts"][1]["filename"] == "report.pdf"
    assert [event["type"] for event in events] == ["NodeStarted", "NodeCompleted"]


@pytest.mark.anyio
async def test_run_step_preserves_opaque_structured_refs(monkeypatch):
    events = []

    def _writer(event):
        events.append(event)

    class _Chunk:
        def __init__(self, token):
            self.choices = [SimpleNamespace(delta=SimpleNamespace(content=token))]

    class _Stream:
        def __init__(self, chunks):
            self._chunks = chunks

        def __aiter__(self):
            self._iter = iter(self._chunks)
            return self

        async def __anext__(self):
            try:
                return next(self._iter)
            except StopIteration as exc:
                raise StopAsyncIteration from exc

    async def _fake_acompletion(*args, **kwargs):
        return _Stream([
            _Chunk('{"display_text":"Prepared","outputs":[{"output_port_id":"report","artifact_kind":"document","content":{"document_id":"doc-1"}}]}'),
        ])

    monkeypatch.setattr("src.flow_engine.nodes.step.get_stream_writer", lambda: _writer)
    monkeypatch.setattr("src.flow_engine.nodes.step.litellm.acompletion", _fake_acompletion)
    fake_factory_module = types.ModuleType("src.langgraph_engine.playbook_tool_factory")
    fake_factory_module.create_langchain_tools = lambda **kwargs: ([], None)
    monkeypatch.setitem(sys.modules, "src.langgraph_engine.playbook_tool_factory", fake_factory_module)

    result = await run_step(
        node_id="step-1",
        node_config={
            "label": "Prepare report",
            "output": {
                "ports": [{"id": "report", "type": "document"}],
            },
            "metadata": {},
        },
        state={
            "execution_id": "exec-1",
            "flow_id": "flow-1",
            "inputs": {},
            "task_outputs": {},
            "iterations": {},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": False,
        },
    )

    payload = result["task_outputs"][("step-1", 0)]
    assert payload["outputs"]["report"]["ref"] == {"document_id": "doc-1"}
    assert [event["type"] for event in events] == ["NodeStarted", "NodeCompleted"]
