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
